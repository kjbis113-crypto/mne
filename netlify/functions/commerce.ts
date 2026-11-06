import type { Config, Context } from '@netlify/functions';
import { blobStorage, type CommerceStorage } from '../lib/commerce-storage';
import { publicConfig, CommerceService } from '../lib/commerce-service';
import { tossProvider, type Environment, type PaymentProvider } from '../lib/commerce-payment';
import { CommerceFailure, equalSecret, MAX_BODY_BYTES, object, validatePhoto } from '../lib/commerce-validation';

type Dependencies = {
  storage?: CommerceStorage; env?: Environment; payment?: PaymentProvider | null;
  fetcher?: typeof fetch; now?: () => number;
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });

async function boundedBody(request: Request, max: number): Promise<ArrayBuffer> {
  if (Number(request.headers.get('content-length')) > max) throw new CommerceFailure('BODY_TOO_LARGE', '사진은 4MB 이하로 선택해 주세요.', 413);
  if (!request.body) throw new CommerceFailure('INVALID_INPUT', '입력 내용을 확인해 주세요.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new CommerceFailure('BODY_TOO_LARGE', '사진은 4MB 이하로 선택해 주세요.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

/** Dependency injection lets payment/retry tests run without real charges or live records. */
export function createCommerceHandler(deps: Dependencies = {}) {
  return async (request: Request, context?: Pick<Context, 'ip'>): Promise<Response> => {
    const env = deps.env ?? process.env;
    if (request.method === 'GET') return json(publicConfig(env));
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST', 'Cache-Control': 'no-store' } });
    try {
      const origin = request.headers.get('origin'), ownOrigin = new URL(request.url).origin;
      const bearer = request.headers.get('authorization');
      if ((origin && origin !== ownOrigin) || (!origin && !bearer)) throw new CommerceFailure('INVALID_ORIGIN', '같은 웹사이트에서 다시 시도해 주세요.', 403);
      const type = request.headers.get('content-type') ?? '';
      const multipart = type.startsWith('multipart/form-data;');
      if (!multipart && !/^application\/json(?:;|$)/i.test(type)) throw new CommerceFailure('INVALID_FORMAT', '지원하지 않는 요청 형식입니다.', 415);
      let raw: Record<string, unknown>, form: FormData | undefined;
      try {
        const body = await boundedBody(request, multipart ? MAX_BODY_BYTES : 65536);
        if (multipart) {
          form = await new Response(body, { headers: { 'Content-Type': type } }).formData();
          if (form.get('action') !== 'create' || typeof form.get('payload') !== 'string') throw new Error('Invalid form');
          raw = { ...object(JSON.parse(form.get('payload') as string)), action: 'create' };
        } else raw = object(JSON.parse(new TextDecoder().decode(body)));
      } catch (error) {
        if (error instanceof CommerceFailure) throw error;
        throw new CommerceFailure('INVALID_INPUT', '입력 내용을 확인해 주세요.');
      }
      const action = raw.action;
      if (typeof action !== 'string' || action.length > 40) throw new CommerceFailure('INVALID_ACTION', '요청을 확인해 주세요.');
      const admin = action.startsWith('admin-');
      if (admin) {
        const configured = env.MNE_ADMIN_TOKEN;
        if (!configured || configured.length < 32 || !bearer?.startsWith('Bearer ') || !equalSecret(bearer.slice(7), configured)) throw new CommerceFailure('ADMIN_UNAUTHORIZED', '관리자 인증 정보를 확인해 주세요.', 401);
      } else if (origin !== ownOrigin) throw new CommerceFailure('INVALID_ORIGIN', '같은 웹사이트에서 다시 시도해 주세요.', 403);
      const fetcher = deps.fetcher ?? fetch;
      const service = new CommerceService({ storage: deps.storage ?? blobStorage(), env, payment: deps.payment === undefined ? tossProvider(env, fetcher) : deps.payment, fetcher, now: deps.now });
      // context.ip is supplied by Netlify; never trust a client-provided forwarding header.
      await service.rateLimit(context?.ip ?? 'local-development', admin ? 'admin' : action, admin ? 120 : action === 'confirm' || action === 'resume' ? 60 : 20);
      switch (action) {
        case 'create':
          if (!form) throw new CommerceFailure('INVALID_FORMAT', '사진과 주문 내용을 함께 전송해 주세요.', 415);
          return json(await service.create(raw, await validatePhoto(form.get('photo'))));
        case 'verify-code': return json(await service.verifyCode(raw.code, raw.phone));
        case 'lookup': return json(await service.lookup(raw.reference, raw.phone));
        case 'confirm': return json(await service.confirm(raw));
        case 'resume': return json(await service.resume(raw.orderId, raw.accessToken));
        case 'payment-cancel': return json(await service.paymentCancel(raw));
        case 'admin-list': return json(await service.adminList(raw.cursor));
        case 'admin-list-codes': return json(await service.adminListCodes(raw.cursor));
        case 'admin-issue-code': return json(await service.issueCode(raw));
        case 'admin-reconcile': return json(await service.adminReconcile(raw.orderId));
        case 'admin-update': return json(await service.adminUpdate(raw));
        case 'admin-photo': return service.adminPhoto(raw.orderId);
        case 'admin-sync': return json(await service.syncSheet(raw.orderId));
        case 'admin-delete-test': return json(await service.deleteTest(raw.orderId));
        default: throw new CommerceFailure('INVALID_ACTION', '지원하지 않는 요청입니다.');
      }
    } catch (error) {
      if (error instanceof CommerceFailure) return json({ error: error.message, code: error.code, retryable: error.retryable }, error.status);
      // Never expose provider responses, customer records, storage paths or credentials.
      return json({ error: '주문 연결을 확인 중입니다. 입력 내용을 유지한 채 잠시 후 다시 시도해 주세요.', code: 'SERVICE_UNAVAILABLE', retryable: true }, 503);
    }
  };
}

export default createCommerceHandler();
export const config: Config = { path: '/api/commerce', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
