/** Coordinate a small non-list resource without publishing after a newer refresh or unload. */
const { validId } = require('./public-api');

function createResource({ load, render, onReady }) {
  let generation = 0, disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      render({ phase: 'loading', message: '' });
      try {
        const value = await load();
        if (run !== generation || disposed) return;
        if (value == null) render({ phase: 'empty', message: '' });
        else {
          if (onReady) onReady(value);
          render({ phase: 'ready', message: '' });
        }
      } catch (error) {
        if (run !== generation || disposed) return;
        if (error && ['missing','input'].includes(error.kind)) {
          render({ phase: 'missing', message: '内容不存在或暂未公开。' });
        } else {
          render({ phase: 'error', message: error && error.kind === 'config' ? '当前版本未配置服务地址。' : '加载失败，请稍后重试。' });
        }
      }
    },
    dispose() { disposed = true; generation++; },
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

module.exports = { createResource, detailUrl, backToTab, copyValue };
