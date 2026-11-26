/** The mini program's only JSON transport: anonymous reads of the current public projection. */
const { resolveOrigin } = require('./config');
const PAGES = ['home', 'catalog', 'cases', 'contact'];
const PAGE_SIZE = 20;
const MAX_ID = '9223372036854775807';
const MEDIA_PREFIX = '/api/public/media/';

/** Match canonical positive BIGINT wire IDs without converting them to a JS number. */
function validId(id) {
  return typeof id === 'string' && id === id.trim() && /^[1-9][0-9]{0,18}$/.test(id)
    && (id.length < MAX_ID.length || id <= MAX_ID);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function problem(kind, status) {
  const error = new Error(kind);
  error.kind = kind;
  if (status) error.status = status;
  return error;
}

function trimmed(value, max) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '';
}

function query(values) {
  return Object.entries(values).filter(([, value]) => value !== '' && value != null)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
}

function checked(condition) {
  if (!condition) throw problem('contract');
}

/** Bind a trusted configured origin to fixed JSON routes; reject invalid input before any network call. */
function createPublicApi({ request, origin }) {
  function get(path, missingMeansAbsent = false) {
    if (!origin) return Promise.reject(problem('config'));
    return new Promise((resolve, reject) => {
      try {
        request({
          url: origin + '/api/public' + path,
          method: 'GET', dataType: 'json', timeout: 12000,
          header: { Accept: 'application/json' },
          success({ statusCode, data }) {
            if (statusCode === 404 && missingMeansAbsent) reject(problem('missing', statusCode));
            else if (statusCode !== 200) reject(problem('http', statusCode));
            else if (!record(data)) reject(problem('contract'));
            else resolve(data);
          },
          fail() { reject(problem('network')); },
        });
      } catch (_) {
        reject(problem('network'));
      }
    });
  }

  async function page(name) {
    if (!PAGES.includes(name)) throw problem('input');
    const result = await get(`/pages/${name}`);
    checked(result.page === name && record(result.body));
    return result.body;
  }

  async function catalog() {
    const result = await get('/catalog');
    checked(Array.isArray(result.nodes) && record(result.counts));
    return result;
  }

  async function listing(path, filter, number) {
    if (!Number.isSafeInteger(number) || number < 1) throw problem('input');
    const result = await get(`/${path}?${query({ ...filter, page: number, page_size: PAGE_SIZE })}`);
    checked(result.page === number && result.page_size === PAGE_SIZE && Number.isSafeInteger(result.total)
      && result.total >= 0 && Array.isArray(result.items) && result.items.length <= PAGE_SIZE
      && result.items.every(item => record(item) && validId(item.id) && record(item.body)));
    return result;
  }

  async function products(filter, number) {
    const { board_id, node_id } = filter;
    const q = trimmed(filter.q, 250);
    if (!validId(board_id) || (!q && node_id && !validId(node_id))) throw problem('input');
    // Search spans the selected board, not the category that was selected before typing.
    return listing('products', { board_id, node_id: q ? '' : node_id, q }, number);
  }

  function cases(filter, number) {
    return listing('cases', { tag: trimmed(filter.tag, 80), q: trimmed(filter.q, 250) }, number);
  }

  async function detail(path, id) {
    if (!validId(id)) throw problem('input');
    const result = await get(`/${path}/${id}`, true);
    checked(result.id === id && record(result.body));
    return result;
  }

  function mediaUrl(path) {
    return origin && typeof path === 'string' && path.startsWith(MEDIA_PREFIX) && validId(path.slice(MEDIA_PREFIX.length))
      ? origin + path : '';
  }

  /** Accept a variant only on the configured origin and its exact canonical route. */
  function variantUrl(value, suffix) {
    if (!origin || typeof value !== 'string') return '';
    const path = value.startsWith(origin) ? value.slice(origin.length) : value;
    if (!path.startsWith(MEDIA_PREFIX) || !path.endsWith(suffix)) return '';
    const id = path.slice(MEDIA_PREFIX.length, -suffix.length);
    return validId(id) ? origin + path : '';
  }

  return { page, catalog, products, cases, product: id => detail('products', id), case: id => detail('cases', id), mediaUrl,
    thumbnailUrl: value => variantUrl(value, '/thumbnail'),
    catalogThumbnailUrl: value => variantUrl(value, '/catalog-thumbnail') };
}

/** Resolve the environment at page load; unknown or unavailable account info must fail closed. */
function pageApi(platform) {
  let version;
  try { version = platform.getAccountInfoSync().miniProgram.envVersion; } catch (_) { /* Missing account info. */ }
  return createPublicApi({ origin: resolveOrigin(version), request: options => platform.request(options) });
}

module.exports = { createPublicApi, pageApi, validId };
