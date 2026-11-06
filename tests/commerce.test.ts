import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { CONSENT_VERSION, type CreateOrderInput } from '../app/commerce-contract';
import { createCommerceHandler } from '../netlify/functions/commerce';
import { CommerceService, publicConfig } from '../netlify/lib/commerce-service';
import { tossProvider, type Environment, type PaymentProvider, type ProviderPayment } from '../netlify/lib/commerce-payment';
import type { CommerceStorage, Versioned } from '../netlify/lib/commerce-storage';
import { CommerceFailure, externalCode, validatePhoto } from '../netlify/lib/commerce-validation';

class MemoryStorage implements CommerceStorage {
  data = new Map<string, Versioned<unknown>>();
  serial = 0;
  async get<T>(key: string): Promise<Versioned<T> | null> { return structuredClone(this.data.get(key) ?? null) as Versioned<T> | null; }
  async put(key: string, value: unknown, condition: { onlyIfNew: true } | { onlyIfMatch: string }) {
    const prior = this.data.get(key);
    if ('onlyIfNew' in condition ? Boolean(prior) : prior?.etag !== condition.onlyIfMatch) return false;
    this.data.set(key, { data: structuredClone(value), etag: String(++this.serial) });
    return true;
  }
  async list() { return { keys: [...this.data.keys()].filter(key => key.startsWith('records/')) }; }
  async delete(key: string) { this.data.delete(key); }
}
const origin = 'https://mne.example';
const env: Environment = { MNE_PAYMENT_ENABLED: 'true', MNE_TOSS_CLIENT_KEY: 'test_ck_fixture', MNE_TOSS_SECRET_KEY: 'test_sk_fixture', MNE_ADMIN_TOKEN: 'fixture-admin-token-with-at-least-32-characters' };
const liveEnv: Environment = { ...env, MNE_TOSS_CLIENT_KEY: 'live_ck_fixture', MNE_TOSS_SECRET_KEY: 'live_sk_fixture', MNE_POLICIES_READY: 'true', MNE_MERCHANT_INFO: JSON.stringify({ businessName: 'TEST ONLY', representative: 'TEST ONLY', businessNumber: '000-00-00000', address: 'TEST ONLY', supportEmail: 'test@example.invalid' }) };
const shipping = { recipientName: '테스트', phone: '01012345678', postcode: '04524', address: '테스트 전용 주소', detail: '배송하지 않음' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF8sAAAAASUVORK5CYII=', 'base64');
const photo = () => new File([png], 'test.png', { type: 'image/png' });
function draft(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return { route: 'direct', requestId: randomUUID(), accessToken: randomBytes(32).toString('base64url'), draft: { description: '자동 검증 전용 기억', preferredNote: 'Woody', customerName: '테스트이름', phone: '01012345678' }, consents: { customOrder: true, privacy: true, terms: true, marketing: false, version: CONSENT_VERSION }, shipping, ...overrides };
}
function payment(orderId: string, changes: Partial<ProviderPayment> = {}): ProviderPayment { return { orderId, paymentKey: 'fixture-payment-key', totalAmount: 35000, balanceAmount: 35000, currency: 'KRW', status: 'DONE', approvedAt: '2026-11-06T00:00:00Z', ...changes }; }
const noNetwork = (async () => { throw new Error('Network calls are forbidden in this test.'); }) as typeof fetch;
function fixture(provider: PaymentProvider | null = null, settings = env, fetcher = noNetwork) {
  const storage = new MemoryStorage();
  const service = new CommerceService({ storage, env: settings, payment: provider, fetcher });
  const handler = createCommerceHandler({ storage, env: settings, payment: provider, fetcher });
  return { storage, service, handler };
}
function request(value: unknown, options: { origin?: string; auth?: string } = {}) {
  return new Request(origin + '/api/commerce', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: options.origin ?? origin, ...(options.auth ? { Authorization: options.auth } : {}) }, body: JSON.stringify(value) });
}
function createRequest(value: CreateOrderInput, file = photo()) {
  const form = new FormData(); form.set('action', 'create'); form.set('payload', JSON.stringify(value)); form.set('photo', file);
  return new Request(origin + '/api/commerce', { method: 'POST', headers: { Origin: origin }, body: form });
}
const rejectsCode = (code: string) => (error: unknown) => error instanceof CommerceFailure && error.code === code;

test('direct checkout fails closed, validates required consents and real image signatures', async () => {
  const unconfigured = fixture(null, {});
  assert.equal(publicConfig({}).paymentReady, false);
  assert.equal(publicConfig({ ...liveEnv, MNE_POLICIES_READY: 'false' }).paymentReady, false);
  assert.equal(publicConfig({ ...liveEnv, MNE_MERCHANT_INFO: '{}' }).paymentReady, false);
  assert.equal((await unconfigured.handler(createRequest(draft()))).status, 503);
  const f = fixture();
  const missing = draft(); missing.consents.customOrder = false;
  const consentResponse = await f.handler(createRequest(missing));
  assert.equal(consentResponse.status, 400);
  assert.equal((await consentResponse.json()).code, 'CONSENT_REQUIRED');
  assert.equal((await f.handler(createRequest(draft(), new File(['<svg>bad</svg>'], 'photo.png', { type: 'image/png' })))).status, 400);
  const valid = draft(); const response = await f.handler(createRequest(valid));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.amount, 35000);
  assert.equal(result.completed, false);
  assert.equal(result.order.paymentState, 'pending');
  assert.equal(result.order.notificationStatus, 'not_requested');
  assert.equal((await f.handler(createRequest(valid))).status, 200);
  assert.equal([...f.storage.data.keys()].filter(key => key.startsWith('records/')).length, 1);
  const record = JSON.stringify([...f.storage.data.values()]);
  assert.equal(record.includes(valid.accessToken), false, 'raw access tokens must never be stored');
  valid.draft.description = 'changed after persistence';
  assert.equal((await f.handler(createRequest(valid))).status, 409);
});

test('public config and customer operations never disclose secret, full identity or photo', async () => {
  const f = fixture(), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
  const config = await (await f.handler(new Request(origin + '/api/commerce'))).json();
  assert.equal(JSON.stringify(config).includes('test_sk_fixture'), false);
  assert.equal(JSON.stringify(config).includes(env.MNE_ADMIN_TOKEN!), false);
  const lookup = await f.service.lookup(created.orderId, input.draft.phone);
  const value = JSON.stringify(lookup);
  for (const sensitive of [input.accessToken, input.draft.phone, input.draft.customerName, input.draft.description, shipping.address, png.toString('base64')]) assert.equal(value.includes(sensitive), false);
  await assert.rejects(f.service.resume(created.orderId, randomBytes(32).toString('base64url')), rejectsCode('INVALID_ACCESS'));
  await assert.rejects(f.service.lookup(created.orderId, '01099999999'), rejectsCode('ORDER_NOT_FOUND'));
});

test('same-origin and admin authentication are enforced before any data access', async () => {
  const f = fixture();
  assert.equal((await f.handler(request({ action: 'lookup' }, { origin: 'https://evil.example' }))).status, 403);
  const noOrigin = new Request(origin + '/api/commerce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"lookup"}' });
  assert.equal((await f.handler(noOrigin)).status, 403);
  assert.equal((await f.handler(request({ action: 'admin-list' }))).status, 401);
  assert.equal((await f.handler(request({ action: 'admin-list' }, { auth: 'Bearer wrong' }))).status, 401);
  assert.equal((await f.handler(request({ action: 'admin-list' }, { auth: `Bearer ${env.MNE_ADMIN_TOKEN}` }))).status, 200);
  const absent = fixture(null, {});
  assert.equal((await absent.handler(request({ action: 'admin-list' }, { auth: `Bearer ${env.MNE_ADMIN_TOKEN}` }))).status, 401);
  assert.equal((await f.handler(new Request(origin + '/api/commerce', { method: 'DELETE' }))).status, 405);
  assert.equal((await f.handler(request({ action: 'unknown' }))).status, 400);
});

test('external code redemption is atomic, contact-bound, case-insensitive and single-use', async () => {
  const f = fixture();
  const { code } = await f.service.issueCode({ customerName: '외부 테스트', phone: shipping.phone, channel: '테스트', externalOrderReference: 'fixture-order-1', shipping });
  assert.match(code, /^MNE-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(externalCode(code.toLowerCase()), code);
  assert.equal((await f.service.verifyCode(code.toLowerCase(), '010-1234-5678')).completed, false);
  await assert.rejects(f.service.verifyCode(code, '01099999999'), rejectsCode('INVALID_CODE'));
  const first = draft({ route: 'external', code, shipping: undefined }), second = draft({ route: 'external', code: code.toLowerCase(), shipping: undefined });
  const p = await validatePhoto(photo());
  const results = await Promise.all([f.service.create(first, p), f.service.create(second, p)]);
  assert.equal(results[0].orderId, results[1].orderId);
  assert.equal(results.filter(r => r.accessToken).length, 1);
  assert.ok(results.every(r => r.completed && r.order.paymentState === 'prepaid'));
  assert.equal([...f.storage.data.keys()].filter(key => key.startsWith('records/')).length, 1);
  assert.equal((await f.service.verifyCode(code, shipping.phone)).completed, true);
  assert.equal((await f.service.lookup(code.toLowerCase(), shipping.phone)).order.orderId, results[0].orderId);
  const admin = await f.service.adminList();
  assert.equal(admin.orders.length, 1);
  assert.deepEqual(admin.orders[0].shipping, { ...shipping, memo: '' });
  const changed = await f.service.adminUpdate({ orderId: results[0].orderId, status: '시향지발송', tracking: { carrier: 'TEST', number: 'NOT-A-REAL-PARCEL' } });
  assert.equal(changed.order.status, '시향지발송');
  assert.equal((await f.service.adminPhoto(results[0].orderId)).headers.get('Content-Type'), 'image/png');
});

test('payment mismatches never cause confirmation; test payments never enter fulfillment', async () => {
  let confirmCalls = 0;
  const provider: PaymentProvider = { mode: 'test', find: async () => null, confirm: async id => { confirmCalls++; return payment(id); } };
  const f = fixture(provider), input = draft(), result = await f.service.create(input, await validatePhoto(photo()));
  const args = { orderId: result.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 };
  await assert.rejects(f.service.confirm({ ...args, amount: 1 }), rejectsCode('PAYMENT_MISMATCH'));
  assert.equal(confirmCalls, 0);
  const paid = await f.service.confirm(args);
  assert.equal(paid.completed, true);
  assert.equal(paid.mode, 'test');
  assert.equal((await f.service.confirm(args)).order.paymentState, 'paid');
  assert.equal(confirmCalls, 1);
  await assert.rejects(f.service.confirm({ ...args, paymentKey: 'another-payment' }), rejectsCode('PAYMENT_MISMATCH'));
  assert.deepEqual((await f.service.adminList()).orders, []);
  await assert.rejects(f.service.adminUpdate({ orderId: result.orderId, status: '제작중' }), rejectsCode('UNPAID_ORDER'));
  assert.equal((await f.service.paymentCancel(args)).order.paymentState, 'paid', 'browser cancel must not fake a refund');
});

test('a timeout after charge reconciles by order before retry and creates one paid order', async () => {
  let charged = false, confirmCalls = 0, lookupCalls = 0;
  const provider: PaymentProvider = { mode: 'test', find: async id => { lookupCalls++; return charged ? payment(id) : null; }, confirm: async () => { confirmCalls++; charged = true; throw new Error('timeout after accepted charge'); } };
  const f = fixture(provider), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
  const args = { orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 };
  assert.equal((await f.service.confirm(args)).completed, true);
  assert.equal((await f.service.confirm(args)).completed, true);
  assert.equal(confirmCalls, 1); assert.equal(lookupCalls, 2);
});

test('concurrent confirmation requests serialize and ambiguous failure remains recoverable', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const provider: PaymentProvider = { mode: 'test', find: async () => null, confirm: async id => { calls++; await gate; return payment(id); } };
  const f = fixture(provider), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
  const args = { orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 };
  const one = f.service.confirm(args);
  while (calls === 0) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.confirm(args), rejectsCode('PAYMENT_PROCESSING'));
  release(); await one; assert.equal(calls, 1);
  const brokenProvider: PaymentProvider = { mode: 'test', find: async () => null, confirm: async () => { throw new CommerceFailure('PAYMENT_UNCERTAIN', 'not confirmed', 503, true); } };
  const g = fixture(brokenProvider), another = draft(), pending = await g.service.create(another, await validatePhoto(photo()));
  await assert.rejects(g.service.confirm({ ...args, orderId: pending.orderId, accessToken: another.accessToken }), rejectsCode('PAYMENT_UNCERTAIN'));
  assert.equal((await g.service.resume(pending.orderId, another.accessToken)).order.paymentState, 'pending');
});

test('provider cancellation, partial refund and mismatched currency cannot mark paid', async () => {
  for (const changes of [{ status: 'CANCELED', balanceAmount: 0 }, { status: 'PARTIAL_CANCELED', balanceAmount: 30000 }, { currency: 'USD' }, { totalAmount: 1 }, { balanceAmount: 0 }]) {
    let calls = 0;
    const provider: PaymentProvider = { mode: 'test', find: async id => payment(id, changes), confirm: async id => { calls++; return payment(id, changes); } };
    const f = fixture(provider), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
    await assert.rejects(f.service.confirm({ orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 }));
    assert.equal(calls, 0);
    assert.notEqual((await f.service.lookup(created.orderId, input.draft.phone)).order.paymentState, 'paid');
  }
});

test('sheet outage cannot undo paid receipt, unpaid/test orders never sync, safe QA code is removable', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('sheet unavailable'); }) as typeof fetch;
  const settings = { ...liveEnv, MNE_ORDER_WEBHOOK_URL: 'https://script.google.com/macros/s/test-fixture/exec', MNE_ORDER_SECRET: 'fixture-secret' };
  const provider: PaymentProvider = { mode: 'live', find: async () => null, confirm: async id => payment(id) };
  const f = fixture(provider, settings, fetcher), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
  assert.equal(calls, 0);
  const result = await f.service.confirm({ orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 });
  assert.equal(result.completed, true); assert.equal(calls, 1);
  assert.equal((await f.service.adminList()).orders[0].sheetSync, 'failed');
  await assert.rejects(f.service.deleteTest(created.orderId), rejectsCode('NOT_TEST_ORDER'));
  const { code } = await f.service.issueCode({ customerName: 'QA', phone: shipping.phone, channel: 'QA', externalOrderReference: 'fixture-qa-1', shipping, testOnly: true });
  const qa = draft({ route: 'external', code, shipping: undefined });
  const testOrder = await f.service.create(qa, await validatePhoto(photo()));
  assert.equal(testOrder.mode, 'test'); assert.equal(calls, 1);
  assert.equal(testOrder.order.notificationStatus, 'not_requested');
  await f.service.deleteTest(testOrder.orderId);
  await assert.rejects(f.service.lookup(testOrder.orderId, shipping.phone), rejectsCode('ORDER_NOT_FOUND'));
  await assert.rejects(f.service.verifyCode(code, shipping.phone), rejectsCode('INVALID_CODE'));
});

test('Toss adapter uses server secret and stable idempotency key, never an amount from browser', async () => {
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return String(url).includes('/orders/') ? Response.json({ code: 'NOT_FOUND_PAYMENT' }, { status: 404 }) : Response.json(payment('MNE-D-fixture'));
  }) as typeof fetch;
  const provider = tossProvider(env, fetcher)!;
  assert.equal(await provider.find('MNE-D-fixture'), null);
  await provider.confirm('MNE-D-fixture', 'fixture-payment-key', 35000);
  assert.equal(captured[1].url, 'https://api.tosspayments.com/v1/payments/confirm');
  const headers = new Headers(captured[1].init?.headers);
  assert.equal(headers.get('Authorization'), 'Basic ' + Buffer.from('test_sk_fixture:').toString('base64'));
  assert.equal(headers.get('Idempotency-Key'), 'mne-confirm-MNE-D-fixture');
  assert.deepEqual(JSON.parse(String(captured[1].init?.body)), { orderId: 'MNE-D-fixture', paymentKey: 'fixture-payment-key', amount: 35000 });
});

test('confirmed direct and external orders remain compatible with deployed legacy Apps Script', async () => {
  const received: Array<{ orderNumber: string; fields: { description: string; preferredNote: string; customerName: string; contact: string; photoLink: string }; photo: { type: string; base64: string } }> = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const value = JSON.parse(String(init?.body));
    // These checks mirror the existing integrations/google-orders.gs receiver contract.
    assert.match(value.orderNumber, /^MNE-[0-9a-f-]{36}$/);
    assert.ok(['Fruity', 'Floral', 'Fresh', 'Woody', 'Balsamic'].includes(value.fields.preferredNote));
    assert.ok(value.fields.description.length < 49000);
    assert.ok(value.fields.customerName && value.fields.contact);
    assert.equal(value.fields.photoLink, ''); assert.equal(value.photo.type, 'image/png');
    assert.ok(Buffer.from(value.photo.base64, 'base64').length > 0);
    received.push(value);
    return Response.json({ ok: true, orderNumber: value.orderNumber, receivedAt: new Date().toISOString() });
  }) as typeof fetch;
  const settings = { ...liveEnv, MNE_ORDER_WEBHOOK_URL: 'https://script.google.com/macros/s/test-fixture/exec', MNE_ORDER_SECRET: 'fixture-secret' };
  const provider: PaymentProvider = { mode: 'live', find: async () => null, confirm: async id => payment(id) };
  const f = fixture(provider, settings, fetcher), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
  await f.service.confirm({ orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 });
  const { code } = await f.service.issueCode({ customerName: '외부 주문', phone: shipping.phone, channel: '외부 구매', externalOrderReference: 'fixture-external-1', shipping });
  const external = await f.service.create(draft({ route: 'external', code, shipping: undefined }), await validatePhoto(photo()));
  assert.equal(received.length, 2); assert.notEqual(received[0].orderNumber, received[1].orderNumber);
  for (const [index, id] of [created.orderId, external.orderId].entries()) {
    assert.ok(received[index].fields.description.includes(id));
    assert.ok(received[index].fields.description.includes(shipping.address));
    assert.ok(received[index].fields.description.includes(CONSENT_VERSION));
    assert.ok(received[index].fields.description.includes('35000 KRW'));
    assert.equal((await f.service.syncSheet(id)).synced, true);
  }
  assert.equal(received.length, 2, 'successful syncs are not duplicated');
});

test('durable rate limits cannot be bypassed by simultaneous requests', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.rateLimit('same-client', 'lookup', 3)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason instanceof CommerceFailure && r.reason.status === 429));
});

test('admin can recover a payment after browser session loss using read-only provider lookup', async () => {
  let paid = false, finds = 0, confirms = 0;
  const provider: PaymentProvider = { mode: 'live', find: async id => { finds++; return paid ? payment(id) : null; }, confirm: async id => { confirms++; return payment(id); } };
  const f = fixture(provider, liveEnv), input = draft();
  await f.service.create(input, await validatePhoto(photo()));
  // A client that lost create's response still has its pre-generated request ID and token.
  const recoveredId = `MNE-D-${input.requestId}`;
  assert.equal((await f.service.resume(recoveredId, input.accessToken)).order.paymentState, 'pending');
  const pending = (await f.service.adminList()).orders;
  assert.equal(pending.length, 1); assert.equal(pending[0].hasPhoto, false);
  assert.equal((await f.handler(request({ action: 'admin-reconcile', orderId: recoveredId }))).status, 401);
  assert.equal((await f.service.adminReconcile(recoveredId)).order.paymentState, 'pending');
  paid = true; // The provider accepted the charge, but the browser callback/session was lost.
  const response = await f.handler(request({ action: 'admin-reconcile', orderId: recoveredId }, { auth: `Bearer ${env.MNE_ADMIN_TOKEN}` }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order.paymentState, 'paid');
  assert.equal(confirms, 0); assert.equal(finds, 2);
  assert.equal((await f.service.adminList()).orders[0].hasPhoto, true);
  const testMode = fixture({ ...provider, mode: 'test' });
  const testOrder = await testMode.service.create(draft(), await validatePhoto(photo()));
  await assert.rejects(testMode.service.adminReconcile(testOrder.orderId), rejectsCode('INVALID_RECONCILIATION'));
  assert.deepEqual((await testMode.service.adminList()).orders, []);
});

test('every direct fulfillment mutation revalidates refunds and blocks canceled or partially refunded orders', async () => {
  for (const refund of [{ status: 'CANCELED', balanceAmount: 0 }, { status: 'PARTIAL_CANCELED', balanceAmount: 30000 }]) {
    let observed: Partial<ProviderPayment> | null = null, finds = 0;
    const provider: PaymentProvider = { mode: 'live', find: async id => { finds++; return observed ? payment(id, observed) : null; }, confirm: async id => { observed = {}; return payment(id); } };
    const f = fixture(provider, liveEnv), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
    await f.service.confirm({ orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 });
    assert.equal((await f.service.adminUpdate({ orderId: created.orderId, status: '분석완료' })).order.status, '분석완료');
    const beforeRefund = finds;
    observed = refund;
    await assert.rejects(f.service.adminUpdate({ orderId: created.orderId, status: '제작중' }), rejectsCode('UNPAID_ORDER'));
    assert.equal(finds, beforeRefund + 1);
    const held = (await f.service.adminList()).orders[0];
    assert.equal(held.status, '분석완료'); assert.equal(held.hasPhoto, false);
    assert.equal(held.paymentState, refund.status === 'CANCELED' ? 'canceled' : 'review');
    await assert.rejects(f.service.adminPhoto(created.orderId), rejectsCode('UNPAID_ORDER'));
    observed = {}; // Even an older DONE snapshot cannot undo a known refund.
    assert.notEqual((await f.service.adminReconcile(created.orderId)).order.paymentState, 'paid');
    await assert.rejects(f.service.adminUpdate({ orderId: created.orderId, status: '본품발송' }), rejectsCode('UNPAID_ORDER'));
  }
});

test('uncertain or mismatched provider observations hold fulfillment until a valid read-only reconciliation', async () => {
  for (const outcome of ['missing', 'error', 'mismatch', 'unexpected-status', 'not-completed']) {
    let current = 'missing';
    const provider: PaymentProvider = { mode: 'live', find: async id => {
      if (current === 'missing') return null;
      if (current === 'error') throw new CommerceFailure('PAYMENT_UNCERTAIN', 'timeout', 503, true);
      return payment(id, current === 'mismatch' ? { totalAmount: 1 } : current === 'unexpected-status' ? { status: 'UNKNOWN' } : current === 'not-completed' ? { status: 'READY' } : {});
    }, confirm: async id => { current = 'paid'; return payment(id); } };
    const f = fixture(provider, liveEnv), input = draft(), created = await f.service.create(input, await validatePhoto(photo()));
    await f.service.confirm({ orderId: created.orderId, accessToken: input.accessToken, paymentKey: 'fixture-payment-key', amount: 35000 });
    current = outcome;
    await assert.rejects(f.service.adminUpdate({ orderId: created.orderId, status: '시향지발송' }));
    const held = (await f.service.adminList()).orders[0];
    assert.equal(held.paymentState, 'review', outcome); assert.equal(held.status, '접수');
    current = 'paid';
    assert.equal((await f.service.adminReconcile(created.orderId)).order.paymentState, 'paid');
    assert.equal((await f.service.adminUpdate({ orderId: created.orderId, status: '제작중' })).order.status, '제작중');
  }
});

test('disabling new payments still permits provider reads but cannot initiate confirmation', async () => {
  let calls = 0;
  const provider = tossProvider({ ...liveEnv, MNE_PAYMENT_ENABLED: 'false' }, (async () => { calls++; return Response.json(payment('fixture')); }) as typeof fetch)!;
  assert.equal(provider.mode, 'live');
  assert.equal((await provider.find('fixture'))?.status, 'DONE');
  await assert.rejects(provider.confirm('fixture', 'fixture-payment-key', 35000), rejectsCode('PAYMENT_UNAVAILABLE'));
  assert.equal(calls, 1);
});

test('external purchase issuance is idempotent across concurrency and lost responses, with recoverable admin listing', async () => {
  const f = fixture(), payload = { customerName: '코드 테스트', phone: shipping.phone, channel: 'Store', externalOrderReference: 'ORDER-123', shipping };
  await assert.rejects(f.service.issueCode({ ...payload, externalOrderReference: '' }));
  const issued = await Promise.all(Array.from({ length: 8 }, () => f.service.issueCode(payload)));
  assert.equal(new Set(issued.map(result => result.code)).size, 1);
  assert.equal((await f.service.issueCode({ ...payload, channel: 'store', externalOrderReference: 'order-123' })).code, issued[0].code);
  for (const changed of [{ phone: '01099999999' }, { shipping: { ...shipping, detail: '다른 주소' } }, { testOnly: true }]) await assert.rejects(f.service.issueCode({ ...payload, ...changed }), rejectsCode('CODE_ISSUANCE_CONFLICT'));
  const unsubmitted = await f.service.adminListCodes();
  assert.equal(unsubmitted.codes.length, 1); assert.equal(unsubmitted.codes[0].completed, false);
  assert.equal((await f.handler(request({ action: 'admin-list-codes' }))).status, 401);
  const order = await f.service.create(draft({ route: 'external', code: issued[0].code, shipping: undefined }), await validatePhoto(photo()));
  assert.equal((await f.service.adminListCodes()).codes[0].orderId, order.orderId);
  assert.equal((await f.service.issueCode(payload)).code, issued[0].code, 'used codes do not grant a second fulfillment on retry');
  const originalPut = f.storage.put.bind(f.storage);
  let lost = true;
  f.storage.put = async (key, value, condition) => {
    const written = await originalPut(key, value, condition);
    if (lost && written && key.startsWith('records/external/')) { lost = false; throw new Error('lost response after durable write'); }
    return written;
  };
  const another = { ...payload, externalOrderReference: 'ORDER-124' };
  await assert.rejects(f.service.issueCode(another));
  const retried = await f.service.issueCode(another);
  const codes = (await f.service.adminListCodes()).codes;
  assert.equal(codes.length, 2); assert.ok(codes.some(code => code.code === retried.code && !code.completed));
  await f.service.issueCode({ ...payload, externalOrderReference: 'TEST-ONLY', testOnly: true });
  assert.equal((await f.service.adminListCodes()).codes.length, 2, 'test codes never enter the live issuance queue');
});
