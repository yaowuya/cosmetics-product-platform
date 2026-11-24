/** Project published wire data into small values safe for Page.setData. */
const { validId } = require('./public-api');
const rows = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const offset = value => Number.isFinite(value) && value > 0 ? value : 0;
const inputText = (value, max) => typeof value === 'string' ? Array.from(value).slice(0,max).join('') : '';

/** Keep valid linked tiers in server order; omit orphans and normalize published counts. */
function projectCatalog(tree, mediaUrl) {
  const boards = [], categories = Object.create(null), fine = Object.create(null), counts = Object.create(null);
  const serverCounts = object(tree.counts);
  const valid = new Map();
  for (const raw of rows(tree.nodes).map(object)) {
    if (!validId(raw.id) || valid.has(raw.id)) continue;
    valid.set(raw.id, raw);
  }
  // Iterate in server order for each tier without assuming children follow parents.
  for (const level of ['board','category','subcategory']) {
    for (const raw of valid.values()) {
      if (raw.level !== level) continue;
      const view = { id: raw.id, name: text(raw.name,'未命名'), icon: mediaUrl(raw.icon_url) };
      if (level === 'board' && raw.parent_id === null) {
        boards.push(view);
        categories[raw.id] = [];
      } else if (level === 'category' && validId(raw.parent_id) && categories[raw.parent_id]) {
        categories[raw.parent_id].push(view);
        fine[raw.id] = [];
      } else if (level === 'subcategory' && validId(raw.parent_id) && fine[raw.parent_id]) {
        fine[raw.parent_id].push(view);
      } else continue;
      const count = serverCounts[raw.id];
      counts[raw.id] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }
  }
  return { boards, categories, fine, counts };
}

/** Restore selection and offsets only within the selected board's current tree. */
function selectBoard(tree, board, saved = {}) {
  const categories = tree.categories[board] || [];
  const category = categories.some(node => node.id === saved.category) ? saved.category : (categories.length ? categories[0].id : '');
  const fine = (tree.fine[category] || []).some(node => node.id === saved.fine) ? saved.fine : '';
  return { category, fine, q: inputText(saved.q,250), left: offset(saved.left), right: offset(saved.right) };
}

function homeView(body, mediaUrl) {
  return [...new Set(rows(body.poster_asset_urls).map(mediaUrl).filter(Boolean))];
}

function catalogCover(body, mediaUrl) {
  const image = mediaUrl(body.cover_asset_url);
  // The page hides duplicate typography while a text-bearing image is available.
  return { image, imageHasText: !!image && body.image_has_text === true,
    top: text(body.slogan_top), bottom: text(body.slogan_bottom) };
}

function productView(item, mediaUrl) {
  const body = object(item.body);
  return {
    id: item.id, name: text(body.name,'未命名产品'), short: text(body.short_benefit),
    image: mediaUrl(body.cover_asset_url), long: mediaUrl(body.detail_asset_url),
    benefit: text(body.benefit,'—'), ingredients: text(body.ingredients,'—'), highlights: text(body.highlights,'—'),
    formula: text(body.formula_no), production: text(body.production_status,'待确认'),
  };
}

function caseHeader(body, mediaUrl) {
  const tags = [];
  const keys = new Set();
  for (const raw of rows(body.filters).map(object)) {
    const key = text(raw.key), label = text(raw.label);
    if (!key || Array.from(key).length > 80 || !label || keys.has(key)) continue;
    tags.push({key,label});
    keys.add(key);
  }
  return { image: mediaUrl(body.background_asset_url), title: text(body.title,'品牌案例'), intro: text(body.intro), tags };
}

function caseView(item, mediaUrl) {
  const body = object(item.body);
  return { id: item.id, brand: text(body.brand_name,'品牌案例'), name: text(body.product_name),
    image: mediaUrl(body.image_asset_url), highlight: text(body.highlight), description: text(body.description),
    series: text(body.series), number: text(body.case_no) };
}

/** Use only published business-contact values; absent fields stay empty. */
function contactView(body, mediaUrl) {
  const contact = object(body.business_contact);
  return { qr: mediaUrl(contact.qr_asset_url), wechat: text(contact.wechat_id), phone: text(contact.phone), email: text(contact.email) };
}

module.exports = { inputText, projectCatalog, selectBoard, homeView, catalogCover, productView, caseHeader, caseView, contactView };
