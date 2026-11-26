const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaging } = require('../lib/paging');
const result = (page, ids, total) => ({ page, page_size: 2, items: ids.map(id => ({ id })), total });
const create = () => {
  const calls = [];
  let view;
  const paging = createPaging({render: patch => { view = patch; }, load: (filter,page) => new Promise((resolve,reject) => calls.push({filter,page,resolve,reject}))});
  return { calls, paging, view: () => view };
};

test('a stale reply cannot appear while a new keyword is still debouncing', async () => {
  const { paging, calls, view } = create();
  const old = paging.reset({q:'老'});
  const current = paging.reset({q:'新'}, 5);
  calls[0].resolve(result(1,['1'],1));
  await old;
  assert.deepEqual(view().items, []);
  assert.equal(view().phase, 'loading');
  while (calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  calls[1].resolve(result(1,['2'],1));
  await current;
  assert.equal(view().items[0].id,'2');
  paging.dispose();
});

test('append is single-flight, retries same page without losing rows, and restores without a request', async () => {
  const { paging, calls, view } = create();
  const initial = paging.reset({q:''});
  calls[0].resolve(result(1,['1','2'],4));
  await initial;
  const more = paging.append();
  await paging.append();
  assert.equal(calls.length,2);
  calls[1].reject(Error('temporary'));
  await more;
  assert.equal(view().phase,'append-error');
  assert.deepEqual(view().items.map(item=>item.id),['1','2']);
  const retry = paging.retry();
  assert.equal(calls[2].page,2);
  calls[2].resolve(result(2,['2','3'],4));
  await retry;
  assert.deepEqual(view().items.map(item=>item.id),['1','2','3']);
  assert.equal(view().hasMore,false);
  const saved = paging.snapshot();
  paging.invalidate();
  assert.equal(paging.restore({q:''},saved),true);
  assert.equal(view().page,2);
  assert.equal(calls.length,3);
  paging.dispose();
});
