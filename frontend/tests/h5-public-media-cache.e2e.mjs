import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Use real routes/files and Chrome's HTTP cache against an isolated SQLite fixture on loopback.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.SHOWCASE_CACHE_TEST_PYTHON || 'python';
const fixture = String.raw`
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import os
import socket
import sys

from PIL import Image
from sqlalchemy import URL, create_engine, insert, update
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable
import uvicorn

from app.application import create_app
from app.core.db import session
from app.local import local_site
from app.models import Account, Asset, Base, ContentItem, DirectoryNode, Release, ReleaseAsset, ReleasePlace
from app.services.thumbnails import ensure_display_thumbnail


def initialize(database, media):
    slots = [('home_posters', {'poster_asset_ids': ['1']}), ('catalog_cover', {'cover_asset_id': '2'})]
    with database.begin() as connection:
        for table in Base.metadata.sorted_tables:
            # Only the MySQL microsecond default differs in this fixture; runtime reads use the real ORM.
            ddl = str(CreateTable(table).compile(dialect=database.dialect)).replace('CURRENT_TIMESTAMP(6)', 'CURRENT_TIMESTAMP')
            connection.exec_driver_sql(ddl)
        connection.execute(insert(Account).values(id=1, login='cache-fixture', password_hash='unused'))
        for ident in (1, 2, 3, 4):
            key = f'{ident:032x}'
            file = media / key
            Image.new('RGB', (480, 640), (ident * 50, 100, 150)).save(file, 'PNG')
            connection.execute(insert(Asset).values(id=ident, storage_key=key, mime='image/png', bytes=file.stat().st_size, created_by=1))
        for ident, (slot, body) in enumerate(slots, 1):
            connection.execute(insert(ContentItem).values(id=ident, kind='config', config_slot=slot))
            connection.execute(insert(Release).values(id=ident, item_id=ident, seq=1, source_revision=1, body=body, actor_id=1))
            connection.execute(insert(ReleaseAsset).values(release_id=ident, asset_id=ident))
            connection.execute(update(ContentItem).where(ContentItem.id == ident).values(live_id=ident))
        connection.execute(insert(Release).values(id=3, item_id=1, seq=2, source_revision=2,
                                                  body={'poster_asset_ids': ['3']}, actor_id=1))
        connection.execute(insert(ReleaseAsset).values(release_id=3, asset_id=3))
        connection.execute(insert(DirectoryNode).values(id=1))
        connection.execute(insert(ContentItem).values(id=4, kind='config', config_slot='directory'))
        board = {'id': '1', 'level': 'board', 'name': 'Test board', 'enabled': True}
        connection.execute(insert(Release).values(id=4, item_id=4, seq=1, source_revision=1,
                                                  body={'nodes': [board]}, actor_id=1))
        connection.execute(update(ContentItem).where(ContentItem.id == 4).values(live_id=4))
        connection.execute(insert(ContentItem).values(id=5, kind='product'))
        product = {'name': 'Cache fixture product', 'short_benefit': 'Catalog card', 'thumbnail_asset_id': '4'}
        connection.execute(insert(Release).values(id=5, item_id=5, seq=1, source_revision=1,
                                                  body=product, actor_id=1))
        connection.execute(insert(ReleaseAsset).values(release_id=5, asset_id=4))
        connection.execute(insert(ReleasePlace).values(release_id=5, node_id=1))
        connection.execute(update(ContentItem).where(ContentItem.id == 5).values(live_id=5))


with TemporaryDirectory(prefix='showcase-media-cache-') as temp, socket.socket() as listener:
    path = Path(temp)
    media = path / 'media'
    media.mkdir()
    os.environ['ASSET_ROOT'] = str(media)
    os.environ.pop('DATABASE_URL', None)
    database = create_engine(URL.create('sqlite', database=str(path / 'fixture.sqlite')))
    initialize(database, media)
    with Session(database) as db:
        ensure_display_thumbnail(db.get(Asset, 2))

    def fixture_session():
        with Session(database) as db:
            yield db

    api = create_app()
    api.dependency_overrides[session] = fixture_session

    @api.post('/api/__fixture__/update-public-images', status_code=204)
    def update_public_images():
        with database.begin() as connection:
            connection.execute(update(ContentItem).where(ContentItem.id == 1).values(live_id=3))
            connection.execute(update(ContentItem).where(ContentItem.id.in_([2, 5])).values(live_id=None))

    listener.bind(('127.0.0.1', 0))
    listener.listen()
    server = uvicorn.Server(uvicorn.Config(local_site(api, Path.cwd()), access_log=False, log_level='warning'))

    def stop_on_stdin_close():
        sys.stdin.read()
        server.should_exit = True

    Thread(target=stop_on_stdin_close, daemon=True).start()
    print(f'CACHE_FIXTURE_PORT={listener.getsockname()[1]}', flush=True)
    try:
        server.run(sockets=[listener])
    finally:
        database.dispose()
`;

/** Start a loopback fixture and shut it down by closing the owning test's pipe. */
function startFixture() {
  const child = spawn(python, ['-B', '-c', fixture], { cwd: root, windowsHide: true });
  child.stderr.pipe(process.stderr);
  const exited = new Promise(resolve => {
    child.once('error', resolve);
    child.once('exit', resolve);
  });
  const origin = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Media-cache fixture did not start in time')), 10000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      const port = /^CACHE_FIXTURE_PORT=(\d+)$/.exec(line)?.[1];
      if (!port) return;
      clearTimeout(timeout);
      resolve(`http://127.0.0.1:${port}`);
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Media-cache fixture exited during startup (${code})`));
    });
  });
  return { origin, async close() {
    child.stdin.end();
    const timeout = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timeout);
  } };
}

/** Chromium exposes cached images as 200 to the page; ExtraInfo has the actual wire status. */
async function mediaNetwork(context, page) {
  const client = await context.newCDPSession(page);
  const tracked = new Map();
  const started = [];
  const completed = [];
  client.on('Network.requestWillBeSent', event => {
    const path = new URL(event.request.url).pathname;
    if (!/^\/api\/public\/media\/\d+(?:\/(?:thumbnail|display-thumbnail))?$/.test(path)) return;
    started.push(path);
    tracked.set(event.requestId, { path, bodyBytes: 0 });
  });
  client.on('Network.responseReceivedExtraInfo', event => {
    const record = tracked.get(event.requestId);
    if (record) {
      record.status = event.statusCode;
      record.etag = event.headers.etag ?? event.headers.ETag;
    }
  });
  client.on('Network.dataReceived', event => {
    const record = tracked.get(event.requestId);
    if (record) record.bodyBytes += event.encodedDataLength;
  });
  client.on('Network.loadingFinished', event => {
    const record = tracked.get(event.requestId);
    if (record) completed.push(record);
  });
  await client.send('Network.enable');
  return { started, completed };
}

async function loadedImage(page, selector, requests, from, path) {
  const found = page.locator(selector);
  await found.evaluate(image => image.decode());
  assert.equal(await found.getAttribute('src'), path);
  for (let attempt = 0; attempt < 100; attempt++) {
    const record = requests.slice(from).find(entry => entry.path === path && entry.status);
    if (record) return record;
    await delay(20);
  }
  assert.fail(`No HTTP wire response observed for ${path}`);
}

/** Confirm a tab click changes both the public URL and selected navigation link. */
async function visitTab(page, navigation, origin, label, path) {
  const anchor = navigation.getByRole('link', { name: label, exact: true });
  await Promise.all([page.waitForURL(new URL(path, origin).href), anchor.click()]);
  await navigation.locator('a[aria-current="page"]').getByText(label, { exact: true }).waitFor();
}

/** A cached tab should show the original decoded node in the same document. */
async function assertRetainedImage(page, selector, image, path) {
  assert.equal(await page.evaluate(() => window.__mediaCacheDocument), true, `Navigation reloaded the document before ${path}`);
  const visible = page.locator(selector);
  await visible.waitFor();
  assert.ok(await visible.evaluate((element, original) => element === original && element.complete && element.naturalWidth > 0, image),
    `Returning to ${path} must retain the same decoded image node`);
}

await access(new URL('../h5/dist/build/h5/index.html', import.meta.url));
const server = startFixture();
let browser;
try {
  const origin = await server.origin;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const { started, completed } = await mediaNetwork(context, page);
  const documentRequests = [];
  page.on('request', request => {
    if (request.resourceType() === 'document') documentRequests.push(new URL(request.url()).pathname);
  });
  const home = '/api/public/media/1';
  const catalog = '/api/public/media/2/display-thumbnail';
  const thumbnail = '/api/public/media/4/thumbnail';
  const newHome = '/api/public/media/3';
  const homeSelector = '.poster-slide img';
  const catalogSelector = '.catalog-cover img';
  const thumbnailSelector = 'img.product-thumb';
  const navigation = page.getByRole('navigation', { name: '主导航' });
  const visit = (label, path) => visitTab(page, navigation, origin, label, path);

  await page.goto(origin);
  await page.evaluate(() => { window.__mediaCacheDocument = true; });
  const firstHome = await loadedImage(page, homeSelector, completed, 0, home);
  const homeNode = await page.locator(homeSelector).elementHandle();
  const catalogStart = completed.length;
  await visit('产品目录', '/catalog');
  const firstCatalog = await loadedImage(page, catalogSelector, completed, catalogStart, catalog);
  const catalogNode = await page.locator(catalogSelector).elementHandle();
  const firstThumbnail = await loadedImage(page, thumbnailSelector, completed, catalogStart, thumbnail);
  const thumbnailNode = await page.locator(thumbnailSelector).elementHandle();
  for (const first of [firstHome, firstCatalog, firstThumbnail]) {
    assert.equal(first.status, 200);
    assert.ok(first.bodyBytes > 0 && first.etag, `First request must transfer the image and ETag: ${first.path}`);
  }
  for (const first of [firstHome, firstCatalog]) {
    const conditional = await fetch(`${origin}${first.path}`, { headers: { 'If-None-Match': first.etag } });
    assert.equal(conditional.status, 304, `A new visit can revalidate ${first.path}`);
    assert.equal((await conditional.arrayBuffer()).byteLength, 0, `304 must not transfer image bytes for ${first.path}`);
  }

  const revisitStart = started.length;
  for (const [label, path, selector, image] of [
    ['品牌案例', '/cases'], ['联系我们', '/contact'],
    ['首页', '/', homeSelector, homeNode], ['产品目录', '/catalog', catalogSelector, catalogNode],
    ['首页', '/', homeSelector, homeNode], ['产品目录', '/catalog', catalogSelector, catalogNode],
  ]) {
    await visit(label, path);
    if (selector) await assertRetainedImage(page, selector, image, path);
    if (path === '/catalog') await assertRetainedImage(page, thumbnailSelector, thumbnailNode, thumbnail);
  }
  assert.deepEqual(started.slice(revisitStart).filter(path => [home, catalog, thumbnail].includes(path)), [],
    'Switching to previously loaded tabs must not request the same images again');
  assert.deepEqual(documentRequests, ['/'], 'Bottom navigation must stay within the initial document');

  await visit('联系我们', '/contact');
  assert.equal((await fetch(`${origin}/api/__fixture__/update-public-images`, { method: 'POST' })).status, 204);
  assert.equal((await fetch(`${origin}/api/public/media/2`)).status, 404, 'The withdrawn catalog original also becomes unavailable');
  for (const { path, etag } of [firstHome, firstCatalog, firstThumbnail]) {
    const direct = await fetch(`${origin}${path}`, { headers: { 'If-None-Match': etag } });
    assert.equal(direct.status, 404, `Visibility must be checked before a conditional response for ${path}`);
    const cachedBrowserRead = await page.evaluate(async path => (await fetch(path, { cache: 'no-cache' })).status, path);
    assert.equal(cachedBrowserRead, 404, `Browser must not reuse a withdrawn image at ${path}`);
  }

  const replacementStart = completed.length;
  await visit('首页', '/');
  const replacement = await loadedImage(page, `${homeSelector}[src="${newHome}"]`, completed, replacementStart, newHome);
  assert.equal(replacement.status, 200, 'A changed publication loads the replacement image');
  assert.ok(replacement.bodyBytes > 0);
  await visit('产品目录', '/catalog');
  await page.locator(catalogSelector).waitFor({ state: 'detached' });
  await page.locator(thumbnailSelector).waitFor({ state: 'detached' });
  assert.deepEqual(documentRequests, ['/'], 'Publication changes should refresh within the same document');
  console.log('H5 tabs keep decoded originals and catalog thumbnails without requests. Original revalidation returns 304, withdrawn URLs return 404, and tab re-entry updates changed images.');
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
