/** Published case configuration and paginated results for the native cases Tab. */
const { pageApi } = require('../../lib/public-api');
const { caseHeader, caseView, inputText } = require('../../lib/model');
const { createPaging } = require('../../lib/paging');
const { detailUrl } = require('../../lib/page-feedback');

const FALLBACK_HEADER = caseHeader({}, () => '');
const KEYWORD_LIMIT = 140;
const KEYWORD_DELAY = 160;

Page({
  data: {
    header: FALLBACK_HEADER, configPhase: 'loading', configMessage: '',
    tag: '', q: '', searchActive: false, items: [], page: 0, total: 0, phase: 'idle', hasMore: false,
    headerImageFailed: false, brokenImages: {},
  },

  onLoad() {
    const api = pageApi(wx);
    this.api = api;
    this.configRun = 0;
    this.paging = createPaging({
      async load(filter, page) {
        const list = await api.cases(filter, page);
        return { ...list, items: list.items.map(item => {
          const { id, brand, name, image, highlight } = caseView(item, api.mediaUrl);
          return { id, brand, name, image, highlight };
        }) };
      },
      render: state => this.setData(state),
    });
    return this.reload();
  },

  async reload() {
    // Invalidating now keeps an old list/append response out while config is refetched.
    const run = ++this.configRun;
    this.paging.invalidate();
    this.setData({
      header: FALLBACK_HEADER, configPhase: 'loading', configMessage: '',
      items: [], page: 0, total: 0, phase: 'idle', hasMore: false,
      headerImageFailed: false, brokenImages: {},
    });
    let header;
    try {
      header = caseHeader(await this.api.page('cases'), this.api.mediaUrl);
    } catch (error) {
      if (run === this.configRun) this.setData({
        configPhase: 'error',
        configMessage: error && error.kind === 'config' ? '当前版本未配置服务地址。' : '案例页面加载失败，请稍后重试。',
      });
      return;
    }
    if (run !== this.configRun) return;
    const tag = header.tags.some(entry => entry.key === this.data.tag) ? this.data.tag : '';
    this.setData({ header, tag, configPhase: 'ready' });
    return this.paging.reset({ tag, q: this.data.q });
  },

  async onPullDownRefresh() {
    const pending = this.reload();
    const run = this.configRun;
    try {
      await pending;
    } finally {
      if (run === this.configRun) wx.stopPullDownRefresh();
    }
  },

  applyFilter(tag, q, delay = 0) {
    if (this.data.configPhase !== 'ready' || (tag === this.data.tag && q === this.data.q)) return;
    this.setData({ tag, q, searchActive: !!q.trim(), brokenImages: {} });
    const pending = this.paging.reset({ tag, q }, delay);
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    return pending;
  },

  onSearch(event) {
    return this.applyFilter(this.data.tag, inputText(event.detail.value, KEYWORD_LIMIT), KEYWORD_DELAY);
  },

  onSelectTag(event) {
    const { tag = '' } = event.currentTarget.dataset;
    if (tag !== '' && !this.data.header.tags.some(entry => entry.key === tag)) return;
    return this.applyFilter(tag, this.data.q);
  },

  onClear() {
    return this.applyFilter('', '');
  },

  onLoadMore() {
    if (this.data.configPhase === 'ready') return this.paging.append();
  },

  onRetry() {
    if (this.data.configPhase === 'error') return this.reload();
    if (this.data.configPhase === 'ready') return this.paging.retry();
  },

  onOpenCase(event) {
    // Only push the detail; the Tab instance owns its results and native page scroll.
    const url = detailUrl('case', event.currentTarget.dataset.id);
    if (url) wx.navigateTo({ url });
  },

  onHeaderImageError(event) {
    if (event.currentTarget.dataset.src === this.data.header.image) this.setData({ headerImageFailed: true });
  },

  onCardImageError(event) {
    const { id, src } = event.currentTarget.dataset;
    if (this.data.items.some(item => item.id === id && item.image === src)) {
      this.setData({ brokenImages: { ...this.data.brokenImages, [id]: src } });
    }
  },

  onUnload() {
    this.configRun++;
    this.paging.dispose();
  },
});
