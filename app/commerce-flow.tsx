import { useEffect, useRef, useState } from 'react';
import { Arrow } from './arrow';
import { COMMERCE_PRODUCT, CONSENT_VERSION, type CommerceConfig, type CommerceConsents, type CreateOrderInput, type OrderResult, type OrderSummary, type ShippingAddress, type VerifyCodeResult } from './commerce-contract';
import { NOTE_VALUES, type PreferredNote } from './order-contract';

const SESSION_KEY = 'mne-checkout-v1';
const noteNames: Record<PreferredNote, string> = { Fruity: '프루티', Floral: '플로럴', Fresh: '프레시', Woody: '우디', Balsamic: '발사믹' };
const emptyConsents: CommerceConsents = { customOrder: false, privacy: false, terms: false, marketing: false, version: CONSENT_VERSION };
const emptyShipping: ShippingAddress = { recipientName: '', phone: '', postcode: '', address: '', detail: '', memo: '' };
type CheckoutSession = { requestId: string; accessToken: string; orderId?: string; route?: 'direct'|'external'; customerName: string; phone: string; orderName: string; amount: number; mode?: string; shipping: ShippingAddress; consents: CommerceConsents };
type PaymentClient = { requestPayment: (options: Record<string, unknown>) => Promise<void> };
type TossFactory = ((key: string) => { payment: (options: { customerKey: string }) => PaymentClient }) & { ANONYMOUS: string };
type PostcodeResult = { zonecode: string; roadAddress: string; jibunAddress: string; userSelectedType: string; buildingName: string; apartment: string };
declare global { interface Window { TossPayments?: TossFactory; kakao?: { Postcode: new (options: { oncomplete: (data: PostcodeResult) => void; width: string; height: string }) => { embed: (container: HTMLElement) => void } } } }

function readSession(): CheckoutSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!value || typeof value.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.accessToken) || typeof value.customerName !== 'string' || typeof value.phone !== 'string' || typeof value.orderName !== 'string' || value.amount !== COMMERCE_PRODUCT.amount) return null;
    // A create response can be lost after the server stores the order. Its stable
    // direct-order ID lets this browser reconcile instead of creating a new order.
    if (!value.orderId && value.route === 'direct') value.orderId = `MNE-D-${value.requestId}`;
    if (typeof value.orderId !== 'string') return null;
    return value;
  } catch { return null; }
}
function saveSession(value: CheckoutSession) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
function phoneDigits(value: string) { return value.replace(/\D/g, '').replace(/^82(?=1)/, '0'); }
function validPhone(value: string) { return /^[+\d\s()-]+$/.test(value) && /^01[016789]\d{7,8}$/.test(phoneDigits(value)); }
const connectionMessage = '주문 서비스에 연결하지 못했습니다. 입력 내용을 유지한 채 잠시 후 다시 시도해 주세요.';
class CheckoutError extends Error {}
function messageOf(error: unknown) { return error instanceof CheckoutError ? error.message : connectionMessage; }
function focusError(el: HTMLElement | null) { requestAnimationFrame(() => { el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }); }
const customerErrorCodes = new Set(['BODY_TOO_LARGE', 'INVALID_INPUT', 'INVALID_ORIGIN', 'INVALID_FORMAT', 'INVALID_ACTION', 'PAYMENT_UNCERTAIN', 'PAYMENT_MISMATCH', 'ORDER_NOT_FOUND', 'INVALID_ACCESS', 'RATE_LIMITED', 'INVALID_CODE', 'PAYMENT_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT', 'RETRY', 'INVALID_PAYMENT', 'PAYMENT_CANCELED', 'PAYMENT_PROCESSING', 'PAYMENT_NOT_COMPLETED', 'INVALID_PHONE', 'INVALID_ADDRESS', 'INVALID_NOTE', 'CONSENT_REQUIRED', 'INVALID_PHOTO', 'SERVICE_UNAVAILABLE']);
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safeApiMessage(data: Record<string, unknown> | null, status: number) {
  const message = data?.error;
  // Only customer-facing Korean copy from our known API errors may reach the UI.
  // HTML, parser errors, provider messages, paths and stack traces are never shown.
  if (typeof data?.code === 'string' && customerErrorCodes.has(data.code) && typeof message === 'string' && message.length <= 200 && /[가-힣]/.test(message) && /^[가-힣\d\s.,·()–—+\-A-Za-zÉ]+$/.test(message) && !/[\r\n]/.test(message) && !/[A-Za-z]/.test(message.replace(/JPG|PNG|WebP|GIF|MB|MNÉ/g, ''))) return message;
  return status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : connectionMessage;
}
async function commerceRequest(init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch('/api/commerce', init); }
  catch { throw new CheckoutError(connectionMessage); }
  const parsed: unknown = await response.json().catch(() => null);
  const data = isRecord(parsed) ? parsed : null;
  if (!response.ok || data?.error) throw new CheckoutError(safeApiMessage(data, response.status));
  if (!data) throw new CheckoutError(connectionMessage);
  return data;
}
function isOrderSummary(value: unknown): value is OrderSummary {
  return isRecord(value) && typeof value.orderId === 'string' && ['direct', 'external'].includes(String(value.route)) && ['pending', 'confirming', 'paid', 'prepaid', 'canceled', 'review'].includes(String(value.paymentState)) && typeof value.amount === 'number' && Number.isFinite(value.amount) && typeof value.productName === 'string' && NOTE_VALUES.includes(value.preferredNote as PreferredNote) && typeof value.status === 'string' && typeof value.shippingEstimate === 'string' && ['unconfigured', 'test', 'live'].includes(String(value.paymentMode)) && (!value.tracking || (isRecord(value.tracking) && typeof value.tracking.carrier === 'string' && typeof value.tracking.number === 'string'));
}
async function api<T>(body: Record<string, unknown> | FormData): Promise<T> {
  const data = await commerceRequest({ method: 'POST', headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) });
  const action = body instanceof FormData ? body.get('action') : body.action;
  if (action === 'verify-code') {
    if (data.valid !== true || typeof data.completed !== 'boolean' || (data.completed && !isOrderSummary(data.order))) throw new CheckoutError(connectionMessage);
  } else if (!isOrderSummary(data.order) || data.orderId !== data.order.orderId || typeof data.completed !== 'boolean' || data.amount !== data.order.amount || data.mode !== data.order.paymentMode) throw new CheckoutError(connectionMessage);
  return data as T;
}
async function configRequest(): Promise<CommerceConfig> {
  const data = await commerceRequest();
  if (typeof data.paymentReady !== 'boolean' || !['unconfigured', 'test', 'live'].includes(String(data.paymentMode)) || !(data.clientKey === null || typeof data.clientKey === 'string') || data.amount !== COMMERCE_PRODUCT.amount || typeof data.orderName !== 'string' || typeof data.shippingEstimate !== 'string' || typeof data.supportEmail !== 'string' || (data.paymentReady && (!data.clientKey || data.paymentMode === 'unconfigured'))) throw new CheckoutError(connectionMessage);
  return data as CommerceConfig;
}
function loadScript(src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let element = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const timer = window.setTimeout(() => reject(new CheckoutError('결제 또는 주소 검색을 불러오지 못했습니다. 다시 시도해 주세요.')), 15000);
    const onLoad = () => { clearTimeout(timer); ready() ? resolve() : reject(new CheckoutError('서비스를 시작하지 못했습니다. 다시 시도해 주세요.')); };
    const onError = () => { clearTimeout(timer); element?.remove(); reject(new CheckoutError('서비스 연결을 확인한 뒤 다시 시도해 주세요.')); };
    if (!element) { element = document.createElement('script'); element.src = src; element.async = true; element.addEventListener('load', onLoad, { once: true }); element.addEventListener('error', onError, { once: true }); document.head.appendChild(element); }
    else { element.addEventListener('load', onLoad, { once: true }); element.addEventListener('error', onError, { once: true }); }
  });
}
async function openPayment(config: CommerceConfig, saved: CheckoutSession) {
  if (!config.paymentReady || !config.clientKey || !saved.orderId) throw new CheckoutError('결제 서비스 준비 중입니다. 개통 후 이용해 주세요.');
  await loadScript('https://js.tosspayments.com/v2/standard', () => !!window.TossPayments);
  const factory = window.TossPayments!;
  const payment = factory(config.clientKey).payment({ customerKey: factory.ANONYMOUS });
  await payment.requestPayment({ method: 'CARD', amount: { currency: 'KRW', value: saved.amount }, orderId: saved.orderId, orderName: saved.orderName, customerName: saved.customerName, customerMobilePhone: phoneDigits(saved.phone), successUrl: location.origin + '/payment/success', failUrl: location.origin + '/payment/fail', card: { flowMode: 'DEFAULT', useEscrow: false } });
}
function ensurePayable(result: OrderResult, config: CommerceConfig) {
  if (result.order.paymentState === 'review' || result.order.paymentState === 'canceled') throw new CheckoutError('이 주문의 결제 상태는 고객센터 확인이 필요합니다. 새로 결제하지 말고 구매처에 문의해 주세요.');
  if (result.order.paymentState === 'confirming') throw new CheckoutError('결제 결과를 확인하고 있습니다. 잠시 후 같은 주문을 다시 확인해 주세요.');
  if (result.mode !== config.paymentMode) throw new CheckoutError('이 주문의 결제 설정이 변경되었습니다. 고객센터에 문의해 주세요.');
}

export function CommerceReceipt({ order, config }: { order: OrderSummary; config?: CommerceConfig | null }) {
  const complete = order.paymentState === 'paid' || order.paymentState === 'prepaid';
  return <section className="commerce-receipt" aria-labelledby="receipt-title">
    <p className="commerce-kicker">MNÉ</p>
    <h2 id="receipt-title">{complete ? '기억이 도착했습니다.' : '결제 확인이 필요합니다.'}</h2>
    <p>{complete ? '세 가지 향으로 당신의 기억을 준비하겠습니다.' : '결제 상태를 확인한 뒤 주문이 접수됩니다.'}</p>
    {order.paymentMode === 'test' && <p className="commerce-notice">테스트 주문입니다. 실제 결제나 제작이 진행되지 않습니다.</p>}
    <dl className="commerce-summary">
      <div><dt>주문번호</dt><dd className="commerce-reference">{order.orderId}</dd></div>
      <div><dt>주문 상품</dt><dd>{order.productName} · 120ml</dd></div>
      <div><dt>향의 방향</dt><dd>{noteNames[order.preferredNote]}</dd></div>
      <div><dt>결제</dt><dd>{order.route === 'external' ? '외부 채널 결제 완료' : `${order.amount.toLocaleString('ko-KR')}원${complete ? ' 결제 완료' : ' · 확인 중'}`}</dd></div>
      <div><dt>진행 상태</dt><dd>{order.status}</dd></div>
      <div><dt>제작·배송</dt><dd>{order.shippingEstimate}</dd></div>
      <div><dt>판매자</dt><dd>MNÉ · 사업자 상세 정보는 하단 참조</dd></div>
      {order.tracking && <div><dt>배송 정보</dt><dd>{order.tracking.carrier} · {order.tracking.number}</dd></div>}
    </dl>
    <p className="commerce-help">주문번호를 보관해 주세요. 주문 조회에서 진행 상태를 확인할 수 있습니다.{config?.supportEmail && <> 문의: <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a></>}</p>
    <div className="commerce-actions"><a className="commerce-primary" href="/orders">주문 조회 <Arrow/></a><a className="commerce-text-button" href="/">홈으로</a></div>
  </section>;
}

function ConsentFields({ value, onChange, disabled }: { value: CommerceConsents; onChange: (value: CommerceConsents) => void; disabled: boolean }) {
  const toggle = (key: keyof Pick<CommerceConsents, 'customOrder'|'privacy'|'terms'|'marketing'>) => onChange({ ...value, [key]: !value[key] });
  return <fieldset className="commerce-consents" disabled={disabled}><legend>주문 전 확인해 주세요.</legend>
    <div className="commerce-custom-notice"><p>이 향초는 고객님의 기억을 바탕으로 개별 제작됩니다. 사전에 안내하고 별도 동의를 받은 범위에서, 제작이 시작된 후에는 단순 변심에 따른 취소·환불이 제한될 수 있습니다.</p><p>단, 주문 내용과 다르게 제작되었거나 제품에 하자가 있는 경우에는 교환·환불해 드립니다.</p><a href="/refund" target="_blank" rel="noreferrer">취소·교환·환불 안내 보기 <span className="sr-only">새 창</span></a></div>
    <label><input type="checkbox" checked={value.customOrder} onChange={() => toggle('customOrder')} required/><span><b>[필수]</b> 개별 제작 및 청약철회 제한 안내를 확인하고 동의합니다.</span></label>
    <div className="commerce-consent-row"><label><input type="checkbox" checked={value.privacy} onChange={() => toggle('privacy')} required/><span><b>[필수]</b> 개인정보 수집·이용에 동의합니다.</span></label><a href="/privacy" target="_blank" rel="noreferrer">내용 보기<span className="sr-only"> 새 창</span></a></div>
    <div className="commerce-consent-row"><label><input type="checkbox" checked={value.terms} onChange={() => toggle('terms')} required/><span><b>[필수]</b> 이용약관에 동의합니다.</span></label><a href="/terms" target="_blank" rel="noreferrer">내용 보기<span className="sr-only"> 새 창</span></a></div>
    <label><input type="checkbox" checked={value.marketing} onChange={() => toggle('marketing')}/><span>[선택] 새로운 소식과 혜택 안내 수신에 동의합니다.</span></label>
  </fieldset>;
}

export function CommerceFlow({ photoFile, description, preferredNote, onMemoryError, onBusyChange }: { photoFile: File | null; description: string; preferredNote: string; onMemoryError: (message: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const [config, setConfig] = useState<CommerceConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<'entry'|'shipping'|'review'>('entry');
  const [route, setRoute] = useState<'direct'|'external'>('direct');
  const [code, setCode] = useState('');
  const [externalOpen, setExternalOpen] = useState(false);
  const [shipping, setShipping] = useState<ShippingAddress>(emptyShipping);
  const [consents, setConsents] = useState<CommerceConsents>(emptyConsents);
  const [busy, setBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<OrderSummary | null>(null);
  const [recoverable] = useState(readSession);
  const section = useRef<HTMLDivElement>(null);
  const postcodeDialog = useRef<HTMLDialogElement>(null);
  const postcodeContainer = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const session = useRef<CheckoutSession | null>(null);
  const fingerprint = useRef('');
  const submitLock = useRef(false);
  useEffect(() => { let active = true; configRequest().then(value => { if (active) { setConfig(value); setConfigError(''); } }).catch(cause => { if (active) setConfigError(messageOf(cause)); }); return () => { active = false; }; }, []);
  useEffect(() => { const query = new URLSearchParams(location.search); const incoming = (query.get('code') || '').replace(/^MN[ÉE]-/i, '').toUpperCase(); if (incoming) { setCode(incoming.slice(0, 5)); setExternalOpen(true); } }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const validCode = /^[A-HJ-NP-Z2-9]{5}$/.test(code);
  const updateShipping = (key: keyof ShippingAddress, value: string) => setShipping(old => ({ ...old, [key]: value }));
  function report(message: string) { setError(message); focusError(errorRef.current); }
  function validateMemory() {
    if (!photoFile) { onMemoryError('내 사진을 먼저 올려 주세요. 예시 사진으로는 주문할 수 없습니다.'); return false; }
    if (photoFile.size > 4 * 1024 * 1024) { onMemoryError('사진은 4MB 이하로 올려 주세요.'); return false; }
    if (!description.trim()) { onMemoryError('간직하고 싶은 기억을 짧은 글로 들려주세요.'); return false; }
    if (description.length > 5000) { onMemoryError('기억은 5,000자 이내로 입력해 주세요.'); return false; }
    if (!NOTE_VALUES.includes(preferredNote as PreferredNote)) { report('향의 방향을 선택해 주세요.'); return false; }
    return true;
  }
  function validateCustomer() {
    if (!customerName.trim()) { report('이름을 입력해 주세요.'); section.current?.querySelector<HTMLInputElement>('#commerce-name')?.focus(); return false; }
    if (!validPhone(phone)) { report('연락 가능한 전화번호를 확인해 주세요.'); section.current?.querySelector<HTMLInputElement>('#commerce-phone')?.focus(); return false; }
    return true;
  }
  function changeStage(next: typeof stage) { setError(''); setStage(next); requestAnimationFrame(() => { section.current?.querySelector<HTMLElement>('.commerce-step-title')?.focus({ preventScroll: true }); section.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }); }
  function beginDirect() { if (!validateMemory() || !validateCustomer()) return; setRoute('direct'); setShipping(old => ({ ...old, recipientName: old.recipientName || customerName, phone: old.phone || phone })); changeStage('shipping'); }
  async function verifyExternal() {
    if (submitLock.current || !validCode || !validateCustomer()) return;
    submitLock.current = true; setBusy(true); setError('');
    try { const result = await api<VerifyCodeResult>({ action: 'verify-code', code: 'MNÉ-' + code, phone: phoneDigits(phone) }); if (result.completed && result.order) { setReceipt(result.order); return; } if (!validateMemory()) return; setRoute('external'); changeStage('review'); }
    catch (cause) { report(messageOf(cause)); } finally { submitLock.current = false; setBusy(false); }
  }
  async function searchAddress() {
    setAddressBusy(true); setAddressError('');
    try {
      await loadScript('https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js', () => !!window.kakao?.Postcode);
      if (!postcodeContainer.current || !postcodeDialog.current) return;
      postcodeContainer.current.replaceChildren();
      postcodeDialog.current.showModal();
      new window.kakao!.Postcode({ width: '100%', height: '100%', oncomplete: data => {
        setShipping(old => ({ ...old, postcode: data.zonecode, address: (data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress) || data.roadAddress || data.jibunAddress }));
        postcodeDialog.current?.close();
        requestAnimationFrame(() => document.getElementById('shipping-detail')?.focus());
      } }).embed(postcodeContainer.current);
    }
    catch { postcodeDialog.current?.close(); setAddressError('주소 검색을 열지 못했습니다. 아래에 우편번호와 주소를 직접 입력해 주세요.'); }
    finally { setAddressBusy(false); }
  }
  function shippingNext(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!validPhone(shipping.phone)) { report('받는 분의 전화번호를 확인해 주세요.'); return; } changeStage('review'); }
  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitLock.current) return;
    if (!consents.customOrder || !consents.privacy || !consents.terms) { report('필수 동의 항목을 모두 확인해 주세요.'); return; }
    if (!validateMemory() || !validateCustomer()) return;
    if (route === 'direct' && !config?.paymentReady) { report('결제 서비스 준비 중입니다. 개통 후 이용해 주세요.'); return; }
    const payloadKey = JSON.stringify({ route, code, description, preferredNote, customerName, phone, shipping, consents, photo: photoFile && [photoFile.name, photoFile.size, photoFile.lastModified] });
    if (fingerprint.current !== payloadKey) { fingerprint.current = payloadKey; session.current = null; }
    if (!session.current) session.current = { requestId: crypto.randomUUID(), accessToken: randomToken(), route, customerName: customerName.trim(), phone: phoneDigits(phone), orderName: config?.orderName || '기억 향초 · 120ml', amount: COMMERCE_PRODUCT.amount, shipping, consents };
    const saved = session.current;
    submitLock.current = true; setBusy(true); setError('');
    try {
      saveSession(saved);
      let result: OrderResult;
      if (saved.orderId) result = await api<OrderResult>({ action: 'resume', orderId: saved.orderId, accessToken: saved.accessToken });
      else {
        const payload: CreateOrderInput = { route, requestId: saved.requestId, accessToken: saved.accessToken, draft: { description: description.trim(), preferredNote: preferredNote as PreferredNote, customerName: customerName.trim(), phone: phoneDigits(phone) }, consents, ...(route === 'external' ? { code: 'MNÉ-' + code } : { shipping: { ...shipping, recipientName: shipping.recipientName.trim(), phone: phoneDigits(shipping.phone) } }) };
        const body = new FormData(); body.set('action', 'create'); body.set('payload', JSON.stringify(payload)); body.set('photo', photoFile!);
        result = await api<OrderResult>(body);
        saved.orderId = result.orderId; saved.mode = result.mode; saveSession(saved);
      }
      if (result.completed) { setReceipt(result.order); requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
      else if (route === 'direct' && config) { ensurePayable(result, config); await openPayment(config, saved); }
    } catch (cause) { report(messageOf(cause)); } finally { submitLock.current = false; setBusy(false); }
  }
  return <div id="customer-order" className="commerce-flow" ref={section} aria-busy={busy}>
    {receipt ? <CommerceReceipt order={receipt} config={config}/> : <>
      <div className="commerce-heading"><span className="commerce-kicker">{stage === 'entry' ? '주문자 정보' : route === 'external' ? '외부 구매 주문' : stage === 'shipping' ? '배송 정보' : '주문 확인'}</span><h3 className="commerce-step-title" tabIndex={-1}>{stage === 'entry' ? '기억을 향으로 이어볼까요?' : stage === 'shipping' ? '어디로 보내드릴까요?' : '당신만의 향을 준비합니다.'}</h3></div>
      {stage === 'entry' && <div className="commerce-entry">
        {recoverable?.orderId && <p className="commerce-resume">이 브라우저에 보관된 주문이 있습니다. <a href="/payment/fail">기존 주문 확인하기</a></p>}
        <div className="commerce-field-grid"><label htmlFor="commerce-name">이름<input id="commerce-name" autoComplete="name" maxLength={80} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="이름" disabled={busy} required/></label><label htmlFor="commerce-phone">전화번호<input id="commerce-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000" disabled={busy} required/></label></div>
        <p className="commerce-inclusion">기억 향초 120ml · 시향지 3종과 선택한 향의 향초 · 배송비 포함</p>
        <button className="commerce-primary" type="button" onClick={beginDirect} disabled={busy}>35,000원 결제하기 <Arrow/></button>
        {config && !config.paymentReady && <p className="commerce-help">온라인 결제는 준비 중입니다. 외부에서 구매하셨다면 아래 식별번호로 접수해 주세요.</p>}
        <div className="commerce-external"><button type="button" className="commerce-external-toggle" aria-expanded={externalOpen} aria-controls="external-code-fields" onClick={() => setExternalOpen(value => !value)}>이미 다른 곳에서 구매하셨나요? <span aria-hidden="true">{externalOpen ? '−' : '+'}</span></button>
          {externalOpen && <div id="external-code-fields"><p className="commerce-help">구매 시 안내받은 식별번호와 주문자 전화번호를 입력해 주세요. 추가 결제 없이 기억을 접수합니다.</p><label htmlFor="commerce-code" className="commerce-code-label">식별번호</label><div className="commerce-code-row"><span aria-hidden="true">MNÉ-</span><input id="commerce-code" aria-label="MNÉ 뒤 5자리 식별번호" value={code} onChange={e => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0,5))} placeholder="4K7P2" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={5} disabled={busy}/><button type="button" onClick={verifyExternal} disabled={!validCode || busy}>{busy ? '확인 중' : '확인'}</button></div><p className="commerce-help">영문 대소문자는 구분하지 않습니다. 숫자 0·1, 영문 O·I는 사용하지 않습니다.</p><p className="commerce-help">번호를 찾을 수 없나요? {config?.supportEmail ? <a href={`mailto:${config.supportEmail}`}>고객센터에 문의해 주세요.</a> : '구매하신 채널의 문의하기를 이용해 주세요.'}</p></div>}
        </div>
      </div>}
      {stage === 'shipping' && <form className="commerce-shipping" onSubmit={shippingNext}>
        <div className="commerce-field-grid"><label>받는 분<input autoComplete="shipping name" value={shipping.recipientName} onChange={e => updateShipping('recipientName', e.target.value)} required maxLength={80}/></label><label>전화번호<input type="tel" inputMode="tel" autoComplete="shipping tel" value={shipping.phone} onChange={e => updateShipping('phone', e.target.value)} required maxLength={20}/></label></div>
        <label htmlFor="shipping-postcode">우편번호</label><div className="commerce-address-search"><input id="shipping-postcode" inputMode="numeric" autoComplete="shipping postal-code" value={shipping.postcode} onChange={e => updateShipping('postcode', e.target.value.replace(/\D/g,'').slice(0,5))} pattern="[0-9]{5}" required placeholder="5자리 우편번호"/><button type="button" onClick={searchAddress} disabled={addressBusy}>{addressBusy ? '불러오는 중' : '주소 검색'}</button></div>
        {addressError && <p className="commerce-help" role="status">{addressError}</p>}
        <label>주소<input autoComplete="shipping address-line1" value={shipping.address} onChange={e => updateShipping('address', e.target.value)} required maxLength={200} placeholder="도로명 또는 지번 주소"/></label>
        <label htmlFor="shipping-detail">상세주소<input id="shipping-detail" autoComplete="shipping address-line2" value={shipping.detail} onChange={e => updateShipping('detail', e.target.value)} maxLength={120} placeholder="동·호수 등 상세주소 (해당 시)"/></label>
        <label>배송 메모 <span className="commerce-optional">선택</span><input value={shipping.memo} onChange={e => updateShipping('memo', e.target.value)} maxLength={200} placeholder="배송 시 필요한 내용을 남겨주세요."/></label>
        <div className="commerce-actions"><button className="commerce-primary" type="submit">주문 확인 <Arrow/></button><button className="commerce-text-button" type="button" onClick={() => changeStage('entry')}>이전</button></div>
      </form>}
      {stage === 'review' && <form onSubmit={finish} className="commerce-review">
        <dl className="commerce-summary"><div><dt>상품</dt><dd>기억 향초 · 120ml</dd></div><div><dt>구성</dt><dd>시향지 3종 + 선택한 향의 향초 1개</dd></div><div><dt>향의 방향</dt><dd>{noteNames[preferredNote as PreferredNote] || preferredNote}</dd></div><div><dt>주문자</dt><dd>{customerName} · {phone}</dd></div>{route === 'direct' ? <><div><dt>받는 곳</dt><dd>{shipping.recipientName} · {shipping.phone}<br/>{shipping.address} {shipping.detail}</dd></div><div><dt>배송비</dt><dd>포함</dd></div><div className="commerce-total"><dt>총 결제 금액</dt><dd>35,000원</dd></div></> : <div><dt>결제·배송 정보</dt><dd>외부 구매처에 등록된 정보를 사용합니다.<br/>식별번호 MNÉ-{code} · 추가 결제 없음</dd></div>}<div><dt>제작·배송</dt><dd>{config?.shippingEstimate || '제작·배송 일정 안내 등록 예정'}</dd></div></dl>
        <ConsentFields value={consents} onChange={setConsents} disabled={busy}/>
        {route === 'direct' && config?.paymentMode === 'test' && <p className="commerce-notice">테스트 결제입니다. 실제 청구나 상품 제작은 진행되지 않습니다.</p>}
        {route === 'direct' && !config?.paymentReady && <p className="commerce-notice">결제 서비스를 준비하고 있습니다. 정식 개통 후 결제할 수 있습니다.</p>}
        <div className="commerce-actions"><button className="commerce-primary" type="submit" disabled={busy || (route === 'direct' && !config?.paymentReady)}>{busy ? '처리 중…' : route === 'external' ? '기억 접수하기' : config?.paymentMode === 'test' ? '35,000원 테스트 결제하기' : '35,000원 결제하기'} {!busy && <Arrow/>}</button><button className="commerce-text-button" type="button" onClick={() => changeStage(route === 'external' ? 'entry' : 'shipping')} disabled={busy}>이전</button></div>
        <p className="commerce-help">{route === 'direct' ? '결제창에서 카드 및 지원되는 간편결제 수단을 선택할 수 있습니다.' : '접수 후에는 같은 식별번호로 주문 진행 상태를 조회할 수 있습니다.'}</p>
      </form>}
      <p ref={errorRef} className="commerce-error" role="alert" tabIndex={-1} hidden={!error}>{error}</p>
      {configError && <div className="commerce-connection-error"><p role="status">{configError}</p><button type="button" onClick={() => { setConfigError(''); configRequest().then(setConfig).catch(cause => setConfigError(messageOf(cause))); }}>다시 연결</button></div>}
    </>}
    <dialog className="commerce-postcode-dialog" ref={postcodeDialog} aria-labelledby="postcode-title"><div className="commerce-postcode-heading"><h4 id="postcode-title">주소 검색</h4><button type="button" onClick={() => postcodeDialog.current?.close()} aria-label="주소 검색 닫기">닫기</button></div><div className="commerce-postcode-container" ref={postcodeContainer}/></dialog>
  </div>;
}

export function PaymentReturn() {
  const [query] = useState(() => new URLSearchParams(location.search));
  const [saved] = useState(readSession);
  const [config, setConfig] = useState<CommerceConfig | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const running = useRef(false);
  const isSuccess = location.pathname.endsWith('/success');
  const orderId = query.get('orderId') || saved?.orderId;
  async function check() {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try {
      if (!saved?.orderId || saved.orderId !== orderId || !saved.accessToken) throw new CheckoutError('이 브라우저에 주문 확인 정보가 없습니다. 주문 조회에서 확인해 주세요.');
      const resumed = await api<OrderResult>({ action: 'resume', orderId: saved.orderId, accessToken: saved.accessToken });
      if (resumed.completed) { setResult(resumed); return; }
      if (isSuccess) {
        const amount = query.get('amount'); const paymentKey = query.get('paymentKey');
        if (!paymentKey || !amount || !/^\d+$/.test(amount) || Number(amount) !== saved.amount) throw new CheckoutError('결제 확인 정보가 일치하지 않습니다. 주문 조회 또는 고객센터에서 확인해 주세요.');
        setResult(await api<OrderResult>({ action: 'confirm', orderId: saved.orderId, accessToken: saved.accessToken, paymentKey, amount: Number(amount) }));
      } else setResult(await api<OrderResult>({ action: 'payment-cancel', orderId: saved.orderId, accessToken: saved.accessToken }));
    } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); running.current = false; }
  }
  useEffect(() => { configRequest().then(setConfig).catch(() => {}); void check(); }, []);
  useEffect(() => { if (result?.completed) history.replaceState({}, '', location.pathname); }, [result]);
  async function retryPayment() {
    if (!saved || !config || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const resumed = await api<OrderResult>({ action: 'resume', orderId: saved.orderId, accessToken: saved.accessToken });
      setResult(resumed);
      if (resumed.completed) return;
      ensurePayable(resumed, config);
      await openPayment(config, saved);
    } catch (cause) { setError(messageOf(cause)); } finally { running.current = false; setBusy(false); }
  }
  const canRetryPayment = !!config?.paymentReady && result?.order.route === 'direct' && result.order.paymentState === 'pending';
  return <div className="commerce-route-page">
    {result?.completed ? <CommerceReceipt order={result.order} config={config}/> : <section className="commerce-return">
      <p className="commerce-kicker">MNÉ · 주문</p>
      <h1>{busy ? '주문을 확인하고 있습니다.' : result ? '결제 상태를 확인해 주세요.' : '주문 확인이 필요합니다.'}</h1>
      <p>{busy ? '창을 닫지 말고 잠시 기다려 주세요.' : isSuccess ? '확인이 지연될 수 있습니다. 같은 주문으로 다시 확인하면 중복 결제를 방지할 수 있습니다.' : result ? '입력하신 주문은 보관되어 있습니다. 결제 대기 중인 주문은 같은 주문으로 결제를 다시 진행할 수 있습니다.' : '접수 여부를 확인하지 못했습니다. 아래에서 다시 확인하거나 주문 조회를 이용해 주세요.'}</p>
      {saved?.orderId && <p className="commerce-reference">{saved.orderId}</p>}
      {error && <p className="commerce-error" role="alert">{error}</p>}
      <div className="commerce-actions">
        {!isSuccess && canRetryPayment && <button className="commerce-primary" disabled={busy} onClick={retryPayment}>결제 다시 진행 <Arrow/></button>}
        {saved && <button className={canRetryPayment && !isSuccess ? 'commerce-text-button' : 'commerce-primary'} disabled={busy} onClick={check}>결제 상태 다시 확인 {!canRetryPayment && <Arrow/>}</button>}
        <a className="commerce-text-button" href="/orders">주문 조회</a><a className="commerce-text-button" href="/">홈으로</a>
      </div>
    </section>}
  </div>;
}
