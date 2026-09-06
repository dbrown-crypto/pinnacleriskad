# Quote form reliability deployment

## Hosting architecture

The canonical public site at `pinnacleriskad.com` is deployed by GitHub Pages, which cannot run a server-side submission function. The repository is also connected to the agency's Netlify project at `pinnacleriskadvisors.net`, which provides the required serverless runtime. The authoritative quote endpoint is implemented at `netlify/functions/quote-submit.mjs` and exposed at `https://pinnacleriskadvisors.net/api/quote-submit`.

All eight public quote forms post cross-origin from the GitHub Pages site to that Netlify endpoint. This includes the short forms on `georgia-motor-carrier-insurance.html` and `georgia-bobtail-non-trucking-liability.html`. Netlify handles an allowlisted CORS preflight for `https://pinnacleriskad.com` and `https://www.pinnacleriskad.com`, then validates the request shape, line-specific fields, required values, completion time, and honeypot before forwarding an allowlisted payload to GoHighLevel. The browser only shows success after the function confirms a successful, well-formed CRM response. EmailJS remains a best-effort secondary notification and cannot create a success state by itself.

The repository-wide form audit found partial-lead workflows on `auto-quote.html` and `trucking-quote.html`; both now send `partial` and later `complete` with one session-stable ID. `home-quote.html`, `umbrella-quote.html`, `landlord-insurance-quote.html`, and `quote.html` have completed-lead workflows only. The small GET forms on the Georgia/Florida property landing pages only prefill or navigate to `quote.html`; they do not deliver leads.

The two Georgia trucking landing pages send a completed short-form lead after name, phone, email, business name, and operation type are present. They reuse `quote-submission.js` for its authoritative CRM response validation and client idempotency. `trucking-landing.js` fires the existing Google Ads trucking conversion destination only after that confirmed response, then offers `trucking-quote.html` as the optional detailed second step.

## Required environment variables

Set these in the Netlify project UI with Functions runtime scope. Do not put their values in `netlify.toml`, public JavaScript, HTML, or committed configuration.

| Netlify variable | Forms routed to it |
| --- | --- |
| `GHL_PERSONAL_LINES_WEBHOOK_URL` | Auto, homeowners, and personal umbrella |
| `GHL_TRUCKING_WEBHOOK_URL` | Commercial trucking |
| `GHL_COMMERCIAL_WEBHOOK_URL` | Landlord and general commercial |

The existing Render lookup service separately requires `RENTCAST_API_KEY` and `FMCSA_WEB_KEY`. The FMCSA key is now server-only; the browser proxy fallback that exposed it has been removed.

The previously public GHL webhook URLs and FMCSA key should be rotated before production deployment because they remain recoverable from Git history even though they no longer appear in the current public files.

## Deployment order

1. Create or confirm GoHighLevel custom fields for `submission_id` and `submission_state`.
2. Configure each GHL intake workflow to search/upsert in this order: `submission_id`, normalized email, then normalized phone. A `partial` request should create or update one open contact/opportunity; a later `complete` request with the same `submission_id` must update that same record rather than creating another opportunity.
3. Rotate the previously exposed webhook URLs and set the three `GHL_*_WEBHOOK_URL` values in Netlify with Functions scope.
4. Rotate the FMCSA key, set `FMCSA_WEB_KEY` in Render, and redeploy the existing lookup service.
5. Trigger a fresh Netlify deploy so the function receives the updated environment variables.
6. Send controlled test submissions from both `https://pinnacleriskad.com` and `https://www.pinnacleriskad.com` and confirm partial-to-complete upsert behavior in GHL before publishing the production deploy.

## Implemented protections

- Production `Origin` or `Referer` allowlist for both canonical hostnames.
- Restricted cross-origin preflight and response headers so the GitHub Pages frontend can call the Netlify function without exposing webhook values.
- Strict per-line field allowlists, required-field checks, contact normalization, a 64 KB request limit, and an 8-second GHL upstream timeout.
- Honeypot and three-second minimum completion checks in both the client and function.
- Stable `submission_id` in `sessionStorage`, shared by partial and complete states.
- One partial retry after a failed primary request; a partial is marked sent only after success.
- Submit locking and in-flight/completed idempotency on the client.
- Netlify-native rate limiting configured at 10 requests per IP/domain per five minutes.
- Consistent JSON error responses without logging payloads, PII, or webhook values.

## Validation commands

```bash
node --test tests/quote-submission.test.js tests/trucking-landing.test.js tests/netlify-quote-submit.test.mjs
node --check quote-submission.js
node --check netlify/functions/quote-submit.mjs
python -m py_compile property_lookup.py
npx --yes html-validate --config tests/htmlvalidate.json auto-quote.html home-quote.html umbrella-quote.html trucking-quote.html landlord-insurance-quote.html quote.html georgia-motor-carrier-insurance.html georgia-bobtail-non-trucking-liability.html
```

The test suites cover CRM success, CRM 400 and 500 responses, malformed responses, timeout, offline failure, EmailJS failure, rapid double-click, partial retry and completion, honeypot rejection, minimum-time rejection, origin validation, allowlists, required fields, and the Netlify native rate-limit configuration.

## Known limitations

- GHL deduplication across browser/network retries depends on the external upsert workflow being configured as documented; the stable ID is supplied consistently, but this repository cannot configure GHL itself.
- The static site and submission function deploy independently. A GitHub Pages update changes the forms; a Netlify deploy changes the backend and its environment variables. Both deployments must be healthy for quote delivery to work.
- Netlify deploy previews are intentionally rejected by the production origin allowlist. Use the automated tests for preview validation, then run controlled end-to-end submissions on the two approved production origins.
- EmailJS is intentionally best-effort and does not affect the authoritative CRM result.
- Existing upload behavior remains unchanged: file names are noted for follow-up; files are not proxied through this JSON endpoint.
