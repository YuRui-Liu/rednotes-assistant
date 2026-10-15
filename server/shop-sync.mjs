import { AppError } from './store.mjs';
import { randomUUID } from 'node:crypto';

const invalid = message => {throw new AppError(message,'SHOP_DATA',502);};
const text = (v,label) => typeof v==='string' && v.trim() ? v.trim() : invalid(`店铺数据缺少${label}`);
function url(value) {
  if(!value)return '';
  try {const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href;}
  catch {invalid('店铺商品包含无效链接');}
}
export function validateShopSnapshot(input) {
  if(!input || input.complete!==true)invalid('店铺商品未完整读取，请重新检测');
  const shopId=text(input.shopId,'店铺 ID'), shopName=text(input.shopName,'店铺名称');
  if(!Array.isArray(input.products)||input.products.length>10000)invalid('店铺商品列表格式错误或数量超限');
  if(typeof input.fetchedAt!=='string'||!Number.isFinite(Date.parse(input.fetchedAt)))invalid('店铺数据缺少读取时间');
  const seen=new Set();
  const products=input.products.map(p=>{
    if(!p || typeof p!=='object')invalid('商品数据格式错误');
    const productId=text(p.productId,'商品 ID');
    if(seen.has(productId))invalid('商品列表存在重复 ID，请重新检测');
    seen.add(productId);
    if(p.images!==undefined&&(!Array.isArray(p.images)||p.images.length>30))invalid('商品图片格式错误');
    if(p.facts!==undefined&&typeof p.facts!=='string')invalid('商品参数格式错误');
    return {productId,name:text(p.name,'商品名称'),url:url(p.url),images:(p.images||[]).map(url).filter(Boolean),facts:p.facts||'',status:['on_sale','off_shelf','sold_out','pending'].includes(p.status)?p.status:'unknown'};
  });
  return {shopId,shopName,fetchedAt:input.fetchedAt,products,complete:true};
}

export function importShopSnapshot(store,accountId,input) {
  store.get('accounts',accountId);
  const snapshot=validateShopSnapshot(input);
  let created=0,updated=0;
  const existing=new Map(store.list('products').filter(p=>p.shopSource?.shopId===snapshot.shopId).map(p=>[p.shopSource.productId,p]));
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for(const item of snapshot.products) {
      const shopSource={...item,shopId:snapshot.shopId,shopName:snapshot.shopName,accountId,fetchedAt:snapshot.fetchedAt};
      const current=existing.get(item.productId);
      if(current) {
        store.save('products',{...current,shopSource});
        updated++;
      } else {
        const product=store.createProduct({...item,confirmed:false});
        store.save('products',{...product,shopSource});
        created++;
      }
    }
    store.event('shop.import',{accountId,shopId:snapshot.shopId,created,updated,fetchedAt:snapshot.fetchedAt});
    store.db.exec('COMMIT');
  } catch(error) {store.db.exec('ROLLBACK');throw error;}
  return {created,updated,total:snapshot.products.length,shopName:snapshot.shopName};
}

export class ShopSync {
  constructor(store,reader) {this.store=store;this.reader=reader;this.previews=new Map();this.reading=new Set();}
  connection(account) {return JSON.stringify([account.mcpUrl,account.platformUserId]);}
  async preview(accountId) {
    const account=this.store.get('accounts',accountId);
    if(!this.reader)throw new AppError('尚未连接店铺商品读取服务。小红书内容账号登录不能代替店铺后台授权，请先连接店铺。','SHOP_CONNECTION_REQUIRED',409);
    if(this.reading.has(accountId))throw new AppError('正在检测该账号店铺，请稍候','BUSY',409);
    this.reading.add(accountId);
    try {
      const connection=this.connection(account);
      const data=validateShopSnapshot(await this.reader(account));
      if(connection!==this.connection(this.store.get('accounts',accountId)))throw new AppError('账号连接已变化，请重新检测店铺','SHOP_CHANGED',409);
      for(const [token,p] of this.previews)if(p.expiresAt<=Date.now()||p.accountId===accountId)this.previews.delete(token);
      const token=randomUUID();
      if(this.previews.size>=50)this.previews.delete(this.previews.keys().next().value);
      this.previews.set(token,{accountId,connection,data,expiresAt:Date.now()+10*60*1000});
      const existing=new Set(this.store.list('products').filter(p=>p.shopSource?.shopId===data.shopId).map(p=>p.shopSource.productId));
      return {...data,token,products:data.products.map(p=>({...p,imported:existing.has(p.productId)}))};
    } finally {this.reading.delete(accountId);}
  }
  import(accountId,token) {
    const account=this.store.get('accounts',accountId),preview=this.previews.get(token);
    if(!preview||preview.accountId!==accountId||preview.expiresAt<=Date.now()||preview.connection!==this.connection(account))throw new AppError('检测结果已失效，请重新检测店铺','SHOP_PREVIEW_EXPIRED',409);
    const result=importShopSnapshot(this.store,accountId,preview.data);
    this.previews.delete(token);
    return result;
  }
}
