import { CommerceFailure } from './commerce-validation';
import type { PaymentMode } from '../../app/commerce-contract';

export type Environment = Record<string, string | undefined>;
export type ProviderPayment = { paymentKey: string; orderId: string; totalAmount: number; currency: string; status: string; approvedAt?: string; method?: string; balanceAmount?: number };
export interface PaymentProvider {
  mode: Exclude<PaymentMode, 'unconfigured'>;
  find(orderId: string): Promise<ProviderPayment | null>;
  confirm(orderId: string, paymentKey: string, amount: number): Promise<ProviderPayment>;
}
export function paymentSettings(env: Environment) {
  const clientKey = env.MNE_TOSS_CLIENT_KEY ?? '', secretKey = env.MNE_TOSS_SECRET_KEY ?? '';
  const mode: PaymentMode = clientKey.startsWith('test_ck_') && secretKey.startsWith('test_sk_') ? 'test' : clientKey.startsWith('live_ck_') && secretKey.startsWith('live_sk_') ? 'live' : 'unconfigured';
  const enabled = env.MNE_PAYMENT_ENABLED === 'true' && mode !== 'unconfigured';
  return { enabled, mode: enabled ? mode : 'unconfigured' as PaymentMode, clientKey: enabled ? clientKey : null, secretKey };
}
export function tossProvider(env: Environment, fetcher: typeof fetch): PaymentProvider | null {
  const settings = paymentSettings(env);
  // Turning off new checkout must not prevent operators from reconciling existing payments.
  const mode = env.MNE_TOSS_CLIENT_KEY?.startsWith('test_ck_') && settings.secretKey.startsWith('test_sk_') ? 'test' : env.MNE_TOSS_CLIENT_KEY?.startsWith('live_ck_') && settings.secretKey.startsWith('live_sk_') ? 'live' : null;
  if (!mode) return null;
  const authorization = `Basic ${Buffer.from(`${settings.secretKey}:`).toString('base64')}`;
  async function call(path: string, init?: RequestInit): Promise<ProviderPayment | null> {
    let response: Response;
    try { response = await fetcher(`https://api.tosspayments.com/v1/payments${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init?.headers }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new CommerceFailure('PAYMENT_UNCERTAIN', '결제 결과를 확인 중입니다. 다시 확인해 주세요. 중복 결제하지 않습니다.', 503, true); }
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 404 && ['NOT_FOUND_PAYMENT', 'NOT_FOUND_PAYMENT_SESSION'].includes(String(value.code))) return null;
    if (!response.ok) throw new CommerceFailure('PAYMENT_UNCERTAIN', '결제 결과를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.', 503, true);
    return value as ProviderPayment;
  }
  return {
    mode,
    find: orderId => call(`/orders/${encodeURIComponent(orderId)}`),
    async confirm(orderId, paymentKey, amount) {
      if (!settings.enabled) throw new CommerceFailure('PAYMENT_UNAVAILABLE', '새 결제 승인이 중지되어 있습니다.', 503);
      const result = await call('/confirm', { method: 'POST', headers: { 'Idempotency-Key': `mne-confirm-${orderId}` }, body: JSON.stringify({ orderId, paymentKey, amount }) });
      if (!result) throw new CommerceFailure('PAYMENT_UNCERTAIN', '결제 승인 결과를 다시 확인해 주세요.', 503, true);
      return result;
    },
  };
}
export function verifyPayment(payment: ProviderPayment, orderId: string, paymentKey: string | undefined, amount: number) {
  if (payment.orderId !== orderId || payment.totalAmount !== amount || payment.currency !== 'KRW' || typeof payment.paymentKey !== 'string' || !payment.paymentKey || (paymentKey && payment.paymentKey !== paymentKey)) throw new CommerceFailure('PAYMENT_MISMATCH', '결제 정보가 주문과 일치하지 않습니다. 고객센터에 문의해 주세요.', 409);
}
