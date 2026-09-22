# Auto submission recovery — September 22, 2026

Reported: mobile Step 5 displayed the generic delivery failure. That screenshot does not expose the HTTP status or error code, so the original request's cause is not confirmed.

Checks: production auto HTML matched the repository. The intake endpoint correctly rejected an empty request with HTTP 422. A marked synthetic completed personal-auto request for the existing test contact returned HTTP 200 in approximately 9.3 seconds. This verifies transport availability at test time, not the failed customer's request or email receipt.

Change: only auto-quote.html opts into a 30-second transport timeout (previously the shared 12-second default). It translates known network, CRM and validation errors into actionable messages and displays a non-personal reference code. Rate-limited responses ask for a five-minute pause. Existing success confirmation, stable submission ID, EmailJS ordering, entered data preservation, URL and tracking stay intact. No shared delivery script or paid commercial page changed.

Validation: four auto form tests passed, including field/address and EmailJS payload checks plus simulated timeout, network, driver-validation, CRM-timeout and rate-limit failures. Each failure retained entered data, restored the submit button, withheld the success screen and EmailJS, and allowed a successful retry. These are intercepted tests with no live notifications.

Owner check: retry the existing open form once without refreshing, to preserve entered information. Already-open tabs retain the previous script. If the request still fails, record approximately how long it waited and the submission time; do not send license numbers or DOB in chat. A fresh page uses the revised reference messages after deployment, but refreshing the old form clears entered data. Save needed details before starting a fresh form.

Rollback: revert this change's auto-quote.html and tests/auto-quote.test.mjs diff. No backend or GHL rollback is needed. Longer timeout reduces premature cancellation risk; it does not establish that a timeout caused the original failure. The reported request remains unverified until the user retries or its exact error can be obtained.
