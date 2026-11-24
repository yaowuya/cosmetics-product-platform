/** The case stack page reads the current public detail independently of the Tab. */
const { pageApi } = require('../../lib/public-api');
const { caseView } = require('../../lib/model');
const { createResource, backToTab } = require('../../lib/page-feedback');

Page({
  data: { phase: 'loading', detail: null, message: '', imageFailed: false },

  onLoad(options = {}) {
    const api = pageApi(wx);
    this.resource = createResource({
      // The public API validates the original string ID and never issues a request for invalid input.
      load: async () => caseView(await api.case(options.id), api.mediaUrl),
      onReady: detail => this.setData({ detail }),
      render: state => this.setData(state.phase === 'loading'
        ? { ...state, detail: null, imageFailed: false }
        : state),
    });
    return this.resource.refresh();
  },

  onRetry() {
    if (this.data.phase === 'error') return this.resource.refresh();
  },

  onBack() {
    backToTab(wx, '/pages/cases/index');
  },

  onImageError(event) {
    if (this.data.detail && event.currentTarget.dataset.src === this.data.detail.image) {
      this.setData({ imageFailed: true });
    }
  },

  onUnload() {
    this.resource.dispose();
  },
});
