import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import quoteSubmit from '../netlify/functions/quote-submit.mjs';

const page = fs.readFileSync(new URL('../nemt-insurance.html', import.meta.url), 'utf8');
const inlineScripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(match => !match[0].includes('ld+json'));
const source = inlineScripts.at(-1)[1];
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ query = '', referrer = '', apiAvailable = true, consent = false, valid = true, send } = {}) {
  let onSubmit;
  const sent = [];
  const button = { disabled: true };
  const success = { hidden: true, focus() {} };
  const unavailable = { hidden: true, focus() {} };
  const failures = [];
  const form = { hidden: false, reportValidity: () => valid, querySelector: () => button, addEventListener: (type, callback) => { onSubmit = callback; } };
  const api = {
    createSession(options) {
      assert.equal(options.lineOfBusiness, 'commercial');
      return { async submitComplete(fields, honeypot) { sent.push({ fields, honeypot }); return send ? send(fields, honeypot) : { submission_id: '12345678-1234-1234-1234-123456789abc' }; } };
    },
    formToObject() { return { firstName: 'Test', lastName: 'Operator', company: 'QA Transport', phone: '2025550196', email: 'qa@example.com', state: 'Georgia', status: 'New Venture', vehicles: '2', operation: 'Wheelchair', ...(consent ? { smsService: 'yes' } : {}) }; },
    clearFailure() {}, showFailure(form, error) { failures.push(error); }
  };
  const context = {
    window: { ...(apiAvailable ? { PinnacleQuote: api } : {}) },
    document: { referrer, getElementById: id => ({ nemtForm: form, nemtSuccess: success, nemtUnavailable: unavailable })[id] },
    location: { pathname: '/nemt-insurance.html', hostname: 'pinnacleriskad.com', href: 'https://pinnacleriskad.com/nemt-insurance.html' + query, search: query },
    URLSearchParams, URL, Date
  };
  vm.runInNewContext(source, context);
  return { sent, button, success, unavailable, failures, form, context, submit() { let prevented = false; onSubmit({ preventDefault() { prevented = true; } }); assert.ok(prevented); return flush(); } };
}

test('NEMT content has valid scripts, matching visible FAQs, canonical URL and only brand fonts', () => {
  inlineScripts.forEach(match => new vm.Script(match[1]));
  const schemas = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  const faq = schemas.find(schema => schema['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, 14);
  faq.mainEntity.forEach(question => { assert.ok(page.includes(question.name.replaceAll('&', '&amp;').replaceAll('’', '&#x27;')) || page.includes(question.name)); assert.ok(page.includes(question.acceptedAnswer.text)); });
  assert.equal((page.match(/<h1>/g) || []).length, 1);
  assert.match(page, /rel="canonical" href="https:\/\/pinnacleriskad.com\/nemt-insurance.html"/);
  assert.doesNotMatch(page, /family=Cormorant|family=DM/);
});

test('invalid input and missing delivery script never send or show success', async () => {
  const invalid = fixture({ valid: false }); await invalid.submit(); assert.equal(invalid.sent.length, 0);
  const missing = fixture({ apiAvailable: false }); await missing.submit(); assert.equal(missing.sent.length, 0); assert.equal(missing.success.hidden, true); assert.equal(missing.unavailable.hidden, false); assert.equal(missing.button.disabled, true);
});

test('failed delivery retains the form and permits a successful retry', async () => {
  let attempt = 0;
  const f = fixture({ send: () => { if (!attempt++) throw new Error('offline'); return { submission_id: 'test' }; } });
  await f.submit(); assert.equal(f.success.hidden, true); assert.equal(f.form.hidden, false); assert.equal(f.button.disabled, false); assert.equal(f.failures.length, 1); assert.equal(f.context.window.dataLayer, undefined);
  await f.submit(); assert.equal(f.success.hidden, false); assert.equal(f.form.hidden, true); assert.equal(f.context.window.dataLayer.length, 1);
});

test('rapid repeated submission sends one request and suppresses duplicate success events', async () => {
  let complete;
  const f = fixture({ send: () => new Promise(resolve => { complete = resolve; }) });
  await f.submit(); await f.submit(); assert.equal(f.sent.length, 1); complete({ submission_id: 'test', duplicate: true }); await flush(); assert.equal(f.context.window.dataLayer, undefined);
});

test('click IDs and paid UTMs identify paid traffic; search referrers identify organic traffic', async () => {
  const ads = fixture({ query: '?gclid=click&gbraid=braid&wbraid=wbraid&campaignid=12&adgroupid=34&keyword=nemt&utm_source=google&utm_medium=cpc' }); await ads.submit(); const a = ads.sent[0].fields; assert.equal(a.source, 'google-ads'); assert.equal(a.gclid, 'click'); assert.equal(a.gbraid, 'braid'); assert.equal(a.wbraid, 'wbraid'); assert.equal(a.ad_group_id, '34');
  const utm = fixture({ query: '?utm_source=google&utm_medium=cpc' }); await utm.submit(); assert.equal(utm.sent[0].fields.source, 'google-ads');
  const organic = fixture({ referrer: 'https://www.google.com/search?q=nemt' }); await organic.submit(); assert.equal(organic.sent[0].fields.source, 'organic-search');
  const fake = fixture({ referrer: 'https://google.com.example.org/search' }); await fake.submit(); assert.equal(fake.sent[0].fields.source, 'referral');
});

test('SMS consent stays optional and preserves affirmative proof when selected', async () => {
  const no = fixture(); await no.submit(); assert.equal(no.sent[0].fields.smsServiceConsent, 'false'); assert.equal(no.sent[0].fields.smsOptInTimestamp, ''); assert.equal(no.sent[0].fields.smsService, undefined);
  const yes = fixture({ consent: true }); await yes.submit(); assert.equal(yes.sent[0].fields.smsServiceConsent, 'true'); assert.equal(yes.sent[0].fields.smsService, 'yes'); assert.ok(yes.sent[0].fields.smsOptInTimestamp); assert.equal(yes.sent[0].fields.smsMarketingConsent, 'false');
});

test('the real quote handler accepts NEMT fields and forwards operation details to CRM', async () => {
  const f = fixture(); await f.submit();
  const oldFetch = globalThis.fetch; const oldWebhook = process.env.GHL_COMMERCIAL_WEBHOOK_URL; let forwarded;
  try {
    process.env.GHL_COMMERCIAL_WEBHOOK_URL = 'https://example.org/crm';
    globalThis.fetch = async (url, options) => { forwarded = JSON.parse(options.body); return new Response('{}', { status: 200 }); };
    const response = await quoteSubmit(new Request('https://pinnacleriskadvisors.net/api/quote-submit', { method: 'POST', headers: { Origin: 'https://pinnacleriskad.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ line_of_business: 'commercial', submission_id: '12345678-1234-1234-1234-123456789abc', submission_state: 'complete', form_started_at_ms: Date.now() - 10000, fields: f.sent[0].fields }) }));
    assert.equal(response.status, 200); assert.equal(forwarded.coverage, 'NEMT Insurance'); assert.equal(forwarded.line_of_business, 'NEMT Insurance'); assert.match(forwarded.details, /Vehicles: 2; Operation: Wheelchair/);
  } finally { globalThis.fetch = oldFetch; if (oldWebhook === undefined) delete process.env.GHL_COMMERCIAL_WEBHOOK_URL; else process.env.GHL_COMMERCIAL_WEBHOOK_URL = oldWebhook; }
});
