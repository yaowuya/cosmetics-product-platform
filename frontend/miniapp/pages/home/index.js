/** 首页只展示公开海报；切换 Tab 时保留阅读位置，不保留轮播倒计时。 */
const { pageApi } = require('../../lib/public-api');
const { homeView } = require('../../lib/model');
const { createResource } = require('../../lib/page-feedback');

const IDLE_MS = 4000;

Page({
  data: { phase: 'loading', message: '', posters: [], current: 0, posterVersion: 0 },

  /** 新建页面实例时请求当前发布结果；空数组交给共享空态。 */
  onLoad() {
    const api = pageApi(wx);
    this._reading = new Set();
    this._resource = createResource({
      load: async () => {
        const posters = homeView(await api.page('home'), api.mediaUrl);
        return posters.length ? posters : null;
      },
      onReady: posters => this.setData({ posters, current: 0 }),
      render: patch => {
        this.setData(patch);
        this._schedule();
      },
    });
    return this._resource.refresh();
  },

  /** 返回 Tab 时从完整的空闲间隔开始，原位置仍保留。 */
  onShow() {
    this._visible = true;
    this._schedule();
  },

  /** 不依赖隐藏时尚未分发的 touchend 事件。 */
  onHide() {
    this._visible = false;
    this._held = false;
    this._clearTimer();
  },

  /** 页面销毁时同时屏蔽迟到的资源结果和计时器。 */
  onUnload() {
    this.onHide();
    this._resource.dispose();
  },

  /** 重试重新读取发布结果，允许重新加载此前失败的图片。 */
  retry() {
    this._reading.clear();
    this.setData({ posters: [], current: 0, posterVersion: this.data.posterVersion + 1 });
    return this._resource.refresh();
  },

  /** 触碰海报或页码立即暂停，交由原生组件区分横向与纵向手势。 */
  onTouchStart() {
    this._held = true;
    this._clearTimer();
  },

  /** touchend 和 touchcancel 都可能还有其他手指留在屏幕上。 */
  onTouchEnd(event = {}) {
    this._held = Boolean(event.touches && event.touches.length);
    this._schedule();
  },

  /** 每张海报独立阅读；仅当前海报从顶部离开或回顶时改变计时。 */
  onPosterScroll(event) {
    const { src } = event.currentTarget.dataset;
    if (!this._isCurrentImage(event)) return;
    const reading = event.detail.scrollTop > 0;
    if (reading === this._reading.has(src)) return;
    if (reading) this._reading.add(src);
    else this._reading.delete(src);
    if (src === this.data.posters[this.data.current]) this._schedule();
  },

  /** 只从原生手势接收页码，忽略由 current 属性变更产生的回调。 */
  onSlideChange(event) {
    if (event.detail.source === 'touch') this._goTo(event.detail.current);
  },

  /** 点击分页点与手势翻页共享同一页码和空闲判断。 */
  selectPoster(event) {
    this._goTo(event.currentTarget.dataset.index);
  },

  /** 跳过断图；若当前图未失败则保留其身份，而不是旧数组下标。 */
  onPosterError(event) {
    if (!this._isCurrentImage(event)) return;
    const { src } = event.currentTarget.dataset;
    const { posters, current } = this.data;
    const remaining = posters.filter(url => url !== src);
    const retained = remaining.indexOf(posters[current]);
    const next = retained < 0 ? Math.max(0, Math.min(current, remaining.length - 1)) : retained;
    this._reading.delete(src);
    this.setData(remaining.length
      ? { posters: remaining, current: next }
      : { posters: [], current: 0, phase: 'error', message: '图片加载失败，请检查连接后重试。' });
    this._schedule();
  },

  _isCurrentImage(event) {
    const { src, version } = event.currentTarget.dataset;
    // 重试可能重新拉到同一 URL，旧节点的延迟事件不能移除新图片。
    return version === this.data.posterVersion && this.data.posters.includes(src);
  },

  _goTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.data.posters.length) return;
    if (index !== this.data.current) this.setData({ current: index });
    this._schedule();
  },

  _canAdvance() {
    const { phase, posters, current } = this.data;
    return this._visible && !this._held && phase === 'ready' && posters.length > 1
      && !this._reading.has(posters[current]);
  },

  _clearTimer() {
    clearTimeout(this._timer);
    this._timer = undefined;
  },

  _schedule() {
    this._clearTimer();
    if (!this._canAdvance()) return;
    this._timer = setTimeout(() => {
      this._timer = undefined;
      if (this._canAdvance()) this._goTo((this.data.current + 1) % this.data.posters.length);
    }, IDLE_MS);
  },
});
