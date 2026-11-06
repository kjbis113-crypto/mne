# MNÉ

Korean candle storefront with React, Vite, Netlify Functions, private Netlify Blobs order/photo storage, and a Google Sheets operations mirror.

## Development

Node 22.13+ and pnpm 11.25: `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm test`, `pnpm run build`.
Plain Vite previews the design only. Use `npx netlify dev` with server-only environment variables for the API.

## Commerce

The flow collects a memory photo and description, scent choice, customer details, shipping, and three separate required consents. The server fixes the price at KRW 35,000 including shipping for the 120ml candle and three scent strips.

`GET /api/commerce` returns public configuration. POST actions create and resume private orders, verify external prepaid codes, confirm TossPayments server-side, and return masked order lookup results. The old `/api/orders` intake returns 410 so unpaid submissions cannot bypass checkout.

Order records and photos are private in Netlify Blobs. Conditional writes prevent concurrent duplicate code claims and payment confirmation. A matching order ID, payment key, KRW amount, full balance, and confirmed payment status are required before a direct order enters fulfillment. Only live paid/prepaid orders are mirrored to Sheets. Test orders never reach Sheets or the fulfillment queue.

External purchases use a phone-bound `MNÉ-` code issued by the operator with the existing delivery address. Customers enter it on the same order page and skip payment/address entry. Admin access uses a long server-configured token kept only in browser memory. SMS sending and refunds are manual; the admin page provides copyable messages and shipment updates, not automatic sending or refund execution.

## Deployment and activation

GitHub `kjbis113-crypto/mne` deploys to the existing Netlify site through `netlify.toml`. Routes include `/order`, `/orders`, `/admin`, `/payment/*`, `/terms`, `/privacy`, and `/refund`.

Set variables from `.env.example` in Netlify with Functions scope. Never commit real values. Keep `MNE_PAYMENT_ENABLED=false` until the matching Toss API keys are ready. Test keys permit test checkout; live checkout additionally requires `MNE_POLICIES_READY=true` and merchant details. Review the draft policy text and configure actual production/delivery terms before opening sales. Unprovided business details display as “등록 예정”.

The existing Apps Script URL and secret remain server-only. Sheets is an operations mirror; the private backend record is the source of truth. A failed Sheets write can be retried from the admin page without creating a new order. See [operations guide](docs/commerce-operations.md) for setup, limitations, testing and launch steps.

## Design

The Korean-only design uses self-hosted Pretendard Variable with its SIL OFL license. No trial fonts are redistributed. Supplied MNÉ logo, campaign images, looping hero video, SVG arrows, compass, and reduced-motion support are retained. Uploaded customer memories never appear in the public illustrative archive. Automatic MSE fragrance analysis is not connected.
