import { escapeHTML as e, displayTime } from './helpers.js';
export const shopStatus = value => ({on_sale:'在售',off_shelf:'已下架',sold_out:'售罄',pending:'审核中'}[value]||'状态未知');
export function shopSourceHTML(product) {
  const s=product.shopSource;
  if(!s)return '';
  return `<div class="notice subtle"><b>${e(s.shopName)} · ${shopStatus(s.status)}</b><br>店铺商品 ID：${e(s.productId)}<br>最近读取：${s.fetchedAt?displayTime(s.fetchedAt):'未记录'}<br>店铺图片与参数需核对；再次同步保留手动编辑的创作资料。</div>`;
}
export function shopPreviewHTML(result) {
  if(!result.products.length)return `<div class="notice">${e(result.shopName)}：店铺暂无商品。</div>`;
  const added=result.products.filter(p=>!p.imported).length;
  return `<p><b>${e(result.shopName)}</b> · 共 ${result.products.length} 件，新增 ${added} 件，更新状态 ${result.products.length-added} 件。</p><div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>商品</th><th>店铺状态</th><th>导入状态</th></tr></thead><tbody>${result.products.map(p=>`<tr><td>${e(p.name)}<small style="display:block">${e(p.productId)}</small></td><td>${shopStatus(p.status)}</td><td>${p.imported?'已导入 · 更新状态':'新商品 · 待核对'}</td></tr>`).join('')}</tbody></table></div><p class="muted">导入店铺图片和可读取参数；已有商品的手动资料会保留。检测结果 10 分钟内有效。</p>`;
}
