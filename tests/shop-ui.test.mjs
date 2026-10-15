import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../public/shop-sync.js';
test('shop preview distinguishes empty results and escapes upstream content',()=>{
  const html=ui.shopPreviewHTML({shopName:'<店铺>',products:[{name:'<img onerror=x>',productId:'p',status:'sold_out',imported:true}],fetchedAt:'2026-10-07T08:00:00Z'});
  assert.match(html,/售罄/);assert.match(html,/已导入/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img onerror/);
  assert.match(ui.shopPreviewHTML({shopName:'店铺',products:[]}),/店铺暂无商品/);
});
test('shop source marks imported photos as shop images and reports unknown states honestly',()=>{
  assert.equal(ui.shopSourceHTML({}), '');
  const html=ui.shopSourceHTML({shopSource:{shopName:'自营店',productId:'p1',status:'new-state',fetchedAt:'2026-10-07T08:00:00Z'}});
  assert.match(html,/状态未知/);assert.match(html,/自营店/);
});
