# MNÉ

Korean-language candle experience, built with React + Vite and a private Google Sheets order receiver through Netlify Functions.

## Local development

Use Node 22.13 or newer and pnpm 11.25. Run `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm test`, and `pnpm run build`.
For local function integration use `npx netlify dev` with server-only environment variables configured. Plain Vite previews show the design but do not run the order API.

## Netlify

Import `kjbis113-crypto/mne` from GitHub. `netlify.toml` sets the build command, publish directory, functions directory and `/order` routing. No ChatGPT sign-in or platform runtime is required.

Set `MNE_ORDER_WEBHOOK_URL` to the existing Google Apps Script `/exec` deployment and `MNE_ORDER_SECRET` to its matching Script Property, both in **Functions** scope. Do not put either value in the repository, client code, or a `VITE_` environment variable. Redeploy after setting them.

`GET /api/orders` reports configuration availability, not a completed delivery test. The API validates same-origin submissions, limits payloads, applies Netlify per-IP rate limiting and preserves the order reference across retries. Google Apps Script owns deduplication and writes order text as rich text to prevent formula injection. Customer data and uploaded photos remain private; the public archive is illustrative content only.

Photos are limited to 4 MiB to allow multipart and Base64 overhead within Netlify's binary request limit. The intake uses file upload only; it does not show a duplicate photo URL field.

Before customer launch, submit one clearly labelled test order, verify its private spreadsheet row and photo, then retry the same reference to verify deduplication. MSE fragrance analysis is a separate integration and is not connected by this project.

## Typography and assets

The active design system is `app/editorial.css`. Korean copy uses self-hosted Pretendard Variable under its accompanying SIL OFL license. Visitors do not need to install a font. No trial fonts are redistributed. Legacy stylesheet files are retained but are not imported.

Copy is Korean-only; the legacy `Pair` component renders just its Korean text. Decorative section labels, duplicate translations, ordinals and empty analysis cards are removed. Body copy uses 160% leading, headings 124%, with a responsive scale and 20–48px outer gutters. The measured references (Arpa Studios and Köppen) informed the compact navigation, image-led hero, clear type hierarchy and consistent archive grid; their assets are not copied.

Supplied MNÉ logo, photography, scroll-responsive architectural prints, SVG arrows and the compass camera interaction are retained. Reduced-motion preferences are respected. API payloads and private order handling are unchanged by the visual redesign.
