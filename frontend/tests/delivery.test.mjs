import {strict as assert} from 'node:assert';
import {readFile, stat} from 'node:fs/promises';
import {test} from 'node:test';

test('两端的发布包不依赖本地设计稿、模拟身份或演示图片数据',async()=>{
 for(const dir of ['../admin/dist/','../h5/dist/build/h5/']){
   const base=new URL(dir,import.meta.url),html=await readFile(new URL('index.html',base),'utf8');
   assert.doesNotMatch(html,/__FP_PROTOTYPE__|demoAssets|prototype\.html|fp-docs\/changes/);
   const entries=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]; assert.ok(entries.length);
   for(const [,src] of entries){const file=new URL(src.replace(/^\/(?:admin\/)?/,''),base);assert.ok((await stat(file)).isFile());assert.doesNotMatch(await readFile(file,'utf8'),/__FP_PROTOTYPE__|重置演示数据|切换模拟身份/);}
 }
});

for (const [name, dir, prefix, title] of [
  ['管理端', '../admin/dist/', '/admin/', '内容管理 · 企业产品图册'],
  ['公开 H5', '../h5/dist/build/h5/', '/', '企业产品图册'],
]) {
  test(`${name}发布包提供正确的标签标题和图标`, async () => {
    const base = new URL(dir, import.meta.url);
    const html = await readFile(new URL('index.html', base), 'utf8');
    const link = html.match(/<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"/);
    assert.ok(link, '缺少浏览器标签图标');
    const [, href] = link;
    assert.ok(href.startsWith(`${prefix}assets/`), `图标没有部署在应用自己的静态路径：${href}`);
    const icon = await readFile(new URL(href.slice(prefix.length), base), 'utf8');
    assert.match(icon, /^<svg[\s>]/);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], title);
  });
}
