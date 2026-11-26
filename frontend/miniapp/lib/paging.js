/** Own list state and reject completions from older selections, even during debounce. */
function createPaging({ load, render }) {
  let active = 0, pending, filter, disposed = false;
  const blank = phase => ({ items: [], total: 0, page: 0, hasMore: false, phase });
  let view = blank('idle');

  function emit(value) {
    view = value;
    render(value);
  }

  function invalidate() {
    active++;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve();
      pending = undefined;
    }
  }

  async function run(number, append, generation) {
    try {
      const response = await load(filter, number);
      if (generation !== active || disposed) return;
      const items = new Map((append ? view.items : []).map(item => [item.id, item]));
      for (const item of response.items) if (!items.has(item.id)) items.set(item.id,item);
      // Use the server cursor, not deduplicated count, or a moved row could prevent completion.
      const hasMore = response.items.length > 0 && response.page * response.page_size < response.total;
      emit({ items: [...items.values()], total: response.total, page: response.page, hasMore,
        phase: items.size ? 'ready' : 'empty' });
    } catch (_) {
      if (generation === active && !disposed) emit({ ...view, phase: append ? 'append-error' : 'error' });
    }
  }

  function reset(nextFilter, delay = 0) {
    if (disposed) return Promise.resolve();
    invalidate();
    filter = nextFilter;
    emit(blank('loading'));
    const generation = active;
    if (!delay) return run(1,false,generation);
    return new Promise(resolve => {
      pending = { resolve, timer: setTimeout(() => {
        pending = undefined;
        void run(1,false,generation).then(resolve);
      },delay) };
    });
  }

  function append() {
    if (disposed || !view.hasMore || !['ready','append-error'].includes(view.phase)) return Promise.resolve();
    emit({ ...view, phase: 'appending' });
    return run(view.page + 1,true,active);
  }

  function retry() {
    if (view.phase === 'append-error') return append();
    if (view.phase === 'error') return reset(filter);
    return Promise.resolve();
  }

  function snapshot() {
    if (!['ready','empty','appending','append-error'].includes(view.phase)) return null;
    return { ...view, phase: view.phase === 'appending' ? 'ready' : view.phase };
  }

  function restore(nextFilter, saved) {
    if (disposed || !saved) return false;
    invalidate();
    filter = nextFilter;
    emit(saved);
    return true;
  }

  return { reset, append, retry, invalidate, snapshot, restore, dispose() { disposed = true; invalidate(); } };
}

module.exports = { createPaging };
