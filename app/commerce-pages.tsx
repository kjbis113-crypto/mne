import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Arrow } from './arrow';
import { COMMERCE_PRODUCT, CONSENT_VERSION, FULFILLMENT_STEPS, type AdminCode, type AdminOrder, type CommerceConfig, type FulfillmentStatus, type OrderSummary, type ShippingAddress } from './commerce-contract';

type Merchant = { businessName?: string; representative?: string; businessNumber?: string; commerceNumber?: string; address?: string; supportPhone?: string; supportEmail?: string; privacyOfficer?: string };
type PublicConfig = CommerceConfig & { merchant?: Merchant; policiesReady?: boolean };
const pending = '등록 예정';
const formatDate = (date: string) => { const value = new Date(date); return Number.isNaN(value.getTime()) ? '확인 중' : value.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }); };
const formatMoney = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
const noteLabels: Record<string, string> = { Fruity: '프루티', Floral: '플로럴', Fresh: '프레시', Woody: '우디', Balsamic: '발사믹' };
const paymentLabels: Record<OrderSummary['paymentState'], string> = { pending: '결제 대기', confirming: '결제 확인 중', paid: '결제 완료', prepaid: '외부 채널 결제 확인', canceled: '결제 취소', review: '결제 확인 필요' };
const isPaid = (order: OrderSummary) => order.paymentState === 'paid' || order.paymentState === 'prepaid';

function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/commerce', { signal: controller.signal }).then(async response => {
      if (response.ok) setConfig(await response.json());
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  return config;
}

async function commerceRequest<T>(body: object, token?: string): Promise<T> {
  const response = await fetch('/api/commerce', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '연결을 확인한 뒤 다시 시도해 주세요.');
  return result as T;
}

function CommerceHeader() {
  return <header className="site-header commerce-page-header">
    <a className="fixed-brand" href="/" aria-label="MNÉ 홈"><span className="brand-logo"><img src="/mne-brand-logo.png" width="2481" height="3508" alt="MNÉ" /></span></a>
    <nav className="commerce-page-nav" aria-label="주요 메뉴"><a href="/order#memory">향 만들기</a><a href="/orders">주문 조회</a></nav>
  </header>;
}

export function CommerceFooter() {
  const config = usePublicConfig();
  const merchant: Merchant = config?.merchant || {};
  const email = merchant.supportEmail || config?.supportEmail;
  return <footer className="commerce-footer">
    <div className="commerce-footer-top"><a href="/" aria-label="MNÉ 홈">MNÉ</a><nav aria-label="고객 안내"><a href="/orders">주문 조회</a><a href="/terms">이용약관</a><a href="/privacy"><strong>개인정보처리방침</strong></a><a href="/refund">취소·교환·환불</a></nav></div>
    <dl className="merchant-details">
      <div><dt>상호</dt><dd>{merchant.businessName || pending}</dd></div><div><dt>대표</dt><dd>{merchant.representative || pending}</dd></div>
      <div><dt>사업자등록번호</dt><dd>{merchant.businessNumber || pending}</dd></div><div><dt>통신판매업 신고번호</dt><dd>{merchant.commerceNumber || pending}</dd></div>
      <div className="merchant-address"><dt>주소</dt><dd>{merchant.address || pending}</dd></div>
      <div><dt>고객센터</dt><dd>{merchant.supportPhone ? <a href={`tel:${merchant.supportPhone.replace(/[^+\d]/g, '')}`}>{merchant.supportPhone}</a> : pending}{email && <> · <a href={`mailto:${email}`}>{email}</a></>}</dd></div>
      <div><dt>개인정보 보호책임자</dt><dd>{merchant.privacyOfficer || pending}</dd></div><div><dt>호스팅</dt><dd>Netlify</dd></div>
    </dl>
    <div className="commerce-footer-bottom"><span>© {new Date().getFullYear()} MNÉ</span><a href="https://www.ftc.go.kr/www/bizCommList.do?key=232" target="_blank" rel="noreferrer">사업자 정보 확인 <Arrow /></a></div>
  </footer>;
}

function PageFrame({ children }: { children: ReactNode }) { return <><CommerceHeader /><main className="commerce-page">{children}</main><CommerceFooter /></>; }

export function OrderStatusCard({ order }: { order: OrderSummary }) {
  const paid = isPaid(order);
  return <section className="commerce-order-summary" aria-label="주문 정보">
    <div className="commerce-summary-top"><span>{order.paymentMode === 'test' ? '테스트 주문' : paymentLabels[order.paymentState]}</span><strong>{paid ? order.status : '제작 보류'}</strong></div>
    <h2>{order.productName}</h2><p className="commerce-muted">{COMMERCE_PRODUCT.volume} · 시향지 3종 + 선택한 향의 향초</p>
    <dl className="commerce-summary-list">
      <div><dt>주문 번호</dt><dd className="commerce-reference">{order.orderId}</dd></div><div><dt>주문일</dt><dd>{formatDate(order.receivedAt)}</dd></div>
      <div><dt>주문자</dt><dd>{order.customerNameMasked} · {order.phoneMasked}</dd></div><div><dt>선호하는 향</dt><dd>{noteLabels[order.preferredNote] || order.preferredNote}</dd></div>
      <div><dt>{order.route === 'external' ? '결제 경로' : '주문 금액'}</dt><dd>{order.route === 'external' ? '외부 구매처에서 결제' : `${formatMoney(order.amount)} · 배송비 포함`}</dd></div>
      <div><dt>제작·배송</dt><dd>{order.shippingEstimate || '일정 확인 후 개별 안내'}</dd></div>
      {order.tracking && <div><dt>운송장</dt><dd>{order.tracking.carrier} · {order.tracking.number}</dd></div>}
    </dl>
    {paid && <ol className="commerce-progress" aria-label="진행 단계">{FULFILLMENT_STEPS.map((step, index) => <li key={step} className={index <= FULFILLMENT_STEPS.indexOf(order.status) ? 'reached' : ''} aria-current={step === order.status ? 'step' : undefined}><span>{index + 1}</span>{step}</li>)}</ol>}
    {order.notificationStatus === 'manual_pending' && <p className="commerce-muted commerce-receipt-note">접수 내역이 저장되었습니다. 필요한 안내는 주문 시 남긴 연락처로 드립니다.</p>}
  </section>;
}

export function OrderLookup() {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setOrder(null); setBusy(true);
    try { const result = await commerceRequest<{ order: OrderSummary }>({ action: 'lookup', reference: reference.trim(), phone }); setOrder(result.order); requestAnimationFrame(() => resultRef.current?.focus()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '주문 정보를 확인하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  return <PageFrame><div className="commerce-page-intro"><h1>주문 조회</h1><p>주문 번호 또는 외부 구매 식별번호와<br />주문 시 입력한 연락처를 알려 주세요.</p></div>
    <div className="commerce-lookup-layout"><form className="commerce-panel commerce-form" onSubmit={submit}>
      <label htmlFor="lookup-reference">주문 번호 또는 식별번호<input id="lookup-reference" autoComplete="off" autoCapitalize="characters" maxLength={80} required value={reference} onChange={event => setReference(event.target.value)} placeholder="주문 번호 또는 MNÉ-4K7P2" /></label>
      <label htmlFor="lookup-phone">휴대전화 번호<input id="lookup-phone" type="tel" autoComplete="tel" required maxLength={24} value={phone} onChange={event => setPhone(event.target.value)} placeholder="010-0000-0000" /></label>
      <p className="commerce-muted">식별번호의 영문 대소문자는 구분하지 않습니다.</p>
      {error && <p className="commerce-error" role="alert">{error}</p>}
      <button type="submit" className="commerce-solid-button" disabled={busy}>{busy ? '확인 중…' : '주문 확인하기'}</button>
    </form><div ref={resultRef} tabIndex={-1} className="commerce-lookup-result" aria-live="polite">{order ? <OrderStatusCard order={order} /> : <p className="commerce-muted">주문 접수부터 완성된 향초가 도착하기까지,<br />이곳에서 진행 상황을 확인할 수 있습니다.</p>}</div></div>
  </PageFrame>;
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' | 'refund' }) {
  const config = usePublicConfig();
  const merchant: Merchant = config?.merchant || {};
  const titles = { terms: '이용약관', privacy: '개인정보처리방침', refund: '취소·교환·환불 안내' };
  const contact = merchant.supportEmail || config?.supportEmail || merchant.supportPhone || '고객센터 연락처 등록 예정';
  return <PageFrame><article className="commerce-legal"><div className="commerce-page-intro"><h1>{titles[kind]}</h1><p>문서 버전 {CONSENT_VERSION}</p></div>
    {!config?.policiesReady && <aside className="commerce-policy-notice">운영 정책 검토 중인 안내문입니다. 판매자 정보, 보유기간과 처리업체 등 미정 항목을 확정한 뒤 실제 결제가 열립니다.</aside>}
    {kind === 'terms' && <>
      <section><h2>1. 서비스와 상품</h2><p>MNÉ는 고객이 제공한 사진과 기억의 글, 선호하는 향 계열을 바탕으로 맞춤 향초를 제작합니다. 기억 향초의 용량은 120ml이며, 주문 금액은 배송비를 포함해 35,000원입니다. 시향지 3종과 그중 선택한 향으로 제작한 향초가 포함됩니다.</p></section>
      <section><h2>2. 주문과 결제</h2><p>사진과 기억을 입력하고 향 계열을 고른 뒤 주문자·배송 정보 및 필수 동의를 확인해 결제합니다. 결제 승인과 서버의 확인이 완료되면 주문 번호가 발급됩니다. 결제창을 닫거나 승인에 실패한 경우 결제가 완료된 주문으로 처리하지 않습니다.</p><p>외부 판매 채널에서 이미 구매한 고객은 해당 구매와 연결된 식별번호 및 연락처를 확인해 기억을 접수합니다. 같은 주문에 대해 추가 결제를 요청하지 않으며, 배송 정보는 외부 구매처에 등록된 내용을 따릅니다.</p></section>
      <section><h2>3. 제작과 배송</h2><p>접수 후 향 분석, 시향지 제작·발송, 향 선택, 본품 제작·발송 순서로 진행됩니다. 제작 및 배송 예상 일정은 주문 화면과 접수 안내에서 확인할 수 있습니다. 현재 안내 일정: {config?.shippingEstimate || '확정 후 개별 안내'}.</p><p>입력한 사진과 글은 주문 제작에 필요한 범위에서 사용됩니다. 공개 아카이브 게시나 광고 활용에는 주문 동의와 별도의 허락을 받습니다. 다른 사람의 권리를 침해하거나 민감한 개인정보가 포함된 자료는 올리지 말아 주세요.</p></section>
      <section><h2>4. 주문 변경과 소비자 권리</h2><p>주문 변경 또는 취소는 제작 진행 상태를 확인한 후 안내합니다. 개별 제작에 따른 제한과 하자·오배송에 대한 처리는 <a href="/refund">취소·교환·환불 안내</a>를 따릅니다. 이 안내가 관련 법령에 따른 소비자의 권리를 제한하지는 않습니다.</p></section>
      <section><h2>5. 문의와 약관 변경</h2><p>주문 관련 문의는 {contact}로 접수합니다. 약관이 변경되면 적용일과 변경 사항을 공지하며, 이미 성립한 주문의 조건을 일방적으로 불리하게 변경하지 않습니다.</p></section>
    </>}
    {kind === 'privacy' && <>
      <section><h2>1. 수집 항목과 이용 목적</h2><div className="commerce-table-scroll"><table><thead><tr><th>구분</th><th>항목</th><th>목적</th></tr></thead><tbody>
        <tr><td>주문 접수</td><td>이름, 휴대전화 번호, 사진, 기억의 글, 향 계열</td><td>주문 확인, 맞춤 향 분석·제작, 고객 안내</td></tr>
        <tr><td>배송</td><td>수령인, 연락처, 주소, 배송 요청사항</td><td>시향지와 향초 배송</td></tr>
        <tr><td>거래·동의 기록</td><td>주문 번호, 결제 상태·금액, 구매 채널, 식별번호, 동의 항목·버전·일시</td><td>거래 확인, 중복 접수 방지, 분쟁 대응</td></tr>
        <tr><td>마케팅 (선택)</td><td>휴대전화 번호, 수신 동의 기록</td><td>동의한 고객에 한해 브랜드 소식 안내</td></tr>
      </tbody></table></div><p>필수 정보 제공에 동의하지 않을 수 있으나, 해당 정보가 없으면 주문 제작·배송이 어렵습니다. 마케팅 동의는 선택사항이며 거부해도 주문에 영향을 주지 않습니다.</p></section>
      <section><h2>2. 보유기간과 파기</h2><p>사진·기억의 글 및 마케팅 정보의 구체적인 보유기간은 운영 정책 확정 후 공개합니다. 목적을 달성하거나 보유기간이 끝난 개인정보는 관련 법령에 따라 필요한 거래 기록을 제외하고 파기합니다. 법정 보관 대상은 일반 운영 자료와 구분해 관리합니다.</p><p className="commerce-muted">사진·기억 보유기간 및 파기 절차: 확정 예정. 실제 주문 개통 전 확정이 필요한 항목입니다.</p></section>
      <section><h2>3. 처리업체와 외부 서비스</h2><p>웹사이트는 Netlify에서 호스팅됩니다. 주문 저장, 운영용 Google Sheets 연동, 결제 처리, 배송 및 문자 발송에 사용하는 업체와 업무 범위, 보관 위치 및 국외이전 사항은 운영 구성이 확정된 후 안내합니다. 고객의 사진과 기억을 공개 게시물로 자동 전환하지 않습니다.</p></section>
      <section><h2>4. 고객의 권리와 문의</h2><p>개인정보 열람·정정·삭제·처리정지 및 선택 동의 철회는 고객센터로 요청할 수 있습니다. 본인 확인 후 관련 법령에 따라 처리하며, 보관 의무가 있는 거래 기록은 의무가 끝날 때까지 제한적으로 보관할 수 있습니다.</p><p>개인정보 보호책임자: {merchant.privacyOfficer || pending}<br />문의: {contact}</p></section>
      <section><h2>5. 안전한 관리</h2><p>주문과 사진은 공개 페이지에 노출하지 않으며, 주문 조회에는 주문 번호 또는 식별번호와 연락처 확인이 필요합니다. 관리 기능은 별도 인증을 거친 운영자만 사용할 수 있습니다. 개인정보처리방침을 변경할 때에는 변경 내용과 적용일을 안내합니다.</p></section>
    </>}
    {kind === 'refund' && <>
      <section><h2>제작 전 변경·취소</h2><p>사진, 기억, 향 계열 또는 배송 정보를 변경하고 싶다면 주문 번호와 함께 고객센터에 알려 주세요. 진행 상태를 확인한 뒤 가능한 변경과 취소 절차를 안내합니다.</p></section>
      <section><h2>개별 제작에 따른 제한</h2><p>이 향초는 고객님의 기억을 바탕으로 개별 제작됩니다. 사전에 안내하고 별도 동의를 받은 범위에서, 제작이 시작된 후 단순 변심에 따른 취소·환불이 제한될 수 있습니다. 결제 전 해당 안내에 대한 별도 동의를 받습니다.</p><p>구체적인 제작 착수 시점, 취소 가능 범위 및 반품 비용은 운영 정책 확정 후 안내합니다.</p></section>
      <section><h2>하자·오배송</h2><p>주문 내용과 다르게 제작되었거나 제품에 하자가 있는 경우에는 교환·환불 대상입니다. 수령한 제품과 포장 상태를 보관하고 고객센터에 주문 번호 및 상태를 알려 주세요. 개별 제작에 대한 동의가 하자나 계약 내용 불일치에 관한 권리를 제한하지 않습니다.</p></section>
      <section><h2>외부 채널 구매</h2><p>외부 판매 채널에서 결제한 주문의 결제 취소와 환불은 해당 구매처의 접수 절차를 함께 확인합니다. MNÉ에 기억을 접수했다는 이유로 동일 주문을 중복 결제하지 않습니다.</p></section>
      <section><h2>접수 방법</h2><p>문의: {contact}<br />반품 주소: {merchant.address || '확정 후 안내'}</p><p>반품 전 고객센터의 안내를 받아 주세요. 상품 안전 확인·신고 정보와 최종 운영 정책은 판매 개시 전 공개합니다.</p></section>
    </>}
  </article></PageFrame>;
}

const emptyShipping: ShippingAddress = { recipientName: '', phone: '', postcode: '', address: '', detail: '', memo: '' };
type IssueForm = { customerName: string; phone: string; channel: string; externalOrderReference: string; shipping: ShippingAddress };
const emptyIssue: IssueForm = { customerName: '', phone: '', channel: '', externalOrderReference: '', shipping: emptyShipping };

export function AdminPage() {
  const [entryToken, setEntryToken] = useState('');
  const [token, setToken] = useState('');
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [codes, setCodes] = useState<AdminCode[]>([]);
  const [codeCursor, setCodeCursor] = useState<string | undefined>();
  const [codesLoaded, setCodesLoaded] = useState(false);
  const [codeFilter, setCodeFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [issue, setIssue] = useState<IssueForm>(emptyIssue);
  const [issuedCode, setIssuedCode] = useState('');
  const [status, setStatus] = useState<FulfillmentStatus>('접수');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [filter, setFilter] = useState('');
  const config = usePublicConfig();
  const selected = orders.find(order => order.orderId === selectedId);
  const canFulfill = Boolean(selected && selected.paymentMode === 'live' && isPaid(selected));
  useEffect(() => { document.title = '운영 관리 · MNÉ'; }, []);
  useEffect(() => { if (selected) { setStatus(selected.status); setCarrier(selected.tracking?.carrier || ''); setTracking(selected.tracking?.number || ''); } }, [selected]);
  async function load(auth: string, nextCursor?: string) {
    const result = await commerceRequest<{ orders: AdminOrder[]; cursor?: string }>({ action: 'admin-list', ...(nextCursor ? { cursor: nextCursor } : {}) }, auth);
    setOrders(previous => nextCursor ? [...previous, ...result.orders.filter(order => !previous.some(item => item.orderId === order.orderId))] : result.orders); setCursor(result.cursor);
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await load(entryToken.trim()); setToken(entryToken.trim()); setEntryToken(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '인증하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function logout() { setToken(''); setEntryToken(''); setOrders([]); setCursor(undefined); setCodes([]); setCodeCursor(undefined); setCodesLoaded(false); setCodeFilter(''); setSelectedId(''); setIssue(emptyIssue); setIssuedCode(''); setError(''); setNotice(''); }
  async function act(operation: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); }
  }
  function mergeSummary(summary: OrderSummary) {
    setOrders(previous => previous.map(order => order.orderId === summary.orderId ? { ...order, ...summary, hasPhoto: isPaid(summary) } : order));
  }
  async function reconcileOrder(orderId: string) {
    const result = await commerceRequest<{ order: OrderSummary }>({ action: 'admin-reconcile', orderId }, token);
    mergeSummary(result.order);
    return result.order;
  }
  async function loadCodes(nextCursor?: string) {
    const result = await commerceRequest<{ codes: AdminCode[]; cursor?: string }>({ action: 'admin-list-codes', ...(nextCursor ? { cursor: nextCursor } : {}) }, token);
    setCodes(previous => nextCursor ? [...previous, ...result.codes.filter(code => !previous.some(item => item.code === code.code))] : result.codes);
    setCodeCursor(result.cursor); setCodesLoaded(true);
  }
  async function issueCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); await act(async () => {
      const result = await commerceRequest<{ code: string }>({ action: 'admin-issue-code', ...issue }, token); setIssuedCode(result.code); setNotice('식별번호가 발급되었습니다. 아래 안내를 복사해 구매자에게 직접 보내 주세요.');
    });
  }
  function codeMessage(code: string) {
    const link = `${window.location.origin}/order?code=${encodeURIComponent(code)}`;
    return `[MNÉ] 기억을 향으로 남길 준비가 되었어요.\n간직하고 싶은 순간을 들려주세요.\n아래 링크에서 바로 시작할 수 있어요.\n식별번호: ${code}\n링크: ${link}${config?.supportEmail ? `\n문의: ${config.supportEmail}` : ''}`;
  }
  const sms = issuedCode ? codeMessage(issuedCode) : '';
  async function updateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !canFulfill) return;
    await act(async () => {
      try {
        const result = await commerceRequest<{ order: OrderSummary }>({ action: 'admin-update', orderId: selected.orderId, status, ...((carrier.trim() || tracking.trim()) ? { tracking: { carrier: carrier.trim(), number: tracking.trim() } } : {}) }, token);
        mergeSummary(result.order); setNotice('진행 상태가 저장되었습니다.');
      } catch (cause) {
        if (selected.route === 'direct') await reconcileOrder(selected.orderId).catch(() => {});
        throw cause;
      }
    });
  }
  async function downloadPhoto() {
    if (!selected || !canFulfill) return;
    await act(async () => {
      const response = await fetch('/api/commerce', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'admin-photo', orderId: selected.orderId }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || '사진을 가져오지 못했습니다.'); }
      const blob = await response.blob(); const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type] || 'jpg';
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selected.orderId}.${extension}`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const filtered = orders.filter(order => [order.orderId, order.customerName, order.phone, order.status, paymentLabels[order.paymentState], order.code || ''].join(' ').toLowerCase().includes(filter.toLowerCase()));
  const filteredCodes = codes.filter(code => [code.code, code.customerName, code.phone, code.channel, code.externalOrderReference || ''].join(' ').toLowerCase().includes(codeFilter.toLowerCase()));
  return <PageFrame><div className="commerce-page-intro commerce-admin-heading"><div><h1>운영 관리</h1><p>주문 접수와 제작 진행을 관리합니다.</p></div>{token && <button className="commerce-outline-button" disabled={busy} onClick={logout}>로그아웃</button>}</div>
    {!token ? <form className="commerce-panel commerce-form commerce-admin-login" onSubmit={login}><label htmlFor="admin-access">관리자 인증키<input id="admin-access" type="password" autoComplete="off" spellCheck={false} required value={entryToken} onChange={event => setEntryToken(event.target.value)} /></label><p className="commerce-muted">인증키는 이 화면에만 유지되며 새로고침하면 지워집니다.</p>{error && <p role="alert" className="commerce-error">{error}</p>}<button className="commerce-solid-button" disabled={busy}>{busy ? '확인 중…' : '관리 화면 열기'}</button></form> : <>
      <div className="commerce-admin-alerts" aria-live="polite">{error && <p className="commerce-error" role="alert">{error}</p>}{notice && <p className="commerce-notice" role="status">{notice}</p>}</div>
      <section className="commerce-admin-section"><div className="commerce-admin-section-title"><h2>주문 목록</h2><button disabled={busy} className="commerce-outline-button" onClick={() => act(() => load(token))}>새로고침</button></div>
        <p className="commerce-muted commerce-admin-list-note">결제 전·확인 중인 주문도 표시됩니다. 결제 상태를 확인한 주문만 제작해 주세요. 목록 새로고침은 저장된 기록을 불러옵니다.</p>
        <label className="commerce-search">목록에서 찾기<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="주문 번호, 이름, 연락처, 결제·진행 상태" /></label>
        <div className="commerce-table-scroll"><table className="commerce-admin-table"><thead><tr><th>접수일 / 주문 번호</th><th>주문자</th><th>향</th><th>결제</th><th>진행</th><th>상세</th></tr></thead><tbody>{filtered.map(order => <tr key={order.orderId} className={order.orderId === selectedId ? 'selected' : ''}><td>{formatDate(order.receivedAt)}<small>{order.orderId}</small></td><td>{order.customerName}<small>{order.phone}</small></td><td>{noteLabels[order.preferredNote]}</td><td><span className={`commerce-payment-state ${isPaid(order) ? 'confirmed' : 'held'}`}>{paymentLabels[order.paymentState]}</span></td><td>{isPaid(order) ? order.status : '제작 보류'}</td><td><button disabled={busy} aria-label={`${order.customerName} 주문 상세`} className="commerce-text-button" onClick={() => setSelectedId(order.orderId)}>보기</button></td></tr>)}</tbody></table></div>
        {!filtered.length && <p className="commerce-empty">표시할 주문이 없습니다.</p>}{cursor && <button disabled={busy} className="commerce-outline-button" onClick={() => act(() => load(token, cursor))}>주문 더 보기</button>}
      </section>
      {selected && <section className="commerce-admin-detail commerce-panel"><div className="commerce-admin-section-title"><h2>{selected.customerName}님의 주문</h2><button disabled={busy} className="commerce-text-button" onClick={() => setSelectedId('')}>닫기</button></div><p className="commerce-reference commerce-muted">{selected.orderId}</p>
        <div className="commerce-admin-payment"><div><span className={`commerce-payment-state ${canFulfill ? 'confirmed' : 'held'}`}>{paymentLabels[selected.paymentState]}</span><p className="commerce-muted">{selected.route === 'direct' ? `${formatMoney(selected.amount)} · Toss 결제` : '외부 구매처에서 확인한 결제'}{selected.paidAt && <> · {formatDate(selected.paidAt)}</>}</p></div>{selected.route === 'direct' && <button type="button" disabled={busy} className="commerce-outline-button" onClick={() => act(async () => { const order = await reconcileOrder(selected.orderId); setNotice(`결제 서비스 조회 결과: ${paymentLabels[order.paymentState]}. 추가 결제는 요청하지 않았습니다.`); })}>결제 상태 다시 확인</button>}</div>
        {selected.route === 'direct' && <p className="commerce-muted">결제 서비스의 현재 승인·취소 내역을 조회합니다. 결제 여부가 불확실하면 이 버튼으로 확인하고, 확인되지 않으면 제작을 보류해 주세요. 취소·환불 처리는 결제 서비스에서 별도로 진행합니다.</p>}
        {!canFulfill && <p className="commerce-notice commerce-admin-hold">결제가 확인되기 전에는 제작 진행·사진 다운로드·시트 전송을 사용할 수 없습니다. 취소 또는 일부 취소된 주문은 운영자가 내역을 확인해야 합니다.</p>}
        <div className="commerce-admin-detail-grid"><div><h3>기억</h3><p className="commerce-memory-text">{selected.description}</p><p>선호하는 향: {noteLabels[selected.preferredNote]}</p>{selected.hasPhoto && canFulfill && <button disabled={busy} className="commerce-outline-button" onClick={downloadPhoto}>사진 다운로드</button>}
        <h3>배송 정보</h3><address>{selected.shipping.recipientName} · {selected.shipping.phone}<br />({selected.shipping.postcode}) {selected.shipping.address}<br />{selected.shipping.detail}<br />{selected.shipping.memo}</address>{selected.channel && <p className="commerce-muted">구매 채널: {selected.channel} · {selected.code}{selected.externalOrderReference && <><br />구매처 주문 번호: {selected.externalOrderReference}</>}</p>}
        <details className="commerce-consent-record"><summary>동의 기록 보기</summary><p>{formatDate(selected.consents.acceptedAt)} · {selected.consents.version}</p><p>개별 제작 {selected.consents.customOrder ? '동의' : '미동의'} / 개인정보 {selected.consents.privacy ? '동의' : '미동의'} / 이용약관 {selected.consents.terms ? '동의' : '미동의'} / 마케팅 {selected.consents.marketing ? '동의' : '미동의'}</p></details>
      </div><form className="commerce-form" onSubmit={updateOrder}><label htmlFor="admin-status">진행 상태<select id="admin-status" disabled={busy || !canFulfill} value={status} onChange={event => setStatus(event.target.value as FulfillmentStatus)}>{FULFILLMENT_STEPS.map(step => <option key={step}>{step}</option>)}</select></label><label htmlFor="admin-carrier">택배사<input id="admin-carrier" disabled={busy || !canFulfill} required={Boolean(tracking.trim())} maxLength={50} value={carrier} onChange={event => setCarrier(event.target.value)} /></label><label htmlFor="admin-tracking">운송장 번호<input id="admin-tracking" disabled={busy || !canFulfill} maxLength={80} value={tracking} onChange={event => setTracking(event.target.value)} required={Boolean(carrier.trim())} /></label><button type="submit" disabled={busy || !canFulfill} className="commerce-solid-button">진행 상태 저장</button><div className="commerce-sync"><p className="commerce-muted">Google Sheets 최초 접수: {selected.sheetSync === 'synced' ? '전송 완료' : selected.sheetSync === 'failed' ? '재시도 필요' : '전송 대기'}<br />최신 결제·제작 상태는 이 관리 화면에서 확인해 주세요.</p><button type="button" className="commerce-text-button" disabled={busy || !canFulfill} onClick={() => act(async () => { const result = await commerceRequest<{ synced: boolean }>({ action: 'admin-sync', orderId: selected.orderId }, token); setNotice(result.synced ? 'Google Sheets 최초 접수 전송이 확인되었습니다.' : '연결 설정을 확인해 주세요. 주문은 안전하게 보관되어 있습니다.'); if (result.synced) setOrders(previous => previous.map(order => order.orderId === selected.orderId ? { ...order, sheetSync: 'synced' } : order)); })}>접수 전송 다시 시도</button></div></form></div></section>}
      <section className="commerce-admin-section"><div className="commerce-admin-section-title"><h2>식별번호 발급 내역</h2><button className="commerce-outline-button" disabled={busy} onClick={() => act(() => loadCodes())}>{codesLoaded ? '내역 새로고침' : '발급 내역 불러오기'}</button></div><p className="commerce-muted commerce-admin-list-note">안내를 다시 보내야 한다면 기존 번호를 찾아 사용해 주세요. 접수 대기 번호는 아직 제작 주문이 아닙니다.</p>{codesLoaded && <><label className="commerce-search">발급 내역에서 찾기<input type="search" value={codeFilter} onChange={event => setCodeFilter(event.target.value)} placeholder="식별번호, 구매처 주문 번호, 이름, 연락처" /></label><div className="commerce-table-scroll"><table className="commerce-admin-table"><thead><tr><th>발급일 / 식별번호</th><th>구매자</th><th>구매처</th><th>접수</th><th>안내</th></tr></thead><tbody>{filteredCodes.map(code => <tr key={code.code}><td>{formatDate(code.issuedAt)}<small>{code.code}</small></td><td>{code.customerName}<small>{code.phone}</small></td><td>{code.channel}<small>{code.externalOrderReference || '기존 기록 · 주문 번호 없음'}</small></td><td>{code.completed ? '접수 완료' : '접수 대기'}{code.orderId && <small>{code.orderId}</small>}</td><td>{!code.completed && <button className="commerce-text-button" disabled={busy} onClick={() => act(async () => { await navigator.clipboard.writeText(codeMessage(code.code)); setNotice(`${code.code} 안내를 복사했습니다. 아직 발송되지 않았습니다.`); })}>안내 복사</button>}</td></tr>)}</tbody></table></div>{!filteredCodes.length && <p className="commerce-empty">표시할 발급 내역이 없습니다.</p>}{codeCursor && <button className="commerce-outline-button" disabled={busy} onClick={() => act(() => loadCodes(codeCursor))}>발급 내역 더 보기</button>}</>}</section>
      <section className="commerce-admin-section"><div className="commerce-admin-section-title"><h2>외부 구매 식별번호 발급</h2></div><p className="commerce-muted">구매처에서 결제와 배송지를 확인한 주문에만 발급해 주세요. 동일한 구매 채널과 주문 번호로 같은 정보를 다시 입력하면 기존 식별번호를 가져옵니다.</p><form className="commerce-form commerce-issue-form" onSubmit={issueCode}><label>구매자 이름<input required maxLength={80} value={issue.customerName} onChange={event => setIssue({ ...issue, customerName: event.target.value })} /></label><label>구매자 휴대전화<input required type="tel" maxLength={24} value={issue.phone} onChange={event => setIssue({ ...issue, phone: event.target.value })} /></label><label>구매 채널<input required maxLength={80} value={issue.channel} onChange={event => setIssue({ ...issue, channel: event.target.value })} placeholder="예: 카카오톡 선물하기" /></label><label>외부 주문 번호<input required maxLength={120} value={issue.externalOrderReference} onChange={event => setIssue({ ...issue, externalOrderReference: event.target.value })} /></label>
        <label>수령인<input required maxLength={80} value={issue.shipping.recipientName} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, recipientName: event.target.value } })} /></label><label>수령인 연락처<input required type="tel" maxLength={24} value={issue.shipping.phone} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, phone: event.target.value } })} /></label><label>우편번호<input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={issue.shipping.postcode} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, postcode: event.target.value } })} /></label><label>주소<input required maxLength={200} value={issue.shipping.address} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, address: event.target.value } })} /></label><label>상세 주소<input required maxLength={160} value={issue.shipping.detail} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, detail: event.target.value } })} /></label><label>배송 요청사항 (선택)<input maxLength={200} value={issue.shipping.memo} onChange={event => setIssue({ ...issue, shipping: { ...issue.shipping, memo: event.target.value } })} /></label><button type="submit" disabled={busy || Boolean(issuedCode)} className="commerce-solid-button">식별번호 발급</button>
      </form>{issuedCode && <div className="commerce-issued-code"><h3>{issuedCode}</h3><textarea aria-label="구매자에게 보낼 안내" readOnly value={sms} rows={7} /><div className="commerce-button-row"><button disabled={busy} className="commerce-outline-button" onClick={() => act(async () => { await navigator.clipboard.writeText(sms); setNotice('안내 문구를 복사했습니다. 아직 발송되지 않았습니다.'); })}>안내 문구 복사</button><button className="commerce-text-button" onClick={() => { setIssuedCode(''); setIssue(emptyIssue); setNotice(''); }}>다음 구매자 발급</button></div></div>}</section>
    </>}
  </PageFrame>;
}
