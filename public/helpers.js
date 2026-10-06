export const escapeHTML = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeURL(value) { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
export function assetURL(value) { return /^\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value || '') ? value : ''; }
export function beijingInput(value) { const ms = Date.parse(value); return Number.isFinite(ms) ? new Date(ms + 8 * 3600000).toISOString().slice(0,16) : ''; }
export function fromBeijing(value) { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw Error('请填写完整的北京时间'); const d = new Date(value + ':00+08:00'); if (!Number.isFinite(d.getTime()) || beijingInput(d.toISOString()) !== value) throw Error('发布时间无效'); return d.toISOString(); }
export function displayTime(value) { return beijingInput(value).replace('T',' ') || '未记录'; }
export function pendingFor(schedules, note) { return schedules.find(s => s.noteId === note.id && s.revision === note.revision && s.status === 'pending'); }
export function activeFor(schedules, note) { return schedules.find(s => s.noteId === note.id && s.revision === note.revision && ['authorized','running','unknown','succeeded'].includes(s.status)); }
export function allowHashNavigation({ busy = false, dirty, currentHash, nextHash, confirmDiscard }) { if (currentHash === nextHash) return true; if (busy) return false; return !dirty || confirmDiscard(); }
export function sameUploadOwner(start, current) { return start.page === current.page && start.noteId === current.noteId && start.dialogToken === current.dialogToken; }
export function originalPlanSlots(topic) { return (topic?.imagePlan || []).map((item, slot) => ({ slot, role: item.role, prompt: item.prompt })); }
export const statusLabel = value => ({planning:'策划中',pending:'待发布授权',authorized:'已授权待发布',running:'执行中',unknown:'结果待核对',succeeded:'已完成',failed:'失败',missed:'错过时间',invalidated:'授权已失效',cancelled:'已取消',canceled:'已取消',draft:'待审核',approved:'已批准',queued:'排队中',submitting:'正在提交',submitted:'已提交',processing:'生成中',writing:'撰写中',stale:'未写入当前版本',abandoned:'已放弃'}[value] || value || '未开始');
