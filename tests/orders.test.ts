import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import orders, { config } from '../netlify/functions/orders';

const origin = 'https://mne.example';
const reference = 'MNE-' + randomUUID();
function request(overrides: Record<string, string> = {}, requestOrigin = origin) {
  const data = new FormData();
  const fields = { orderNumber: reference, description: 'Line one\n두 번째 줄', preferredNote: 'Woody', customerName: 'TEST ONLY', contact: 'test@example.invalid', photoLink: 'https://example.invalid/photo.jpg', ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return new Request(origin + '/api/orders', { method: 'POST', headers: { Origin: requestOrigin }, body: data });
}

test('public intake validates, forwards privately, and confirms receipts', async t => {
  const originalURL = process.env.MNE_ORDER_WEBHOOK_URL;
  const originalSecret = process.env.MNE_ORDER_SECRET;
  t.after(() => {
    if (originalURL === undefined) delete process.env.MNE_ORDER_WEBHOOK_URL; else process.env.MNE_ORDER_WEBHOOK_URL = originalURL;
    if (originalSecret === undefined) delete process.env.MNE_ORDER_SECRET; else process.env.MNE_ORDER_SECRET = originalSecret;
  });
  delete process.env.MNE_ORDER_WEBHOOK_URL;
  delete process.env.MNE_ORDER_SECRET;
  assert.deepEqual(await (await orders(new Request(origin + '/api/orders'))).json(), { connected: false });
  assert.equal((await orders(request())).status, 503);
  process.env.MNE_ORDER_WEBHOOK_URL = 'https://script.google.com/macros/s/test-only/exec';
  process.env.MNE_ORDER_SECRET = 'mock-secret-not-a-real-credential';
  assert.equal((await orders(request({}, 'https://evil.example'))).status, 403);
  assert.equal((await orders(request({ preferredNote: 'Invented' }))).status, 400);
  assert.equal((await orders(request({ photoLink: '' }))).status, 400);
  assert.equal((await orders(request({ orderNumber: 'MNE-invalid' }))).status, 400);
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.secret, process.env.MNE_ORDER_SECRET);
    assert.equal(payload.fields.description, 'Line one\n두 번째 줄');
    assert.equal(payload.orderNumber, reference);
    calls++;
    return Response.json({ ok: true, orderNumber: reference, receivedAt: '2026-09-26T00:00:00Z' });
  });
  const response = await orders(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { orderNumber: reference, receivedAt: '2026-09-26T00:00:00Z' });
  assert.equal(calls, 1);
  fetchMock.mock.mockImplementation(async () => Response.json({ ok: false }));
  assert.equal((await orders(request())).status, 502);
  assert.equal(config.path, '/api/orders');
  assert.ok(config.rateLimit);
});
