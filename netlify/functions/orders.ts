import type { Config } from '@netlify/functions';

// Retired: the old receiver accepted unpaid orders. All new submissions must
// pass the commerce flow's server-side price, consent and payment validation.
export default async function orders(request: Request) {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  return Response.json({ error: '주문 화면이 변경되었습니다. 페이지를 새로고침한 후 다시 진행해 주세요.', next: '/order' }, {
    status: 410, headers: { 'Cache-Control': 'no-store' },
  });
}

export const config: Config = {
  path: '/api/orders',
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
