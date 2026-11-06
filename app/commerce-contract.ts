import type { PreferredNote } from './order-contract';

export const COMMERCE_PRODUCT = { name: '기억 향초', volume: '120ml', amount: 35000, currency: 'KRW', shipping: 0 } as const;
export const CONSENT_VERSION = '2026-11-06-v1';
export const FULFILLMENT_STEPS = ['접수', '분석완료', '제작중', '시향지발송', '선택완료', '본품발송', '완료'] as const;
export type FulfillmentStatus = typeof FULFILLMENT_STEPS[number];
export type PaymentMode = 'unconfigured' | 'test' | 'live';
export type PaymentState = 'pending' | 'confirming' | 'paid' | 'prepaid' | 'canceled' | 'review';
export type CommerceDraft = { description: string; preferredNote: PreferredNote; customerName: string; phone: string };
export type ShippingAddress = { recipientName: string; phone: string; postcode: string; address: string; detail: string; memo?: string };
export type CommerceConsents = { customOrder: boolean; privacy: boolean; terms: boolean; marketing: boolean; version: string };
export type CreateOrderInput = {
  route: 'direct' | 'external'; requestId: string;
  /** Generate 32 random bytes in the browser; keep in sessionStorage for safe retry. Never put in a URL. */
  accessToken: string;
  draft: CommerceDraft; consents: CommerceConsents; shipping?: ShippingAddress; code?: string;
};
export type CommerceConfig = {
  paymentReady: boolean; paymentMode: PaymentMode; clientKey: string | null;
  orderName: string; amount: number; shippingEstimate: string; supportEmail: string;
  policiesReady?: boolean;
  merchant?: { businessName: string; representative: string; businessNumber: string; commerceNumber: string; address: string; supportPhone: string; supportEmail: string; privacyOfficer: string };
};
export type OrderSummary = {
  orderId: string; route: 'direct' | 'external'; status: FulfillmentStatus;
  paymentState: PaymentState; amount: number; currency: 'KRW'; productName: string;
  preferredNote: PreferredNote; customerNameMasked: string; phoneMasked: string;
  receivedAt: string; paidAt?: string; paymentMode: PaymentMode;
  shippingEstimate: string; notificationStatus: 'manual_pending' | 'not_requested';
  tracking?: { carrier: string; number: string };
};
export type OrderResult = {
  orderId: string; accessToken?: string; status: FulfillmentStatus; amount: number;
  mode: PaymentMode; completed: boolean; order: OrderSummary;
};
export type VerifyCodeResult = { valid: true; completed: boolean; order?: OrderSummary };
export type CommerceError = { error: string; code: string; retryable?: boolean };

/** /api/commerce: GET => CommerceConfig. All customer POST requests require same-origin.
 * create: multipart { action: 'create', payload: JSON.stringify(CreateOrderInput), photo: File }
 * verify-code: JSON { action: 'verify-code', code, phone } => VerifyCodeResult
 * confirm: JSON { action: 'confirm', orderId, accessToken, paymentKey, amount } => OrderResult
 * resume: JSON { action: 'resume', orderId, accessToken } => OrderResult (reconciles pending payment)
 * payment-cancel: JSON { action: 'payment-cancel', orderId, accessToken } => OrderResult; saves draft, never refunds
 * lookup: JSON { action: 'lookup', reference: orderIdOrExternalCode, phone } => { order: OrderSummary }
 * admin-list: JSON { action: 'admin-list', cursor?: string } => { orders: AdminOrder[], cursor?: string }
 * admin-list-codes: JSON { action: 'admin-list-codes', cursor?: string } => { codes: AdminCode[], cursor?: string }
 * admin-issue-code: JSON { action: 'admin-issue-code', customerName, phone, channel, shipping, externalOrderReference, testOnly? } => { code }; identical external purchase retries return the same code
 * admin-reconcile: JSON { action: 'admin-reconcile', orderId } => { order: OrderSummary }; reads the provider, never initiates a payment
 * admin-update: JSON { action: 'admin-update', orderId, status, tracking?: {carrier,number} } => { order }
 * admin-photo: JSON { action: 'admin-photo', orderId } => binary image response
 * admin-sync: JSON { action: 'admin-sync', orderId } => { synced: boolean }
 * admin-delete-test: JSON { action: 'admin-delete-test', orderId } => { deleted: true }; test-mode records only
 * Admin requests require Authorization: Bearer MNE_ADMIN_TOKEN, including photo downloads.
 */
export type AdminOrder = OrderSummary & {
  customerName: string; phone: string; description: string; shipping: ShippingAddress;
  code?: string; channel?: string; externalOrderReference?: string; hasPhoto: boolean; consents: CommerceConsents & { acceptedAt: string };
  sheetSync: 'pending' | 'synced' | 'failed';
};
export type AdminCode = {
  code: string; customerName: string; phone: string; channel: string;
  externalOrderReference?: string; shipping: ShippingAddress; issuedAt: string;
  completed: boolean; orderId?: string;
};
