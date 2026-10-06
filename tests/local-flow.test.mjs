import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/http.mjs';

test('real HTTP manual workflow preserves two approval stages and invalidates edited content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rednote-flow-'));
  const app = createApp({
    dbPath: join(dir, 'test.sqlite'),
    enableServices: true,
    serviceOptions: { assetsDir: join(dir, 'assets'), env: {} },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, body, method = 'POST') {
    const response = await fetch(base + '/api/' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload.data;
  }
  try {
    const asset = await request('assets', {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
    });
    const product = await request('products', {
      name: '测试商品', facts: '测试资料，仅用于本地验收',
      images: [asset.url], confirmed: true,
    });
    const account = await request('accounts', { name: '本地测试账号' });
    const batch = await request('batches', { productId: product.id, accountId: account.id });
    const [topic] = await request(`batches/${batch.id}/topics`, { titles: ['商品细节说明'] });
    await request(`topics/${topic.id}`, {
      imagePlan: [{ role: '细节', prompt: '展示已确认的商品细节' }],
      imageCountReason: '手工采用一张已上传素材',
    }, 'PATCH');
    await request(`topics/${topic.id}/confirm`, {});
    await request(`batches/${batch.id}/generate`, { provider: 'manual', textProvider: 'manual' });
    let state = await request('state', undefined, 'GET');
    const note = state.notes[0];
    assert.equal(note.approvedRevision, null);
    const at = new Date(Date.now() + 86400000).toISOString();
    const unapproved = await fetch(base + '/api/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ noteId: note.id, accountId: account.id, mode: 'normal', scheduledAt: at }),
    });
    assert.equal(unapproved.status, 400);
    await request(`notes/${note.id}/approve`, { mode: 'normal' });
    const schedule = await request('schedules', {
      noteId: note.id, accountId: account.id, mode: 'normal', scheduledAt: at,
    });
    assert.equal(schedule.status, 'pending');
    await request(`schedules/${schedule.id}/approve`, {});
    await request(`notes/${note.id}`, { body: '人工修改后的测试正文' }, 'PATCH');
    state = await request('state', undefined, 'GET');
    assert.equal(state.notes[0].approvedRevision, null);
    assert.equal(state.schedules[0].status, 'invalidated');
    assert.equal(state.jobs.length, 0);
    const image = await fetch(base + asset.url);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/png/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
