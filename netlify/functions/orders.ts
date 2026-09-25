import { Buffer } from 'node:buffer';
import type { Config } from '@netlify/functions';
import { makeOrderDraft } from '../../app/order-contract';

const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_REQUEST = MAX_PHOTO + 256 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function settings() {
  const url = process.env.MNE_ORDER_WEBHOOK_URL;
  const secret = process.env.MNE_ORDER_SECRET;
  return url && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) && secret
    ? { url, secret } : null;
}

export default async function orders(request: Request) {
  const connection = settings();
  if (request.method === 'GET') return json({ connected: Boolean(connection) });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
  if (!connection) return json({ error: 'Google Sheets connection is awaiting authorization. Nothing has been submitted.' }, 503);
  if (Number(request.headers.get('content-length')) > MAX_REQUEST) return json({ error: 'Please use a photo smaller than 4 MB.' }, 413);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) return json({ error: 'Invalid order format.' }, 415);

  let orderNumber: string;
  let fields;
  let photo: { type: string; base64: string } | undefined;
  try {
    // Check actual length too: clients can omit Content-Length.
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_REQUEST) return json({ error: 'Please use a photo smaller than 4 MB.' }, 413);
    const form = await new Response(raw, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
    const read = (key: string) => {
      const value = form.get(key);
      if (typeof value !== 'string') throw new Error('Missing order details.');
      // Multipart normalizes textarea newlines to CRLF; retain canonical LF in the sheet.
      return key === 'description' ? value.replace(/\r\n/g, '\n') : value;
    };
    orderNumber = read('orderNumber');
    if (!/^MNE-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderNumber)) throw new Error('Invalid order reference.');
    fields = { description: read('description'), preferredNote: read('preferredNote'), customerName: read('customerName'), contact: read('contact'), photoLink: read('photoLink') };
    makeOrderDraft(fields);
    if (fields.description.length > 49000 || fields.customerName.length > 200 || fields.contact.length > 500 || fields.photoLink.length > 2048) throw new Error('An input exceeds the sheet’s supported size. Please shorten it before submitting.');
    const file = form.get('photo');
    if (file instanceof File && file.size) {
      if (file.size > MAX_PHOTO || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Use a JPG, PNG, WebP or GIF photo smaller than 4 MB.');
      photo = { type: file.type, base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
    }
    if (!photo && !fields.photoLink) throw new Error('Upload your own photo or add its existing HTTPS link. Sample images are for preview only.');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Check your order details.' }, 400);
  }

  try {
    const response = await fetch(connection.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: connection.secret, orderNumber, fields, photo }),
      signal: AbortSignal.timeout(45000),
    });
    const result = await response.json() as { ok?: boolean; orderNumber?: string; receivedAt?: string };
    if (!response.ok || !result.ok || result.orderNumber !== orderNumber || !result.receivedAt || !Number.isFinite(Date.parse(result.receivedAt))) throw new Error('unconfirmed');
    return json({ orderNumber: result.orderNumber, receivedAt: result.receivedAt });
  } catch {
    return json({ error: 'We could not confirm the sheet entry. Retry with this same order reference to avoid a duplicate.' }, 502);
  }
}

export const config: Config = {
  path: '/api/orders',
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
