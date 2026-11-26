/** 联系页沿用 H5 的静态服务示例；所有联系动作仅使用当前公开投影。 */
const { pageApi } = require('../../lib/public-api');
const { contactView } = require('../../lib/model');
const { createResource, copyValue } = require('../../lib/page-feedback');

const SERVICES = [
  {
    tone: 'blue', title: '配方研发与打样', eyebrow: '研发与共创',
    headline: '让产品想法\n成为可用样品', points: '配方定制 · 样品开发\n应用测试 · 方案优化',
  },
  {
    tone: 'silver', title: 'OEM / ODM 生产合作', eyebrow: '生产与交付',
    headline: '从样品确认\n到成品交付', points: '包材协同 · 生产灌装\n成品交付 · 项目跟进',
  },
  {
    tone: 'mint', title: '品牌与包装支持', eyebrow: '品牌与产品',
    headline: '形成清晰的\n系列产品形象', points: '产品规划 · 包装设计\n系列开发 · 资料协同',
  },
];

function hasTextContact({ wechat, phone, email }) {
  return Boolean(wechat || phone || email);
}

function dialNumber(phone) {
  // 只移除常见格式符，避免把多个号码或分机说明合并成另一个号码。
  const number = phone.replace(/[\s().-]/g, '');
  return /^\+?\d+$/.test(number) ? number : '';
}

function showFailure(message, error) {
  if (!/cancel/i.test(error && error.errMsg || '')) wx.showToast({ title: message, icon: 'none' });
}

Page({
  data: {
    phase: 'loading', message: '', services: SERVICES,
    contact: { qr: '', wechat: '', phone: '', email: '' }, qrFailed: false, canContact: false,
    dialNumber: '', dialog: '', selectedCard: null, fallback: '',
  },

  /** 服务示例不依赖网络；联系资料只读已发布的 business_contact。 */
  onLoad() {
    const api = pageApi(wx);
    this._copyAttempt = 0;
    this._resource = createResource({
      load: async () => {
        const contact = contactView(await api.page('contact'), api.mediaUrl);
        return contact.qr || hasTextContact(contact) ? contact : null;
      },
      onReady: contact => this.setData({ contact, qrFailed: false, canContact: true, dialNumber: dialNumber(contact.phone) }),
      render: patch => this.setData(patch),
    });
    return this._resource.refresh();
  },

  /** 忽略离开页面后可能到达的请求和复制回调。 */
  onUnload() {
    this._copyAttempt += 1;
    this._resource.dispose();
  },

  /** 显式重试临时失败，不以示例或本地资料代替发布结果。 */
  retry() {
    this.closeDialog();
    return this._resource.refresh();
  },

  /** 仅在有可显示的公开联系渠道时打开咨询弹层。 */
  openContact() {
    if (this.data.phase !== 'ready' || !this.data.canContact) return;
    this._showDialog('contact', null);
  },

  /** 打开指定静态服务示例的详情，而不改变公开联系方式。 */
  openService(event) {
    const { index } = event.currentTarget.dataset;
    if (Number.isInteger(index) && SERVICES[index]) this._showDialog('service', SERVICES[index]);
  },

  /** 点击遮罩或关闭按钮，清理本次弹层的选择和复制回退。 */
  closeDialog() {
    this._showDialog('', null);
  },

  /** 遮罩拦截拖动，避免操作弹层外的页面。 */
  blockBackgroundScroll() {},

  /** 拨打公开号码；失败时已展示的号码仍可手动选中。 */
  dialPhone() {
    const { phase, dialNumber: phoneNumber } = this.data;
    if (phase !== 'ready' || !phoneNumber) return;
    const fail = error => showFailure('无法拨号，请手动拨打', error);
    if (typeof wx.makePhoneCall === 'function') wx.makePhoneCall({ phoneNumber, fail });
    else fail();
  },

  /** 复制完整的公开微信号，不构造微信内跳转。 */
  copyWechat() {
    this._copyContact(this.data.contact.wechat);
  },

  /** 复制完整的公开邮箱，不启动外部邮件应用。 */
  copyEmail() {
    this._copyContact(this.data.contact.email);
  },

  /** 通过系统预览浏览二维码；预览失败不影响其他联系渠道。 */
  previewQr() {
    const { phase, contact: { qr }, qrFailed } = this.data;
    if (phase !== 'ready' || !qr || qrFailed) return;
    const fail = error => showFailure('二维码预览失败，请稍后重试', error);
    if (typeof wx.previewImage === 'function') wx.previewImage({ current: qr, urls: [qr], fail });
    else fail();
  },

  /** 任一二维码实例加载失败后移除预览入口，留下确实存在的其他联系渠道。 */
  onQrError(event) {
    const { contact, qrFailed } = this.data;
    if (qrFailed || event.currentTarget.dataset.src !== contact.qr) return;
    this.setData({ qrFailed: true, canContact: hasTextContact(contact) });
  },

  _showDialog(dialog, selectedCard) {
    this._copyAttempt += 1;
    this.setData({ dialog, selectedCard, fallback: '' });
  },

  _copyContact(value) {
    if (this.data.phase !== 'ready' || this.data.dialog !== 'contact' || !value) return;
    const attempt = ++this._copyAttempt;
    this.setData({ fallback: '' });
    copyValue(wx, value, exact => {
      // 复制回调可能在关闭、重新打开或下一次复制之后到达。
      if (attempt === this._copyAttempt) this.setData({ fallback: exact });
    });
  },
});
