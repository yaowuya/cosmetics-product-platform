/** Coordinate a small non-list resource without publishing after a newer refresh or unload. */
const { validId } = require('./public-api');

function createResource({ load, render, onReady, onEmpty }) {
  let generation = 0, pending = false, hasResult = false, disposed = false;
  return {
    async refresh({ quiet = false } = {}) {
      if (disposed || (quiet && pending)) return;
      const keepVisible = quiet && hasResult;
      const run = ++generation;
      pending = true;
      if (!keepVisible) render({ phase: 'loading', message: '' });
      try {
        const value = await load();
        if (run !== generation || disposed) return;
        hasResult = true;
        if (value == null) {
          if (onEmpty) onEmpty();
          render({ phase: 'empty', message: '' });
        } else {
          if (onReady) onReady(value);
          render({ phase: 'ready', message: '' });
        }
      } catch (error) {
        if (run !== generation || disposed) return;
        if (error && ['missing','input'].includes(error.kind)) {
          render({ phase: 'missing', message: '内容不存在或暂未公开。' });
        } else if (!keepVisible) {
          render({ phase: 'error', message: error && error.kind === 'config' ? '当前版本未配置服务地址。' : '加载失败，请稍后重试。' });
        }
      } finally {
        if (run === generation) pending = false;
      }
    },
    dispose() { disposed = true; generation++; },
  };
}

/** The initial onShow overlaps onLoad. Subsequent shows can quietly verify publication. */
function afterFirstShow(refresh) {
  let shown = false;
  return () => {
    if (shown) return refresh();
    shown = true;
  };
}

/** Return only a registered public detail route with a canonical string ID. */
function detailUrl(kind,id) {
  return ['case','product'].includes(kind) && validId(id) ? `/pages/${kind}/index?id=${id}` : '';
}

/** Preserve the navigation stack when present; deep links fall back to their parent Tab. */
function backToTab(platform,url) {
  platform.navigateBack({ delta: 1, fail: () => platform.switchTab({ url }) });
}

/** Copy a nonempty published value, passing that exact text to the manual fallback on failure. */
function copyValue(platform,value,onFallback) {
  if (!value) return;
  platform.setClipboardData({ data: value,
    success: () => platform.showToast({ title: '已复制', icon: 'success' }),
    fail: () => onFallback(value),
  });
}

module.exports = { createResource, afterFirstShow, detailUrl, backToTab, copyValue };
