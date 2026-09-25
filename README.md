# MNÉ

Bilingual candle experience, built with React + Vite and a private Google Sheets order receiver through Netlify Functions.

## Local development

Use Node 22.13 or newer and pnpm 11.25. Run `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm test`, and `pnpm run build`.
For local function integration use `npx netlify dev` with server-only environment variables configured. Plain Vite previews show the design but do not run the order API.

## Netlify

Import `kjbis113-crypto/mne` from GitHub. `netlify.toml` sets the build command, publish directory, functions directory and `/order` routing. No ChatGPT sign-in or platform runtime is required.

Set `MNE_ORDER_WEBHOOK_URL` to the existing Google Apps Script `/exec` deployment and `MNE_ORDER_SECRET` to its matching Script Property, both in **Functions** scope. Do not put either value in the repository, client code, or a `VITE_` environment variable. Redeploy after setting them.

`GET /api/orders` reports configuration availability, not a completed delivery test. The API validates same-origin submissions, limits payloads, applies Netlify per-IP rate limiting and preserves the order reference across retries. Google Apps Script owns deduplication and writes order text as rich text to prevent formula injection. Customer data and uploaded photos remain private; the public archive is illustrative content only.

Photos are limited to 4 MiB to allow multipart and Base64 overhead within Netlify's binary request limit. Existing HTTPS photo links are also supported.

Before customer launch, submit one clearly labelled test order, verify its private spreadsheet row and photo, then retry the same reference to verify deduplication. MSE fragrance analysis is a separate integration and is not connected by this project.

## Typography and assets

English uses locally installed FK Roman Standard Trial Light only for local design review; no trial font is redistributed. Public visitors currently use Georgia. Replace the local-only `MNE Roman` font face with a licensed Light WOFF2 before publishing FK Roman universally. Pretendard Variable is included under its accompanying SIL OFL license.

English line-height is 112.5%, Korean 120% (25% below the previous values). Korean type remains 84% of the paired English size. Every line within each heading uses one size. Supplied MNÉ logo and campaign photography are retained.
