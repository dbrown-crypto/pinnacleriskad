# Auto quote garaging address — September 19, 2026

Owner-approved quote-funnel enhancement following the audit. Production URL remains https://pinnacleriskad.com/auto-quote.html.

## Changes and reviewable diffs

- Backend: [PR 18](https://github.com/dbrown-crypto/pinnacleriskad/pull/18), commit `b5dd21fd24873bbe865dd54ff465eeaba03a51d1`, merged as `f3d9124bd454fb9be3a591b1cc06ec2a5032a897`. `netlify/functions/quote-submit.mjs` accepts and validates full household/per-vehicle garaging fields, resolves shared addresses on the server, and raises only the personal-auto field limit for the existing maximum of 12 drivers and 10 vehicles. Older ZIP-only forms remain compatible. Backend tests cover invalid addresses, shared/alternate addresses, and maximum household size.
- Form: [PR 19](https://github.com/dbrown-crypto/pinnacleriskad/pull/19), commit `a072e2a3c64a1b11d869c17de9154884cf277630`, merged as `f04c56c4f03d2754b5bd8d144b063f64c769b749`. `auto-quote.html` requires street, city, state and five-digit ZIP, offers an optional unit, and lets each vehicle use the household address or a different address. Browser address autofill is supported; no paid address service was added.
- EmailJS receives the household address and each vehicle's resolved address in its existing `secure_auto_details` parameter. A separate `garaging_address` parameter is also available; `garaging_zip` remains unchanged. At the owner's explicit request, DOB, license details and VIN remain in the existing email details block. The page now accurately describes this delivery instead of claiming that these values are excluded from email.
- CRM notes include the same addresses. The existing EmailJS service/template and CRM-first success/retry behavior remain intact. EmailJS is still a best-effort secondary notification: page success confirms accepted CRM transport, not inbox receipt.
- `tests/auto-quote.test.mjs`, `package.json`, `package-lock.json` and `.gitignore` provide reproducible DOM tests with intercepted delivery. No live notifications are sent by the automated tests.

## Verified

1. `npm ci --ignore-scripts` and `npm test`: 74 tests passed, including existing NEMT, trucking, quote transport, VIN, and DOT regressions.
2. `npx --yes html-validate --config tests/htmlvalidate.json auto-quote.html` and `git diff --check`: passed.
3. All script tags outside the changed form script retain their original content and order. Analytics, metadata, external scripts, phone number and URL remain unchanged. No commercial landing-page source changed.
4. Backend deployed first. A deliberately incomplete full-address request returned HTTP 422 / `invalid_garaging_address` from production, before CRM forwarding. The form was released only after that check.
5. GitHub Pages deployment completed successfully for the frontend merge. The public page displays the new full address fields. Desktop layout was inspected visually.
6. A live synthetic quote named `TEST ONLY Auto Garaging` completed all five steps and displayed `Your auto quote request is in.` No quote/EmailJS failure was reported in captured browser logs. SMS consent remained unchecked. Test data used example.invalid email, a reserved fictional phone number, and clearly synthetic driver/vehicle values; no real applicant identifiers were used.

## Owner acceptance and external items still open

- Check the agency notification inbox and spam for `TEST ONLY Auto Garaging`. Confirm the email contains the household address `123 Test Street, Unit 2, Atlanta, GA 30339`, Vehicle 1 address `456 Sample Avenue, Apt 9, Miami, FL 33101`, synthetic DOB `1990-01-15`, license `TEST12345` / GA, and manual-review VIN `TEST12345`. Mark this as a test and do not quote or contact it.
- Actual mailbox receipt and rendered EmailJS content were not independently verified. The EmailJS dashboard was signed out. If the details block is missing from the received message, sign in to EmailJS, open Email Templates, select `template_v2008zh`, and confirm its body renders `{{secure_auto_details}}` with preserved line breaks. Review a test rendering before saving any template change. No EmailJS dashboard setting was changed in this release.
- Inspect the resulting personal-auto GHL record/notes for both addresses and the completed request. The live success verifies the intake endpoint's accepted CRM response, not every downstream GHL workflow action.
- On a phone, check Step 1 and the alternate-address controls in Step 3. Mobile visual acceptance remains open; responsive CSS is retained.
- This release does not change the wider audit's remaining external account items or planned enhancements. No new FMCSA/SAFER feature was added in this phase; existing lookup tests were only regression checks.

## Post-deployment checks for protected commercial pages

The paid-page URLs and source were not changed. After deployment, open the current Google Ads final URLs for motor carrier, owner-operator/new authority, bobtail/NTL, semi/vehicle-specific, core trucking and NEMT. Confirm HTTP success, unchanged destination/slugs, usable CTAs and phone links, and no console/network failures. Use a coordinated marked test if verifying CRM/Ads conversion ingestion; this auto test does not certify commercial delivery or Google Ads ingestion. Monitor lead volume and landing-page errors after deployment.

## Rollback

Revert frontend commit `a072e2a3c64a1b11d869c17de9154884cf277630` first and verify Pages has restored the ZIP-only form. The backward-compatible backend may remain deployed. If reverting backend commit `b5dd21fd24873bbe865dd54ff465eeaba03a51d1` too, wait until the frontend rollback is live so the new form does not encounter an old backend. No URL redirect is needed because no URL changed.
