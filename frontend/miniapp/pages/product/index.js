/** Read each product independently so withdrawing it never leaves a cached detail visible. */
const { pageApi } = require('../../lib/public-api');
const { productView } = require('../../lib/model');
const { createResource, backToTab, copyValue } = require('../../lib/page-feedback');

Page({
  data:{ phase:'loading', message:'', detail:null, coverFailed:false, longFailed:false, fallback:'' },
  onLoad(options = {}) {
    const api = pageApi(wx);
    this._alive = true;
    this._resource = createResource({
      load: async () => productView(await api.product(options.id),api.mediaUrl),
      render: state => this.setData(state.phase === 'ready' ? state : {...state,detail:null,fallback:'',coverFailed:false,longFailed:false}),
      onReady: detail => this.setData({detail}),
    });
    return this._resource.refresh();
  },
  onRetry() { return this._resource.refresh(); },
  onBack() { backToTab(wx,'/pages/catalog/index'); },
  onCoverError() { this.setData({coverFailed:true}); },
  onLongError() { this.setData({longFailed:true}); },
  onCopyFormula() {
    if (!this.data.detail) return;
    copyValue(wx,this.data.detail.formula,fallback => {
      if (this._alive && this.data.detail && this.data.detail.formula === fallback) this.setData({fallback});
    });
  },
  onUnload() { this._alive = false; this._resource.dispose(); },
});
