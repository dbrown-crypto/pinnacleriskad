# Site audit implementation register

Source: `pinnacleriskad.com Site Audit.pdf`, September 18, 2026 (25 pages).
Baseline: `18b5adad74a048a622c3a93965c5c0a561285c52` on `main`.
Working branch: `audit/2026-09-18-phase-1a`.
Status: Phase 1A implemented and locally verified; not deployed. All other work below remains open unless stated otherwise.

Delivery status: automatic approval review rejected the attempted GitHub branch push because explicit permission to push was not established. Commits remain local; no PR or production deployment was created. Owner approval is required to push this review branch. `AUDIT_PHASE_1A.patch` contains the complete code diff against the baseline, excluding this register.

## Verified architecture

- Root HTML files contain the content, inline CSS, repeated headers/footers, and page scripts. There is no package manifest, frontend framework, template engine, or shared header partial in the tracked tree.
- GitHub Pages deploys `main`; the latest successful Pages run at inspection was 35299340398 for the baseline commit. `CNAME` specifies `pinnacleriskad.com`; `.nojekyll` bypasses Jekyll processing.
- `quote-submission.js` delivers to `https://pinnacleriskadvisors.net/api/quote-submit`, implemented in `netlify/functions/quote-submit.mjs`. The Netlify dashboard's deployment configuration was not inspected.
- `property_lookup.py` contains both RentCast and FMCSA handlers. `render.yaml` declares a free Python service, server-only `RENTCAST_API_KEY` and `FMCSA_WEB_KEY`, and the uvicorn start command. Live instance configuration still needs dashboard confirmation.
- `_redirects` is Netlify syntax, not an effective GitHub Pages redirect mechanism. No URL is renamed or consolidated in this phase. A future slug change needs a real hosting-level 301, not just a new line in this file.
- Existing Node tests live in `tests/`; no dependencies are required for the core Node test suites.

## Phase 1A: crawl controls, dead social links, and metadata

This is the independently shippable, non-paid subset of the user's requested technical-cleanup phase. Paid-page changes require a separate go-ahead, including changes in scripts shared by those pages. The audit's revenue-priority queue remains in order below.

| Audit reference | Files | Change | Status |
| --- | --- | --- | --- |
| Page 5; implementation table item 7 | `robots.txt` | Remove the thank-you crawl block so its existing `noindex, follow` can be read. Keep it out of the sitemap. | Implemented |
| Page 5 dead social destinations | `privacy-policy.html`, `terms-of-service.html` | Remove six links to bare LinkedIn, X, and Instagram homepages. No replacement profiles invented. | Implemented |
| Priority item 15 | `landlord.html`, `quote.html`, `commercial-property-insurance-georgia.html`, `commercial-property-insurance-florida.html` | Replace sentence fragments with complete, factual quote-request descriptions; standardize brand suffix; shorten property titles; align Open Graph and Twitter metadata. | Partially closed; other pages deferred |

No coverage eligibility, pricing, carrier appointment, licensing, business hours, or compliance claim was added. Existing business-service descriptions supply the context for the revised metadata.

### Verified locally

- Both code commits pass `git diff --check`.
- Six protected commercial HTML pages and `trucking-landing.js`, `quote-submission.js`, and `property_lookup.py` are byte-identical to the baseline.
- Scripts, complete form markup, iframes, H1s, and canonical tags in every changed HTML file are unchanged.
- All four revised titles/descriptions agree with their Open Graph and Twitter versions.
- All 20 unique sitemap entries map to existing local files; thank-you remains excluded and carries `noindex`.
- Live `robots.txt` still contains the old disallow rule, as expected before deployment.
- Live Render health returned HTTP 200 and `fmcsa_configured: false`, independently confirming the missing FMCSA configuration. No API key values were requested or exposed.

These checks do not certify live end-to-end delivery, current indexation, mobile appearance, or live link/redirect status across the whole site. No real lead was submitted, no conversion was sent, and no account settings were changed.

### Owner review before the next phase

1. Review the GitHub diff and the four revised metadata descriptions.
2. In a checkout of this branch, run `git diff 18b5ada...HEAD --check` and `git diff 18b5ada...HEAD -- robots.txt landlord.html quote.html commercial-property-insurance-georgia.html commercial-property-insurance-florida.html privacy-policy.html terms-of-service.html`.
3. Run `python -m http.server 8080 --bind 127.0.0.1` and open the modified pages locally. Check legal-page footers at desktop and mobile widths; inspect page source for complete descriptions and matching social metadata. Do not submit local forms to production.
4. Review/merge this phase separately from paid-page changes. After deploy, check `/robots.txt` no longer blocks thank-you, then view `/thank-you.html` source to confirm `noindex` remains. Inspect changed metadata on the live pages.

## Revenue-priority queue (audit priority numbers, not implementation-table numbers)

| Item | Work | Current state / dependency |
| --- | --- | --- |
| 1 | Repair existing USDOT lookup | Missing key confirmed live. Backend status handling, six-second client timeout, and graceful manual entry remain open; paid-page approval required. |
| 2 | NEMT Ads conversion | Confirmed absent in source; existing `nemt_quote_form_submit` dataLayer event is present. Add Ads delivery only after authoritative success and deduplicate by submission ID; approval required. |
| 3 | Sitewide GA4 | No GA4 destination found in HTML. Confirm measurement ID and account configuration before adding; coordinate with existing Ads tags and avoid duplicate pageviews. |
| 4 | Render-blocking fonts | Pending technical phase; actual source also uses DM Sans, so preserve actual families/weights rather than copying the audit's font list blindly. Paid-page approval required for those pages. |
| 5 | Mobile homepage video | Pending technical phase; serve an optimized still on mobile and verify the video is not downloaded. No redesign required. |
| 6 | Visible mobile phone | Pending for trucking quote and NEMT. Preserve the displayed `(770) 758-3197` and working `tel:+17707583197`. |
| 7 | GBP hours and content | Owner account action; confirm correct hours first. |
| 8 | ReInsurePro name/address/phone | Owner account action; current listing and correct address require confirmation. |
| 9 | Seven possibly unindexed URLs | Owner Search Console inspection; site queries are not proof of non-indexation. |
| 10 | COI landing page and links | Structural phase: proposed new `/certificates-of-insurance.html`; no current slug replaced. Portal screenshots and operating limitations needed. |
| 11 | Georgia/Florida commercial trucking hubs | Structural phase: proposed new `/commercial-truck-insurance-georgia.html` and Florida twin. Confirm coverage/service details; map intent before creating duplicates. |
| 12 | Shorter trucking quote form | Conversion phase, after technical acceptance; preserve backend field mapping. No automatic partial capture expansion in this phase. |
| 13 | One measured trucking funnel | Conversion phase; design session/deduplication continuity before consolidation. No URL changes approved. |
| 14 | Agency, Service, FAQ, breadcrumb schema | Technical phase, per user's sequencing. Derive FAQ from visible content, confirm hours/address, use a stable agency ID. No fabricated reviews or aggregateRating. |
| 15 | Metadata | Four non-paid pages fixed in Phase 1A; remaining sitewide titles and trucking metadata pending. |
| 16 | Florida trucking/NEMT and Atlanta pages | Structural phase; owner-confirmed regional differences required. Keep existing NEMT hub URL. |
| 17 | Image sizing/compression and alt review | Technical phase; preserve decorative empty alt where appropriate and use factual alt only for informative images. Shared assets can affect paid pages. |
| 18 | Static asset caching | Hosting decision; no provider migration or paid hosting upgrade authorized by this phase. Fingerprinting alone does not change server cache headers. |

Additional audit findings retained: auto-quote JavaScript-disabled fallback (page 6); trucking keyboard/main/heading/contrast fixes (page 8); contextual quote CTAs, trust content, service-state consistency, lead-magnet click tracking, and About page (pages 16-18); portal login indexing and navigation (pages 18-19). These are pending, not silently closed.

## Exact paid-page proposal requiring approval

The current audit/source identifies the four first URLs below. The last two are conservatively protected because the user includes core trucking and owner-operator/new-authority traffic. Google Ads final-URL assignments, including semi/tow ad groups, have not been independently verified; do not infer assignments from ad display paths.

| Current URL | Proposed first paid-page technical changes |
| --- | --- |
| https://pinnacleriskad.com/georgia-motor-carrier-insurance.html | Through `trucking-landing.js`: six-second lookup timeout, preserve entered DOT, focus manual business-name entry on failure. No HTML, slug, form-field, or conversion-destination change in this first slice. |
| https://pinnacleriskad.com/georgia-bobtail-non-trucking-liability.html | Same shared-script lookup repair as motor carrier. |
| https://pinnacleriskad.com/trucking-quote.html | Equivalent timeout/manual fallback in the existing inline lookup; preserve existing tracking/script order, field names and storage keys. |
| https://pinnacleriskad.com/nemt-insurance.html | Add the existing Ads account tag and a success-only conversion with the returned `submission_id` as `transaction_id`, retaining the local event and duplicate suppression. Proposed destination is the existing `AW-18335963415/EQMqCIG2sNMcEJeyoqdE`; verify its intended use in Ads before deployment. |
| https://pinnacleriskad.com/new-authority-trucking-insurance.html | No change in the next slice. Later: H1 spacing, metadata, fonts, schema; separate disclosed scope. |
| https://pinnacleriskad.com/trucking.html | No change in the next slice. Later: metadata, fonts, schema, internal linking; separate disclosed scope. |

Files for this next slice: `property_lookup.py`, `trucking-landing.js`, `trucking-quote.html`, `nemt-insurance.html`, and focused lookup/conversion regression tests. Render environment changes remain external. Do not change `render.yaml` to a paid plan without an explicit hosting decision.

## Running outside-the-repository action list

### Audit item 1: Render FMCSA configuration and cold start

1. Open the Render web service serving `pinnacleriskad.onrender.com`; confirm its repository, branch, and start command match `property_lookup.py` before deploying backend edits.
2. Under Environment, set `FMCSA_WEB_KEY` to a valid current QCMobile web key. Enter the value only in Render, never public source or chat. The existing deployment notes call for rotating any previously exposed key.
3. Save and redeploy. Check `https://pinnacleriskad.onrender.com/` reports `fmcsa_configured: true`.
4. Test a known real USDOT with `/dot-lookup?dot=KNOWN_DOT`; confirm the correct legal name and power units. Check all three consuming pages after the approved frontend deployment.
5. Inspect the actual instance type and cold-start metrics. Select an always-on paid instance only after reviewing and accepting its current cost. A single response time does not establish a cold-start pattern.

### Audit items 2 and 3: Google Ads and GA4

1. In Google Ads, open the website lead conversion action's tag setup. Confirm whether the existing destination above is intended for NEMT as well as trucking. If NEMT needs a separate action, supply its exact `AW-.../label` instead; do not create an invented label.
2. Check the action's Primary/Secondary setting and each campaign's conversion goals so only intended leads influence bidding. Confirm no duplicate GA4-imported conversion counts the same submission twice.
3. Export the actual final URLs for all motor-carrier, owner-operator/new-authority, bobtail/NTL, semi/tow, core trucking, and NEMT ads, including mobile URL overrides. Preserve these URLs through every phase.
4. In GA4, select the Pinnacle property, then Admin > Data streams > Web > the website stream. Record its `G-...` measurement ID and inspect any connected Google tag destinations before implementing sitewide tracking. See [Google's measurement-ID instructions](https://support.google.com/analytics/answer/12270356).
5. After deployment, use Tag Assistant plus GA4 Realtime/DebugView to verify events and no personal information in analytics payloads. Confirm Ads diagnostics and subsequent reporting; a local dataLayer event alone is insufficient evidence.
6. Review the search-terms report for the last 30 days. Add negatives only for demonstrably irrelevant searches; the audit's display-path observation alone does not establish actual ad-group final URLs or bidding behavior.

### Audit item 7: GBP hours, location, and service content

1. Confirm actual operating hours: the audit reports 7:30 PM on the site and 8 PM on GBP. Update the wrong source; do not assume either is authoritative.
2. In the Business Profile, choose Edit profile and correct Hours. Confirm the real staffed location and whether customers are received there before changing the public address.
3. Review Edit profile > Location > Service area. Set accurate areas; do not rearrange counties to manipulate a map centroid or promise Atlanta rankings. Follow [Google's service-area guidance](https://support.google.com/business/answer/9157481).
4. Update the business description and create a post using owner-approved NEMT/COI information. Link the COI marketing page only once it exists and is live.

### Audit item 8: ReInsurePro citation

1. Open the Pinnacle agent listing at `https://reinsurepro.com/agents/general/pinnacle-risk-advisors-llc` and confirm the currently displayed details.
2. In the agent account, or through its listing-support channel, replace the old Parklake address/943 phone with the confirmed business address and `(770) 758-3197`; include Suite 410 if that is the correct public address.
3. Reopen the public listing after the update and compare its name, address, phone, and website against the agreed site/GBP details. No support message has been sent.

### Audit item 9: Search Console

1. Select the verified `pinnacleriskad.com` property and inspect each URL: `/trucking-quote.html`, `/landlord.html`, `/commercial-property-insurance-georgia.html`, `/commercial-property-insurance-florida.html`, `/personal-insurance.html`, `/personal-auto-insurance.html`, `/personal-umbrella-insurance.html`.
2. Record indexed status, last crawl, Google-selected canonical, and exclusion reason. Run Test live URL if appropriate. Resolve a diagnosed issue before requesting indexing.
3. Submit or confirm `https://pinnacleriskad.com/sitemap.xml` in Sitemaps. Request indexing for eligible updated service pages; never request indexing for thank-you or personal quote forms carrying `noindex`.
4. Check the Page indexing report after recrawl. Keep dated evidence; no ranking/indexing deadline is promised.

### Hosting, delivery, and content dependencies

- Audit item 18: inspect current GitHub Pages/Netlify hosting configuration before proposing cache headers or migration. Record DNS, TLS, redirect, CORS, and rollback requirements. No migration is part of Phase 1A.
- Quote delivery: confirm Netlify's current deploy and Functions environment, and GHL submission-ID upsert behavior documented in `QUOTE_FORM_DEPLOYMENT.md`. Run a clearly marked test lead only in a controlled session; verify correct pipeline/source and any expected secondary notification, then clean up the test record.
- Audit items 10, 14, 16 and trust copy: owner to supply/confirm portal screenshots without client data; COI availability/eligibility and special-wording process; valid licensing/service-state language; genuine profile URLs; actual business hours; and any review excerpts/attribution. Use `[OWNER TO CONFIRM: ...]` in working drafts until supplied; do not publish placeholders.
- COI login shell: separate repository `dbrown-crypto/pinnacle-certportal` has not been inspected in this phase. Inspect first, then implement noindex and navigation in its own scoped phase. Do not combine blanket robots disallow with a noindex that Google must crawl to read. Authentication protects private data; robots controls do not.

### Separately flagged planned enhancement: FMCSA SAFER first-field trust signal

This was described by the owner as planned, but the audit and repository already contain the core DOT-to-carrier/power-unit feature. Repairing that existing integration is audit item 1. A new SAFER data source, expanded first-field rollout, or redesigned lookup experience remains a separately planned enhancement. No duplicate service or scraping feature will be built in this pass. After repair, assess the real gap against the existing implementation before scoping new work.

## Audit cautions affecting later implementation

- The NEMT unavailable-state phone link is already present in current source; no duplicate fallback needed.
- Allow crawl for pages where Google must read noindex. See [Google's noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing).
- FAQ markup does not promise FAQ rich results for an insurance agency. Google's [FAQ rich-result eligibility guidance](https://developers.google.com/search/blog/2023/08/howto-faq-changes) limits regular display to eligible authoritative government/health sites. Validate syntax and content, not a promised Search Console enhancement within two weeks.
- The absence of public CrUX field data does not prove Google Ads judges this site solely using Lighthouse lab scores. Treat the audit's performance scores as dated measurements, not guaranteed ranking or cost changes.
- Source verifies configuration needs, not the live account's secret values, campaign goals, DNS settings, or all hosting controls.

## Post-deployment checklist for every paid-page phase

1. Capture pre-deploy Ads final URLs, traffic/conversion baselines, live HTML and affected asset versions, plus the rollback commit. Do not click a paid ad just to test the page.
2. Deploy the reviewed branch through the existing production hosts. Confirm Pages, Netlify, and Render independently when their files/configuration changed. A successful Pages build does not prove backend deployment.
3. Open every exported final URL (and mobile override) directly. Confirm HTTP 200 at the same URL, HTTPS, canonical consistency, and no accidental noindex or new redirects.
4. At 375px and desktop widths, verify classic Pinnacle styling, readable CTAs, visible intended phone links, keyboard access, and no overflow. Verify the call routes to the agency, not merely that the dialer opens.
5. Test valid DOT, no-result DOT, missing configuration, timeout/offline, and the no-DOT path. Preserve entered details and manual entry; never let lookup failure block quoting.
6. Verify `gclid`, `gbraid`, `wbraid`, UTMs, and ad-group/campaign parameters survive the relevant journey and arrive in the payload without renaming existing fields.
7. On a controlled successful test, confirm the lead reaches GHL once with the expected source and submission ID, the confirmation appears, and one intended Ads conversion is sent. Confirm the same ID deduplicates repeated submissions; failures/invalid input/partial capture must not produce completed-lead conversions.
8. Test blocked submission script, rejected backend, malformed response, and network failure in a local/mock environment. Confirm clear retry/call options and no false success. Production CORS intentionally rejects arbitrary previews; do not weaken it just to test.
9. Check Tag Assistant and browser console/network errors; verify original analytics/call/EmailJS/GHL-related scripts remain in their intended order. Confirm GA4 only if it was configured in that phase.
10. Repeat mobile performance measurements under comparable settings for homepage, trucking quote, motor carrier, and NEMT after asset work. Confirm requested performance changes actually happen in the network panel.
11. Monitor Ads landing-page errors, clicks, spend, leads, and CRM delivery for 24-48 hours; compare weekly conversion rate/cost with a suitable baseline. Check Search Console crawl/index status after recrawl. Roll back the specific commit if a regression appears.
