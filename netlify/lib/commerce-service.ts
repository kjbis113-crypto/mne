import { randomInt, randomUUID } from 'node:crypto';
import { COMMERCE_PRODUCT, FULFILLMENT_STEPS, type AdminCode, type AdminOrder, type CommerceConfig, type CommerceConsents, type CommerceDraft, type FulfillmentStatus, type OrderResult, type OrderSummary, type PaymentMode, type PaymentState, type ShippingAddress } from '../../app/commerce-contract';
import type { CommerceStorage, Versioned } from './commerce-storage';
import { accessToken, CommerceFailure, createInput, equalSecret, externalCode, hash, object, phone, shippingAddress, text, type PhotoData } from './commerce-validation';
import { paymentSettings, verifyPayment, type Environment, type PaymentProvider, type ProviderPayment } from './commerce-payment';

type StoredOrder = {
  orderId: string; requestId: string; tokenHash: string; fingerprint: string; route: 'direct' | 'external';
  draft: CommerceDraft; shipping: ShippingAddress; consents: CommerceConsents & { acceptedAt: string };
  photo: { key: string; type: string }; status: FulfillmentStatus; paymentState: PaymentState;
  paymentMode: PaymentMode; amount: number; receivedAt: string; paidAt?: string; paymentKey?: string;
  lease?: { id: string; until: number }; sheetSync: 'pending' | 'synced' | 'failed';
  syncLease?: { id: string; until: number }; tracking?: { carrier: string; number: string };
  canceledAt?: string; paymentSnapshotAt?: number; paymentHold?: 'refunded' | 'uncertain';
};
type StoredRecord = { kind: 'direct'; order: StoredOrder } | { kind: 'external'; code: string; customerName: string; phone: string; shipping: ShippingAddress; channel: string; externalOrderReference?: string; issuedAt: string; testOnly?: boolean; issuanceKey?: string; issuanceFingerprint?: string; order?: StoredOrder };
type Issuance = { code: string; fingerprint: string };
type OrderEntry = Versioned<StoredRecord> & { key: string; order: StoredOrder };
export type ServiceDependencies = { storage: CommerceStorage; env: Environment; payment: PaymentProvider | null; fetcher: typeof fetch; now?: () => number };

export function publicConfig(env: Environment): CommerceConfig {
  const settings = paymentSettings(env);
  let raw: Record<string, unknown> = {};
  try { raw = object(JSON.parse(env.MNE_MERCHANT_INFO ?? '{}')); } catch { /* Unset merchant details stay unset. */ }
  const merchant = Object.fromEntries(['businessName', 'representative', 'businessNumber', 'commerceNumber', 'address', 'supportPhone', 'supportEmail', 'privacyOfficer'].map(key => [key, typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 500) : ''])) as NonNullable<CommerceConfig['merchant']>;
  const policiesReady = env.MNE_POLICIES_READY === 'true';
  const merchantReady = Boolean(merchant.businessName && merchant.representative && merchant.businessNumber && merchant.address && (merchant.supportPhone || merchant.supportEmail));
  const paymentReady = settings.enabled && (settings.mode === 'test' || (policiesReady && merchantReady));
  return { paymentReady, paymentMode: paymentReady ? settings.mode : 'unconfigured', clientKey: paymentReady ? settings.clientKey : null, orderName: COMMERCE_PRODUCT.name, amount: COMMERCE_PRODUCT.amount, shippingEstimate: env.MNE_SHIPPING_ESTIMATE?.slice(0, 300) || '제작·배송 일정은 주문 확인 후 안내합니다.', supportEmail: merchant.supportEmail || env.MNE_SUPPORT_EMAIL?.slice(0, 200) || '', policiesReady, merchant };
}
const codeKey = (code: string) => `records/external/${hash(code).slice(0, 24)}`;
function orderKey(orderId: unknown): string {
  if (typeof orderId !== 'string') throw new CommerceFailure('ORDER_NOT_FOUND', '주문 정보를 확인해 주세요.', 404);
  if (/^MNE-D-[0-9a-f-]{36}$/.test(orderId)) return `records/direct/${orderId.slice(6)}`;
  if (/^MNE-X-[0-9a-f]{24}$/.test(orderId)) return `records/external/${orderId.slice(6)}`;
  throw new CommerceFailure('ORDER_NOT_FOUND', '주문 정보를 확인해 주세요.', 404);
}
const eligible = (order: StoredOrder) => ['prepaid', 'paid'].includes(order.paymentState) && order.paymentMode === 'live';
function sheetOrderNumber(orderId: string) {
  // The already-deployed Apps Script accepts only the older MNE-UUID format.
  // A deterministic reference keeps its existing duplicate protection working.
  const digest = hash(`mne-sheet:${orderId}`).slice(0, 32);
  return `MNE-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}
function sheetDescription(order: StoredOrder) {
  // The legacy receiver stores these six fields and ignores any new JSON fields.
  // Keep fulfillment-critical information in its existing, safely-written text column.
  return [
    '[MNÉ 웹 주문]', `웹 주문 번호: ${order.orderId}`,
    `상품: ${COMMERCE_PRODUCT.name} ${COMMERCE_PRODUCT.volume}`, `결제 금액: ${order.amount} KRW (배송비 포함)`,
    `결제 확인: ${order.paymentState === 'prepaid' ? '외부 결제 · 관리자 발급 코드 확인' : 'Toss 승인 완료'}`,
    `결제 확인 시각: ${order.paidAt || ''}`, `접수 상태: ${order.status}`,
    `받는 분: ${order.shipping.recipientName}`, `배송 연락처: ${order.shipping.phone}`,
    `우편번호: ${order.shipping.postcode}`, `배송 주소: ${order.shipping.address} ${order.shipping.detail}`,
    `배송 요청: ${order.shipping.memo || ''}`,
    `필수 동의: 주문 제작 취소 안내 / 개인정보 / 이용약관 (${order.consents.version}, ${order.consents.acceptedAt})`,
    `마케팅 수신 동의: ${order.consents.marketing ? '동의' : '미동의'}`,
    '', '[고객이 남긴 기억]', order.draft.description,
  ].join('\n');
}
export class CommerceService {
  private now: () => number;
  constructor(private deps: ServiceDependencies) { this.now = deps.now ?? Date.now; }
  get configuration() { return publicConfig(this.deps.env); }
  private iso() { return new Date(this.now()).toISOString(); }
  private summary(order: StoredOrder): OrderSummary {
    return { orderId: order.orderId, route: order.route, status: order.status, paymentState: order.paymentState, amount: order.amount, currency: 'KRW', productName: COMMERCE_PRODUCT.name, preferredNote: order.draft.preferredNote, customerNameMasked: `${order.draft.customerName.slice(0, 1)}${'*'.repeat(Math.min(5, Math.max(1, order.draft.customerName.length - 1)))}`, phoneMasked: `${order.draft.phone.slice(0, 3)}-****-${order.draft.phone.slice(-4)}`, receivedAt: order.receivedAt, ...(order.paidAt ? { paidAt: order.paidAt } : {}), paymentMode: order.paymentMode, shippingEstimate: this.configuration.shippingEstimate, notificationStatus: eligible(order) ? 'manual_pending' : 'not_requested', ...(order.tracking ? { tracking: order.tracking } : {}) };
  }
  private result(order: StoredOrder, token?: string): OrderResult {
    return { orderId: order.orderId, ...(token ? { accessToken: token } : {}), status: order.status, amount: order.amount, mode: order.paymentMode, completed: ['paid', 'prepaid'].includes(order.paymentState), order: this.summary(order) };
  }
  private async entry(orderId: unknown): Promise<OrderEntry> {
    const key = orderKey(orderId), entry = await this.deps.storage.get<StoredRecord>(key);
    if (!entry?.data.order) throw new CommerceFailure('ORDER_NOT_FOUND', '주문 정보를 확인해 주세요.', 404);
    return { ...entry, key, order: entry.data.order };
  }
  private async authorized(orderId: unknown, token: unknown) {
    const t = accessToken(token), entry = await this.entry(orderId);
    if (!equalSecret(entry.order.tokenHash, hash(t))) throw new CommerceFailure('INVALID_ACCESS', '주문 접근 정보를 확인해 주세요.', 403);
    return entry;
  }
  private async update(entry: OrderEntry, order: StoredOrder) {
    return this.deps.storage.put(entry.key, { ...entry.data, order }, { onlyIfMatch: entry.etag });
  }
  async rateLimit(identity: string, category: string, max = 12) {
    // Durable counters protect lookup across concurrent function instances; the platform also limits IP traffic.
    const bucket = Math.floor(this.now() / 600000), key = `rate/${category}/${hash(identity)}`;
    for (let i = 0; i < 8; i++) {
      const existing = await this.deps.storage.get<{ bucket: number; count: number }>(key);
      const count = existing?.data.bucket === bucket ? existing.data.count : 0;
      if (count >= max) throw new CommerceFailure('RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429, true);
      if (await this.deps.storage.put(key, { bucket, count: count + 1 }, existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true })) return;
    }
    throw new CommerceFailure('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', 429, true);
  }
  async verifyCode(codeValue: unknown, phoneValue: unknown) {
    const code = externalCode(codeValue), contact = phone(phoneValue);
    const entry = await this.deps.storage.get<StoredRecord>(codeKey(code));
    if (!entry || entry.data.kind !== 'external' || !equalSecret(entry.data.phone, contact)) throw new CommerceFailure('INVALID_CODE', '주문 코드와 연락처를 확인해 주세요.');
    return { valid: true, completed: Boolean(entry.data.order), ...(entry.data.order ? { order: this.summary(entry.data.order) } : {}) };
  }
  async create(raw: unknown, photo: PhotoData): Promise<OrderResult> {
    const input = createInput(raw), tokenHash = hash(input.accessToken);
    if (input.route === 'direct' && !this.configuration.paymentReady) throw new CommerceFailure('PAYMENT_UNAVAILABLE', '현재 결제 준비 중입니다. 입력 내용은 이 화면에 보관됩니다.', 503);
    const fingerprint = hash(JSON.stringify({ ...input, accessToken: undefined, requestId: undefined, photo: photo.digest }));
    const key = input.route === 'direct' ? `records/direct/${input.requestId}` : codeKey(input.code!);
    const existing = await this.deps.storage.get<StoredRecord>(key);
    if (input.route === 'external' && (!existing || existing.data.kind !== 'external' || !equalSecret(existing.data.phone, input.draft.phone))) throw new CommerceFailure('INVALID_CODE', '주문 코드와 연락처를 확인해 주세요.');
    if (existing?.data.order) {
      const prior = existing.data.order;
      if (input.route === 'external' && (prior.requestId !== input.requestId || prior.tokenHash !== tokenHash)) return this.result(prior);
      if (!equalSecret(prior.tokenHash, tokenHash)) throw new CommerceFailure('INVALID_ACCESS', '주문 접근 정보를 확인해 주세요.', 403);
      if (prior.fingerprint !== fingerprint) throw new CommerceFailure('IDEMPOTENCY_CONFLICT', '이미 저장된 주문입니다. 기존 주문의 결제를 이어서 진행해 주세요.', 409);
      return this.result(prior, input.accessToken);
    }
    const orderId = input.route === 'direct' ? `MNE-D-${input.requestId}` : `MNE-X-${hash(input.code!).slice(0, 24)}`;
    // Photos are immutable and private. A failed transaction can leave an unreferenced upload, never a paid order.
    const photoKey = `photos/${hash(`${input.requestId}:${photo.digest}`)}`;
    await this.deps.storage.put(photoKey, photo, { onlyIfNew: true });
    const order: StoredOrder = {
      orderId, requestId: input.requestId, tokenHash, fingerprint, route: input.route, draft: input.draft,
      shipping: input.route === 'direct' ? input.shipping! : (existing!.data as Extract<StoredRecord, { kind: 'external' }>).shipping,
      consents: { ...input.consents, acceptedAt: this.iso() }, photo: { key: photoKey, type: photo.type },
      status: '접수', paymentState: input.route === 'direct' ? 'pending' : 'prepaid', paymentMode: input.route === 'direct' ? this.configuration.paymentMode : (existing!.data as Extract<StoredRecord, { kind: 'external' }>).testOnly ? 'test' : 'live', amount: COMMERCE_PRODUCT.amount, receivedAt: this.iso(), ...(input.route === 'external' ? { paidAt: (existing!.data as Extract<StoredRecord, { kind: 'external' }>).issuedAt } : {}), sheetSync: 'pending',
    };
    const record: StoredRecord = input.route === 'direct' ? { kind: 'direct', order } : { ...existing!.data, order };
    if (!await this.deps.storage.put(key, record, existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true })) return this.create(raw, photo);
    if (eligible(order)) await this.syncSheet(orderId);
    return this.result(order, input.accessToken);
  }
  async lookup(reference: unknown, contact: unknown) {
    const normalizedPhone = phone(contact), ref = text(reference, 80, '주문 번호');
    let entry: OrderEntry;
    try {
      if (/^MNE-[DX]-/i.test(ref)) entry = await this.entry(ref);
      else { const code = externalCode(ref); entry = await this.entry(`MNE-X-${hash(code).slice(0, 24)}`); }
    } catch { throw new CommerceFailure('ORDER_NOT_FOUND', '주문 번호 또는 코드와 연락처를 확인해 주세요.', 404); }
    if (!equalSecret(entry.order.draft.phone, normalizedPhone)) throw new CommerceFailure('ORDER_NOT_FOUND', '주문 번호 또는 코드와 연락처를 확인해 주세요.', 404);
    return { order: this.summary(entry.order) };
  }
  async resume(orderId: unknown, token: unknown) {
    let entry = await this.authorized(orderId, token);
    if (entry.order.route === 'direct' && ['pending', 'confirming'].includes(entry.order.paymentState) && entry.order.paymentKey) {
      const provider = this.deps.payment;
      if (!provider || provider.mode !== entry.order.paymentMode) throw new CommerceFailure('PAYMENT_UNAVAILABLE', '결제 연결 설정을 확인 중입니다.', 503, true);
      const payment = await provider.find(entry.order.orderId);
      if (payment) entry = await this.recordPayment(entry, payment);
    }
    if (eligible(entry.order)) await this.syncSheet(entry.order.orderId);
    return this.result(entry.order);
  }
  private async recordPayment(entry: OrderEntry, payment: ProviderPayment, snapshotAt = this.now()): Promise<OrderEntry> {
    verifyPayment(payment, entry.order.orderId, entry.order.paymentKey, entry.order.amount);
    const state: PaymentState = payment.status === 'DONE' ? (payment.balanceAmount === entry.order.amount ? 'paid' : 'review') : payment.status === 'CANCELED' ? 'canceled' : payment.status === 'PARTIAL_CANCELED' ? 'review' : ['READY', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'ABORTED', 'EXPIRED'].includes(payment.status) ? 'pending' : 'review';
    for (let i = 0; i < 8; i++) {
      // A slower lookup must not overwrite a newer refund observation. Once money has
      // been refunded, an old DONE snapshot can never restore fulfillment eligibility.
      if ((entry.order.paymentSnapshotAt ?? 0) > snapshotAt) return entry;
      const terminalRefund = entry.order.paymentState === 'canceled' || entry.order.paymentHold === 'refunded';
      const nextState: PaymentState = entry.order.paymentState === 'canceled' ? 'canceled' : terminalRefund && state !== 'canceled' ? 'review' : state === 'pending' && ['paid', 'review'].includes(entry.order.paymentState) ? 'review' : state === 'pending' && entry.order.lease && entry.order.lease.until > this.now() ? 'confirming' : state;
      const refunded = terminalRefund || ['CANCELED', 'PARTIAL_CANCELED'].includes(payment.status) || (payment.status === 'DONE' && payment.balanceAmount !== entry.order.amount);
      const next: StoredOrder = { ...entry.order, paymentKey: payment.paymentKey, paymentState: nextState, paymentSnapshotAt: snapshotAt,
        paymentHold: refunded ? 'refunded' : nextState === 'review' ? 'uncertain' : undefined,
        ...(nextState === 'paid' ? { paidAt: payment.approvedAt || entry.order.paidAt || this.iso() } : {}),
        ...(nextState === 'canceled' ? { canceledAt: entry.order.canceledAt || this.iso() } : {}), lease: nextState === 'confirming' ? entry.order.lease : undefined };
      if (await this.update(entry, next)) return this.entry(entry.order.orderId);
      entry = await this.entry(entry.order.orderId);
      verifyPayment(payment, entry.order.orderId, entry.order.paymentKey, entry.order.amount);
    }
    throw new CommerceFailure('RETRY', '결제 결과를 저장 중입니다. 다시 확인해 주세요.', 503, true);
  }
  private async holdUncertain(entry: OrderEntry, snapshotAt: number) {
    for (let i = 0; i < 8; i++) {
      if (entry.order.paymentMode !== 'live' || entry.order.route !== 'direct' || entry.order.paymentState === 'canceled' || entry.order.paymentHold === 'refunded' || (entry.order.paymentSnapshotAt ?? 0) > snapshotAt) return;
      if (await this.update(entry, { ...entry.order, paymentState: 'review', paymentHold: 'uncertain', paymentSnapshotAt: snapshotAt })) return;
      entry = await this.entry(entry.order.orderId);
    }
    throw new CommerceFailure('RETRY', '결제 상태를 저장 중입니다. 다시 확인해 주세요.', 503, true);
  }
  private async reconcileDirect(entry: OrderEntry) {
    const provider = this.deps.payment;
    if (entry.order.paymentMode !== 'live' || entry.order.route !== 'direct') throw new CommerceFailure('INVALID_RECONCILIATION', '실제 직접 결제 주문만 다시 확인할 수 있습니다.', 409);
    if (!provider || provider.mode !== 'live') throw new CommerceFailure('PAYMENT_UNAVAILABLE', '결제 연결 설정을 확인 중입니다.', 503, true);
    const snapshotAt = this.now();
    try {
      const payment = await provider.find(entry.order.orderId);
      if (!payment) {
        if (['paid', 'review', 'canceled'].includes(entry.order.paymentState)) throw new CommerceFailure('PAYMENT_UNCERTAIN', '이전 결제 기록을 확인할 수 없어 진행을 보류했습니다.', 503, true);
        return entry;
      }
      return await this.recordPayment(entry, payment, snapshotAt);
    } catch (error) {
      await this.holdUncertain(await this.entry(entry.order.orderId), snapshotAt);
      throw error;
    }
  }
  async adminReconcile(orderId: unknown) {
    const entry = await this.reconcileDirect(await this.entry(orderId));
    if (eligible(entry.order)) await this.syncSheet(entry.order.orderId);
    return { order: this.summary(entry.order) };
  }
  async confirm(raw: Record<string, unknown>) {
    let entry = await this.authorized(raw.orderId, raw.accessToken);
    if (entry.order.route !== 'direct') throw new CommerceFailure('INVALID_PAYMENT', '이미 외부 결제가 확인된 주문입니다.', 409);
    if (raw.amount !== entry.order.amount) throw new CommerceFailure('PAYMENT_MISMATCH', '결제 금액이 주문과 일치하지 않습니다.', 409);
    const paymentKey = text(raw.paymentKey, 200, '결제 정보');
    if (entry.order.paymentKey && entry.order.paymentKey !== paymentKey) throw new CommerceFailure('PAYMENT_MISMATCH', '결제 정보가 주문과 일치하지 않습니다.', 409);
    if (entry.order.paymentState === 'paid') { await this.syncSheet(entry.order.orderId); return this.result(entry.order); }
    if (['canceled', 'review'].includes(entry.order.paymentState)) throw new CommerceFailure('PAYMENT_CANCELED', '취소된 결제입니다. 고객센터에 문의해 주세요.', 409);
    const provider = this.deps.payment;
    if (!provider || !this.configuration.paymentReady || provider.mode !== entry.order.paymentMode) throw new CommerceFailure('PAYMENT_UNAVAILABLE', '결제 연결 설정을 확인 중입니다.', 503, true);
    if (entry.order.lease && entry.order.lease.until > this.now()) throw new CommerceFailure('PAYMENT_PROCESSING', '결제 결과를 확인 중입니다. 잠시 후 다시 확인해 주세요.', 409, true);
    const lease = { id: randomUUID(), until: this.now() + 55000 };
    if (!await this.update(entry, { ...entry.order, paymentKey, paymentState: 'confirming', lease })) throw new CommerceFailure('PAYMENT_PROCESSING', '결제 결과를 확인 중입니다. 다시 확인해 주세요.', 409, true);
    entry = await this.entry(entry.order.orderId);
    try {
      let payment = await provider.find(entry.order.orderId);
      if (payment) verifyPayment(payment, entry.order.orderId, paymentKey, entry.order.amount);
      if (!payment || !['DONE', 'CANCELED', 'PARTIAL_CANCELED'].includes(payment.status)) {
        try { payment = await provider.confirm(entry.order.orderId, paymentKey, entry.order.amount); }
        catch (failure) {
          // A timeout can mean the charge succeeded; query the same order before any retry.
          const recovered = await provider.find(entry.order.orderId);
          if (!recovered) throw failure;
          payment = recovered;
        }
      }
      entry = await this.recordPayment(entry, payment);
      if (entry.order.paymentState !== 'paid') throw new CommerceFailure('PAYMENT_NOT_COMPLETED', '결제가 완료되지 않았습니다. 주문 내용은 저장되어 있습니다.', 409, true);
      if (eligible(entry.order)) await this.syncSheet(entry.order.orderId);
      return this.result(entry.order);
    } finally {
      const latest = await this.entry(entry.order.orderId);
      if (latest.order.lease?.id === lease.id) await this.update(latest, { ...latest.order, lease: undefined, paymentState: latest.order.paymentState === 'confirming' ? 'pending' : latest.order.paymentState });
    }
  }
  async paymentCancel(raw: Record<string, unknown>) {
    const entry = await this.authorized(raw.orderId, raw.accessToken);
    // Browser cancellation is only a UI event. Never use it as evidence that money was refunded.
    return this.result(entry.order);
  }
  async issueCode(raw: Record<string, unknown>) {
    const customerName = text(raw.customerName, 80, '주문자 이름'), contact = phone(raw.phone), channel = text(raw.channel, 100, '구매 채널'), shipping = shippingAddress(raw.shipping);
    const externalOrderReference = text(raw.externalOrderReference, 120, '외부 주문 번호');
    const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
    const issuanceKey = `issuance/${hash(JSON.stringify([normalize(channel), normalize(externalOrderReference)]))}`;
    const fingerprint = hash(JSON.stringify({ customerName, contact, shipping, testOnly: raw.testOnly === true }));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const newCode = () => `MNE-${Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
    for (let i = 0; i < 20; i++) {
      let issuance = await this.deps.storage.get<Issuance>(issuanceKey);
      if (!issuance) {
        await this.deps.storage.put(issuanceKey, { code: newCode(), fingerprint }, { onlyIfNew: true });
        issuance = await this.deps.storage.get<Issuance>(issuanceKey);
      }
      if (!issuance) continue;
      if (issuance.data.fingerprint !== fingerprint) throw new CommerceFailure('CODE_ISSUANCE_CONFLICT', '이 외부 주문 번호로 이미 코드를 발급했습니다. 기존 고객·배송 정보를 확인해 주세요.', 409);
      const code = issuance.data.code;
      const stored = await this.deps.storage.get<StoredRecord>(codeKey(code));
      if (stored?.data.kind === 'external' && stored.data.issuanceKey === issuanceKey && stored.data.issuanceFingerprint === fingerprint) return { code };
      if (!stored && await this.deps.storage.put(codeKey(code), { kind: 'external', code, customerName, phone: contact, channel, externalOrderReference, shipping, issuedAt: this.iso(), testOnly: raw.testOnly === true, issuanceKey, issuanceFingerprint: fingerprint }, { onlyIfNew: true })) return { code };
      // Retry after a concurrent write. Only rotate a reservation if the random code
      // really belongs to a different purchase; the reservation itself is durable.
      const collision = await this.deps.storage.get<StoredRecord>(codeKey(code));
      if (collision?.data.kind === 'external' && collision.data.issuanceKey === issuanceKey) return { code };
      await this.deps.storage.put(issuanceKey, { code: newCode(), fingerprint }, { onlyIfMatch: issuance.etag });
    }
    throw new CommerceFailure('RETRY', '코드를 만들지 못했습니다. 다시 시도해 주세요.', 503, true);
  }
  async adminList(cursor?: unknown) {
    const page = await this.deps.storage.list(cursor === undefined ? undefined : text(cursor, 2048, '목록 위치'));
    const entries = await Promise.all(page.keys.map(key => this.deps.storage.get<StoredRecord>(key)));
    const orders: AdminOrder[] = [];
    for (const e of entries) {
      const order = e?.data.order;
      if (!order || order.paymentMode !== 'live') continue;
      orders.push({ ...this.summary(order), customerName: order.draft.customerName, phone: order.draft.phone, description: order.draft.description, shipping: order.shipping, consents: order.consents, hasPhoto: eligible(order), sheetSync: order.sheetSync, ...(e.data.kind === 'external' ? { code: e.data.code, channel: e.data.channel, externalOrderReference: e.data.externalOrderReference } : {}) });
    }
    return { orders: orders.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  async adminListCodes(cursor?: unknown) {
    const page = await this.deps.storage.list(cursor === undefined ? undefined : text(cursor, 2048, '목록 위치'));
    const entries = await Promise.all(page.keys.map(key => this.deps.storage.get<StoredRecord>(key)));
    const codes: AdminCode[] = [];
    for (const entry of entries) {
      const record = entry?.data;
      if (record?.kind !== 'external' || record.testOnly) continue;
      codes.push({ code: record.code, customerName: record.customerName, phone: record.phone, channel: record.channel, externalOrderReference: record.externalOrderReference, shipping: record.shipping, issuedAt: record.issuedAt, completed: Boolean(record.order), ...(record.order ? { orderId: record.order.orderId } : {}) });
    }
    return { codes: codes.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  async adminUpdate(raw: Record<string, unknown>) {
    if (!FULFILLMENT_STEPS.includes(raw.status as FulfillmentStatus)) throw new CommerceFailure('INVALID_STATUS', '주문 진행 상태를 확인해 주세요.');
    for (let i = 0; i < 8; i++) {
      let entry = await this.entry(raw.orderId);
      if (!eligible(entry.order)) throw new CommerceFailure('UNPAID_ORDER', '결제가 완료된 실제 주문만 제작할 수 있습니다.', 409);
      if (entry.order.route === 'direct') entry = await this.reconcileDirect(entry);
      if (!eligible(entry.order)) throw new CommerceFailure('UNPAID_ORDER', '결제 취소 또는 확인 보류 상태입니다. 제작·배송을 진행할 수 없습니다.', 409);
      let tracking: StoredOrder['tracking'];
      if (raw.tracking !== undefined) { const t = object(raw.tracking); tracking = { carrier: text(t.carrier, 80, '택배사'), number: text(t.number, 80, '운송장 번호') }; }
      const next = { ...entry.order, status: raw.status as FulfillmentStatus, ...(tracking ? { tracking } : {}) };
      if (await this.update(entry, next)) return { order: this.summary(next) };
    }
    throw new CommerceFailure('RETRY', '주문 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.', 409, true);
  }
  async adminPhoto(orderId: unknown) {
    const entry = await this.entry(orderId);
    if (!eligible(entry.order)) throw new CommerceFailure('UNPAID_ORDER', '결제 완료 주문의 사진만 확인할 수 있습니다.', 409);
    const photo = await this.deps.storage.get<PhotoData>(entry.order.photo.key);
    if (!photo) throw new CommerceFailure('PHOTO_NOT_FOUND', '사진을 찾을 수 없습니다.', 404);
    return new Response(Buffer.from(photo.data.base64, 'base64'), { headers: { 'Content-Type': photo.data.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `inline; filename="${entry.order.orderId}.${photo.data.type.split('/')[1]}"` } });
  }
  async deleteTest(orderId: unknown) {
    const entry = await this.entry(orderId);
    if (entry.order.paymentMode !== 'test') throw new CommerceFailure('NOT_TEST_ORDER', '테스트 주문만 삭제할 수 있습니다.', 403);
    await this.deps.storage.delete(entry.key);
    await this.deps.storage.delete(entry.order.photo.key);
    if (entry.data.kind === 'external' && entry.data.issuanceKey) await this.deps.storage.delete(entry.data.issuanceKey);
    return { deleted: true };
  }
  async syncSheet(orderId: unknown): Promise<{ synced: boolean }> {
    try { return await this.performSheetSync(orderId); }
    catch { return { synced: false }; }
  }
  private async performSheetSync(orderId: unknown): Promise<{ synced: boolean }> {
    let entry = await this.entry(orderId);
    if (!eligible(entry.order)) return { synced: false };
    if (entry.order.sheetSync === 'synced') return { synced: true };
    const url = this.deps.env.MNE_ORDER_WEBHOOK_URL, secret = this.deps.env.MNE_ORDER_SECRET;
    if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) || !secret) return { synced: false };
    if (entry.order.syncLease && entry.order.syncLease.until > this.now()) return { synced: false };
    const lease = { id: randomUUID(), until: this.now() + 30000 };
    if (!await this.update(entry, { ...entry.order, syncLease: lease })) return { synced: false };
    let synced = false;
    try {
      const photo = await this.deps.storage.get<PhotoData>(entry.order.photo.key);
      const order = entry.order;
      const sheetReference = sheetOrderNumber(order.orderId);
      const response = await this.deps.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, orderNumber: sheetReference, fields: { description: sheetDescription(order), preferredNote: order.draft.preferredNote, customerName: order.draft.customerName, contact: order.draft.phone, photoLink: '' }, ...(photo ? { photo: { type: photo.data.type, base64: photo.data.base64 } } : {}), commerce: { orderId: order.orderId, paymentState: order.paymentState, paymentMode: order.paymentMode, amount: order.amount, paidAt: order.paidAt, status: order.status, shipping: order.shipping } }), signal: AbortSignal.timeout(12000) });
      const result = await response.json() as { ok?: boolean; orderNumber?: string; receivedAt?: string };
      synced = response.ok && result.ok === true && result.orderNumber === sheetReference && Number.isFinite(Date.parse(result.receivedAt ?? ''));
    } catch { /* A sheet outage must never undo a confirmed payment or create another order. */ }
    for (let i = 0; i < 8; i++) {
      entry = await this.entry(orderId);
      if (entry.order.syncLease?.id !== lease.id) break;
      if (await this.update(entry, { ...entry.order, sheetSync: synced ? 'synced' : 'failed', syncLease: undefined })) break;
    }
    return { synced };
  }
}
