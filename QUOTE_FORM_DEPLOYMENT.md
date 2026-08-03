# Quote form reliability deployment

## Hosting architecture

The public site is deployed as a static GitHub Pages site, as indicated by `CNAME` and `.nojekyll`. GitHub Pages cannot execute server-side or serverless code. This repository already deploys `property_lookup.py` as a Render FastAPI web service through `render.yaml`, so `/quote-submit` is implemented on that existing backend rather than simulated in public JavaScript.

All six public quote forms post to `https://pinnacleriskad.onrender.com/quote-submit`. That endpoint validates the production site origin, request shape, line-specific fields, required values, completion time, and honeypot before it forwards an allowlisted payload to GoHighLevel. The browser only shows success after the endpoint confirms a successful, well-formed CRM response. EmailJS remains a best-effort secondary notification and cannot create a success state by itself.

The repository-wide form audit found partial-lead workflows on `auto-quote.html` and `trucking-quote.html`; both now send `partial` and later `complete` with one session-stable ID. `home-quote.html`, `umbrella-quote.html`, `landlord-insurance-quote.html`, and `quote.html` have completed-lead workflows only. The small GET forms on the Georgia/Florida property landing pages only prefill or navigate to `quote.html`; they do not deliver leads.

## Required Render environment variables

Set these as secret environment variables on the `pinnacle-property-lookup` Render service. Never put their values in GitHub Pages files or committed configuration.

| Variable | Forms routed to it |
| --- | --- |
| `GHL_PERSONAL_LINES_WEBHOOK_URL` | Auto, homeowners, and personal umbrella |
| `GHL_TRUCKING_WEBHOOK_URL` | Commercial trucking |
| `GHL_COMMERCIAL_WEBHOOK_URL` | Landlord and general commercial |
| `RENTCAST_API_KEY` | Existing property lookup integration |
| `FMCSA_WEB_KEY` | Server-side DOT lookup; must not be placed in `trucking-quote.html` |

The previously public GHL webhook URLs and FMCSA key should be rotated before deployment because they remain recoverable from Git history even though they no longer appear in the current public files.

## Deployment order

1. Create or confirm a GoHighLevel custom field for `submission_id` and a field for `submission_state`.
2. Configure each GHL intake workflow to search/upsert in this order: `submission_id`, normalized email, then normalized phone. A `partial` request should create or update one open contact/opportunity; a later `complete` request with the same `submission_id` must update that same record instead of creating a second opportunity.
3. Rotate the previously exposed webhook URLs and set the three `GHL_*_WEBHOOK_URL` secrets in Render.
4. Deploy the Render service and verify `/` reports all three quote webhook configuration flags as `true`. The health response exposes only booleans, never secret values.
5. Send controlled test submissions from both `https://pinnacleriskad.com` and `https://www.pinnacleriskad.com` and confirm partial-to-complete upsert behavior in GHL.
6. Deploy the GitHub Pages changes only after the Render endpoint and GHL upsert workflows are ready. A missing webhook environment variable intentionally returns HTTP 503 and the form preserves the visitor's data.

## Implemented protections

- Production `Origin` or `Referer` allowlist for both canonical hostnames.
- Strict per-line field allowlists, required-field checks, contact normalization, a 64 KB request limit, and an 8-second GHL upstream timeout.
- Honeypot and three-second minimum completion checks in both the client and endpoint.
- Stable `submission_id` in `sessionStorage`, shared by partial and complete states.
- One partial retry after a failed primary request; a partial is marked sent only after success.
- Submit locking and in-flight/completed idempotency on the client.
- Actual in-memory limit of 10 quote requests per IP per five minutes, with HTTP 429 and `Retry-After`.
- Consistent JSON error responses without logging payloads, PII, or webhook values.

The rate limiter is per Render process and resets when the process restarts. That is effective for the current single-instance service, but it is not distributed. If the service is scaled to multiple instances, replace it with a shared store or Render/platform-native edge rate limiting. The current Render `free` plan may cold-start after inactivity; for paid traffic, move the service to an always-on plan or add platform-native availability protection before launch.

## Validation commands

```bash
node --test tests/quote-submission.test.js
python -m unittest tests/test_quote_endpoint.py
node --check quote-submission.js
python -m py_compile property_lookup.py
```

The test suites cover CRM success, CRM 400 and 500 responses, malformed responses, timeout, offline/network failure, EmailJS failure, rapid double-click, partial retry and completion, honeypot rejection, minimum-time rejection, origin validation, allowlists, required fields, and rate limiting.
