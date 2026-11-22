import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewItem, validSelection, requestMatches } from '../h5/src/preview-api.ts';

test('预览只接受有效的字符串 ID 和大整数修订',()=>{
  assert.ok(validSelection('9007199254740993','0'));
  for(const [id,rev] of [['','0'],['1',''],['0','1'],['1','-1'],['9223372036854775808','0']])assert.equal(validSelection(id,rev),false);
});
test('旧请求或不同条目不渲染，只有指定修订的私有 URL 能进入视图',()=>{
  assert.equal(requestMatches({id:'2',revision:'3',generation:2},{id:'1',revision:'3',generation:1}),false);
  assert.equal(requestMatches({id:'1',revision:'3',generation:3},{id:'1',revision:'3',generation:2}),false);
  const snap={id:'1',revision:'3',kind:'config',config_slot:'services',place_ids:[],body:{cards:[{image_asset_id:'4',title:'服务'}]},media_urls:{'4':'/api/admin/media/4?item_id=1&revision=3'}};
  assert.equal(previewItem(snap).body.cards[0].image_asset_url,snap.media_urls['4']);
  assert.equal(previewItem({...snap,media_urls:{}}).body.cards[0].image_asset_url,undefined);
});
