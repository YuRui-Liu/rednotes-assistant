import test from 'node:test';
import assert from 'node:assert/strict';
import { AppStore } from '../server/store.mjs';
import * as shop from '../server/shop-sync.mjs';

const snapshot = (overrides={}) => ({shopId:'shop-1',shopName:'我的店',complete:true,fetchedAt:'2026-10-07T08:00:00.000Z',products:[{productId:'p-1',name:'原始商品',url:'https://www.xiaohongshu.com/item/1',images:['https://img.example.com/1.jpg'],facts:'容量：500ml',status:'on_sale'}],...overrides});
test('shop import deduplicates by store and product, preserves manually reviewed content', () => {
  const s=new AppStore();
  try {
    const a=s.createAccount({name:'店主'});
    const first=shop.importShopSnapshot(s,a.id,snapshot());
    assert.equal(first.created,1);
    const p=s.list('products')[0];
    assert.equal(p.confirmed,false);
    assert.equal(p.shopSource.status,'on_sale');
    s.updateProduct(p.id,{name:'人工标题',facts:'人工核对事实',images:[],confirmed:true});
    const second=shop.importShopSnapshot(s,a.id,snapshot({products:[{...snapshot().products[0],name:'店铺新标题',status:'off_shelf'}]}));
    assert.equal(second.created,0);assert.equal(second.updated,1);
    const changed=s.get('products',p.id);
    assert.equal(changed.name,'人工标题');assert.equal(changed.facts,'人工核对事实');
    assert.deepEqual(changed.images,[]);assert.equal(changed.confirmed,true);
    assert.equal(changed.shopSource.name,'店铺新标题');assert.equal(changed.shopSource.status,'off_shelf');
    assert.equal(changed.version,2);
  } finally {s.close();}
});
test('identical product IDs in different shops remain distinct; empty snapshot never deletes', () => {
  const s=new AppStore();
  try {const a=s.createAccount({name:'店主'});shop.importShopSnapshot(s,a.id,snapshot());shop.importShopSnapshot(s,a.id,snapshot({shopId:'shop-2'}));assert.equal(s.list('products').length,2);shop.importShopSnapshot(s,a.id,snapshot({products:[]}));assert.equal(s.list('products').length,2);}finally{s.close();}
});
test('invalid and duplicate records reject the entire import before any writes', () => {
  for(const product of [{productId:'p-2',name:''},{...snapshot().products[0],productId:'p-2',url:'javascript:alert(1)'},snapshot().products[0]]){
    const s=new AppStore();try{const a=s.createAccount({name:'店主'});assert.throws(()=>shop.importShopSnapshot(s,a.id,snapshot({products:[snapshot().products[0],product]})));assert.equal(s.list('products').length,0);}finally{s.close();}
  }
});
test('incomplete or unidentified shop snapshots fail closed; unknown status remains unknown', () => {
  const s=new AppStore();try{const a=s.createAccount({name:'店主'});assert.throws(()=>shop.importShopSnapshot(s,a.id,snapshot({shopId:''})));assert.throws(()=>shop.importShopSnapshot(s,a.id,snapshot({complete:false})));const result=shop.importShopSnapshot(s,a.id,snapshot({products:[{productId:'p-1',name:'商品'}]}));assert.equal(result.created,1);assert.equal(s.list('products')[0].shopSource.status,'unknown');}finally{s.close();}
});
test('storage failure rolls back all products and import event',()=>{
  const s=new AppStore();try{
    const a=s.createAccount({name:'店主'}),save=s.save.bind(s);let count=0;
    s.save=(kind,value)=>{if(kind==='products'&&++count===3)throw Error('disk failure');return save(kind,value);};
    assert.throws(()=>shop.importShopSnapshot(s,a.id,snapshot({products:[snapshot().products[0],{...snapshot().products[0],productId:'p-2'}]})),/disk failure/);
    assert.equal(s.list('products').length,0);assert.equal(s.list('events').filter(e=>e.type==='shop.import').length,0);
  }finally{s.close();}
});
