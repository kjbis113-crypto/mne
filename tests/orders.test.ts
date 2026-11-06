import assert from 'node:assert/strict';
import test from 'node:test';
import orders, { config } from '../netlify/functions/orders';

test('retired intake cannot bypass payment and consent validation or write to Sheets', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Retired intake must not forward customer data'); });
  for (const method of ['GET', 'POST']) {
    for (const origin of ['https://mne.example', 'https://other.example']) {
      const response = await orders(new Request('https://mne.example/api/orders', { method, headers: { Origin: origin } }));
      assert.equal(response.status, 410);
      assert.equal((await response.json()).next, '/order');
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal((await orders(new Request('https://mne.example/api/orders', { method: 'DELETE' }))).status, 405);
  assert.equal(config.path, '/api/orders');
  assert.ok(config.rateLimit);
});
