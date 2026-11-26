/** Published product directory; the Tab instance owns independent in-memory views per board. */
const { pageApi } = require('../../lib/public-api');
const { projectCatalog, selectBoard, inputText, catalogCover, productCard } = require('../../lib/model');
const { createPaging } = require('../../lib/paging');
const { detailUrl } = require('../../lib/page-feedback');

// Native image assets mirror the H5 board marks for the five standard names.
const BOARD_ICON_FILES = new Map([
  ['护肤','droplets'], ['冻干','snowflake'], ['二类','shield'], ['洗护','bubbles'], ['外贸','globe'],
]);

/** Return the packaged mark for a standard board, or the generic mark for a custom board. */
function defaultBoardIcon(name) {
  return `/assets/catalog/${BOARD_ICON_FILES.get(name) || 'briefcase'}.png`;
}

Page({
  data: {
    configPhase:'loading', configMessage:'', cover:{}, coverFailed:false,
    imageVersion:0, failedThumbnails:{}, broken:{},
    board:'', boards:[], category:'', categories:[], fine:'', fineChoices:[], count:0,
    q:'', searchActive:false, items:[], total:0, page:0, phase:'idle', hasMore:false,
    leftTop:0, rightTop:0, refreshing:false,
  },

  onLoad() {
    this._api = pageApi(wx);
    this._views = new Map();
    this._scroll = {left:0,right:0};
    this._bootVersion = 0;
    this._scrollVersions = {left:0,right:0};
    this._paging = createPaging({
      load: async (filter,page) => {
        const result = await this._api.products(filter,page);
        return { ...result, items:result.items.map(item => productCard(item,this._api)) };
      },
      render: state => {
        const {imageVersion} = this.data;
        // Bind the generation to each native node so reusing the same product ID cannot relabel an old request.
        const items = state.items.map(item => ({...item,imageVersion,imageKey:`${imageVersion}:${item.id}`}));
        this.setData({...state,items});
      },
    });
    return this.loadDirectory();
  },

  async loadDirectory() {
    const version = ++this._bootVersion;
    const board = this.data.board;
    const activeView = board ? this.currentView() : {};
    // Manual refresh reloads publication metadata and never reuses an old content snapshot.
    this._views.clear();
    this._paging.invalidate();
    this.setData({configPhase:'loading',configMessage:'',coverFailed:false,...this.nextImageView()});
    try {
      const [body,tree] = await Promise.all([this._api.page('catalog'),this._api.catalog()]);
      if (version !== this._bootVersion) return;
      this._tree = projectCatalog(tree,this._api.mediaUrl);
      const boards = this._tree.boards.map(item => ({...item,displayIcon:item.icon || defaultBoardIcon(item.name)}));
      const selected = boards.find(item => item.id === board) || boards[0];
      this.setData({boards,cover:catalogCover(body,this._api.mediaUrl),configPhase:'ready'});
      if (selected) await this.enterBoard(selected.id,selected.id === board ? {...activeView,right:0} : {});
      else this.setData({board:'',categories:[],fineChoices:[],items:[],total:0,hasMore:false});
    } catch (error) {
      if (version !== this._bootVersion) return;
      this.setData({configPhase:'error',configMessage:error && error.kind === 'config'
        ? '当前版本未配置服务地址。' : '目录加载失败，请重试。'});
    }
  },

  currentView() {
    const {category,fine,q} = this.data;
    return {category,fine,q,...this._scroll};
  },

  selectionPatch(category,fine) {
    return {category,fine,fineChoices:this._tree.fine[category] || [], count:this._tree.counts[category || this.data.board] || 0};
  },

  filter() {
    const {board,category,fine,q} = this.data;
    return { board_id:board, node_id:fine || category || board, q };
  },

  async enterBoard(board,saved = {}) {
    const {category,fine,q,left,right} = selectBoard(this._tree,board,saved);
    this.setData({board,q,searchActive:!!q.trim(),categories:this._tree.categories[board] || [],...this.selectionPatch(category,fine),
      count:this._tree.counts[category || board] || 0,...this.nextImageView()});
    this.moveScroll('left',left);
    if (this._paging.restore(this.filter(),saved.list)) this.moveScroll('right',right);
    else {
      this.moveScroll('right',0);
      await this._paging.reset(this.filter());
    }
  },

  moveScroll(side,top) {
    // A user's scroll does not change the bound value; publish the actual offset before requesting another one.
    const key = `${side}Top`;
    const version = ++this._scrollVersions[side];
    this.setData({[key]:this._scroll[side]},() => {
      if (this._scrollVersions[side] !== version) return;
      this._scroll[side] = top;
      this.setData({[key]:top});
    });
  },

  onBoard(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.configPhase !== 'ready' || id === this.data.board || !this.data.boards.some(item => item.id === id)) return;
    this._views.set(this.data.board,{...this.currentView(),list:this._paging.snapshot()});
    return this.enterBoard(id,this._views.get(id));
  },
  onCategory(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.categories.some(item => item.id === id)) return;
    this.setData({q:'',searchActive:false,...this.selectionPatch(id,'')});
    return this.relist();
  },
  onFine(event) {
    const id = event.currentTarget.dataset.id || '';
    if (this.data.fine === id || (id && !this.data.fineChoices.some(item => item.id === id))) return;
    this.setData({fine:id});
    return this.relist();
  },
  onSearch(event) { return this.search(inputText(event.detail.value,250)); },
  onClear() { return this.search(''); },
  search(q) {
    if (q === this.data.q || this.data.configPhase !== 'ready' || !this.data.board) return;
    // Keep the raw input while matching the API's trimmed keyword semantics.
    const searchActive = !!q.trim();
    this.setData({q,searchActive});
    return this.relist(searchActive ? 160 : 0);
  },
  relist(delay = 0) {
    this.setData(this.nextImageView());
    this.moveScroll('right',0);
    return this._paging.reset(this.filter(),delay);
  },
  /** Each replacement rejects old image events, including rows with the same ID and URL. */
  nextImageView() {
    return {imageVersion:this.data.imageVersion + 1,failedThumbnails:{},broken:{}};
  },
  onLeftScroll(event) { this._scroll.left = event.detail.scrollTop; },
  onRightScroll(event) { this._scroll.right = event.detail.scrollTop; },
  onLoadMore() { return this._paging.append(); },
  onRetry() { return this.data.configPhase === 'error' ? this.loadDirectory() : this._paging.retry(); },
  onCoverError(event) {
    if (event.currentTarget.dataset.src === this.data.cover.image) this.setData({coverFailed:true});
  },
  /** Replace only the failed upload that the board is still displaying. */
  onBoardIconError(event) {
    const {id,src} = event.currentTarget.dataset;
    const index = this.data.boards.findIndex(item => item.id === id && item.icon === src && item.displayIcon === src);
    if (index < 0) return;
    const item = this.data.boards[index];
    this.setData({[`boards[${index}].displayIcon`]:defaultBoardIcon(item.name)});
  },
  /** A failed thumbnail opens the original once; a failed original leaves the placeholder. */
  onImageError(event) {
    const {id,src,version} = event.currentTarget.dataset;
    if (version !== this.data.imageVersion || !src) return;
    const item = this.data.items.find(item => item.id === id);
    if (!item) return;
    const thumbnail = this.data.failedThumbnails[id] !== item.thumbnail ? item.thumbnail : '';
    const state = thumbnail ? 'failedThumbnails' : 'broken';
    if (src !== (thumbnail || item.image) || this.data[state][id] === src) return;
    this.setData({[state]:{...this.data[state],[id]:src}});
  },
  async onRefresh() {
    if (this.data.configPhase === 'loading') return;
    this.setData({refreshing:true});
    await this.loadDirectory();
    if (this._paging) this.setData({refreshing:false});
  },
  onOpenProduct(event) {
    const url = detailUrl('product',event.currentTarget.dataset.id);
    if (url) wx.navigateTo({url});
  },
  onUnload() {
    this._bootVersion++;
    this._scrollVersions.left++;
    this._scrollVersions.right++;
    this._paging.dispose();
    this._paging = null;
  },
});
