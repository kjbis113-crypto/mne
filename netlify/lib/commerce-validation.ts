import { createHash, timingSafeEqual } from 'node:crypto';
import { NOTE_VALUES } from '../../app/order-contract';
import { CONSENT_VERSION, type CreateOrderInput, type ShippingAddress, type CommerceDraft, type CommerceConsents } from '../../app/commerce-contract';

export class CommerceFailure extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) { super(message); }
}
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_PHOTO_BYTES + 65536;
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommerceFailure('INVALID_INPUT', '입력 내용을 확인해 주세요.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, label: string, optional = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new CommerceFailure('INVALID_INPUT', `${label}을(를) 확인해 주세요.`);
  const trimmed = value.trim().replace(/\r\n/g, '\n');
  if (!optional && !trimmed) throw new CommerceFailure('INVALID_INPUT', `${label}을(를) 입력해 주세요.`);
  return trimmed;
}
export function phone(value: unknown): string {
  const raw = text(value, 30, '휴대전화 번호');
  if (!/^[+\d\s()-]+$/.test(raw)) throw new CommerceFailure('INVALID_PHONE', '휴대전화 번호를 확인해 주세요.');
  const result = raw.replace(/[^0-9]/g, '').replace(/^82(?=1)/, '0');
  if (!/^01[016789]\d{7,8}$/.test(result)) throw new CommerceFailure('INVALID_PHONE', '국내 휴대전화 번호를 입력해 주세요.');
  return result;
}
export function externalCode(value: unknown): string {
  const result = text(value, 20, '주문 코드').normalize('NFD').replace(/\u0301/g, '').toUpperCase().replace(/^MNE[ -]?/, '');
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(result)) throw new CommerceFailure('INVALID_CODE', '주문 코드와 연락처를 확인해 주세요.');
  return `MNE-${result}`;
}
export function accessToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new CommerceFailure('INVALID_ACCESS', '주문 접근 정보를 확인해 주세요.', 403);
  return value;
}
export function shippingAddress(value: unknown): ShippingAddress {
  const v = object(value);
  const postcode = text(v.postcode, 5, '우편번호');
  if (!/^\d{5}$/.test(postcode)) throw new CommerceFailure('INVALID_ADDRESS', '우편번호 다섯 자리를 입력해 주세요.');
  return { recipientName: text(v.recipientName, 80, '받는 분'), phone: phone(v.phone), postcode, address: text(v.address, 300, '배송 주소'), detail: text(v.detail ?? '', 200, '상세 주소', true), memo: text(v.memo ?? '', 200, '배송 메모', true) };
}
export function createInput(value: unknown): CreateOrderInput {
  const v = object(value), d = object(v.draft), c = object(v.consents);
  if (v.route !== 'direct' && v.route !== 'external') throw new CommerceFailure('INVALID_INPUT', '주문 방법을 확인해 주세요.');
  if (typeof v.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.requestId)) throw new CommerceFailure('INVALID_INPUT', '주문 요청을 새로 시작해 주세요.');
  if (!NOTE_VALUES.includes(d.preferredNote as CommerceDraft['preferredNote'])) throw new CommerceFailure('INVALID_NOTE', '선호하는 향을 선택해 주세요.');
  if (c.customOrder !== true || c.privacy !== true || c.terms !== true || c.version !== CONSENT_VERSION || typeof c.marketing !== 'boolean') throw new CommerceFailure('CONSENT_REQUIRED', '필수 안내와 동의 내용을 모두 확인해 주세요.');
  const draft: CommerceDraft = { description: text(d.description, 5000, '기억 설명'), customerName: text(d.customerName, 80, '주문자 이름'), phone: phone(d.phone), preferredNote: d.preferredNote as CommerceDraft['preferredNote'] };
  const consents: CommerceConsents = { customOrder: true, privacy: true, terms: true, marketing: c.marketing, version: CONSENT_VERSION };
  return { route: v.route, requestId: v.requestId.toLowerCase(), accessToken: accessToken(v.accessToken), draft, consents, ...(v.route === 'direct' ? { shipping: shippingAddress(v.shipping) } : { code: externalCode(v.code) }) };
}
export type PhotoData = { type: string; base64: string; digest: string; bytes: number };
export async function validatePhoto(file: FormDataEntryValue | null): Promise<PhotoData> {
  if (!(file instanceof File) || !file.size || file.size > MAX_PHOTO_BYTES) throw new CommerceFailure('INVALID_PHOTO', '4MB 이하의 JPG, PNG, WebP 또는 GIF 사진을 가져와 주세요.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12, 16).toString() === 'IHDR';
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const gif = bytes.length > 13 && /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString());
  const webp = bytes.length > 20 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  const type = png ? 'image/png' : jpeg ? 'image/jpeg' : gif ? 'image/gif' : webp ? 'image/webp' : '';
  if (!type || file.type !== type) throw new CommerceFailure('INVALID_PHOTO', '파일 내용과 형식이 일치하는 JPG, PNG, WebP 또는 GIF를 선택해 주세요.');
  return { type, base64: bytes.toString('base64'), digest: hash(bytes), bytes: bytes.length };
}
