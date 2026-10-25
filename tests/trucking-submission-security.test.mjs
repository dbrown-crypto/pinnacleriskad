import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../trucking-quote.html', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../quote-submission.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const guard = scripts.find(s => s.includes('window.history.replaceState'));
const main = scripts.find(s => s.includes('var quoteSession ='));

function fixture(url = 'https://pinnacleriskad.com/trucking-quote') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const sent = { crm: [], email: [], prints: [], conversions: [] };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  w.fetch = () => { throw new Error('Live network access forbidden in this fixture'); };
  w.eval(guard);
  w.eval(shared);
  w.PinnacleQuote.createSession = () => ({
    async submitComplete(data) { if (sent.failure) throw sent.failure; sent.crm.push(data); return { ok: true }; },
    async submitPartial() { return { ok: true }; }
  });
  w.emailjs = { async send(service, template, data) { if (sent.emailFailure) throw new Error('Synthetic failure'); sent.email.push(data); } };
  w.gtag = (...args) => sent.conversions.push(args);
  w.eval(main);
  w.generateSubmissionPDF = data => sent.prints.push(data);
  for (const el of w.document.querySelectorAll('#truckingQuoteForm [required]')) {
    if (el.tagName === 'SELECT') el.value = [...el.options].find(o => o.value)?.value || '';
    else el.value = el.type === 'email' ? 'test@example.invalid' : el.type === 'tel' ? '2025550196' : el.type === 'date' ? '1990-01-01' : 'TEST ONLY';
  }
  const set = (name, value) => { const el = w.document.querySelector(`[name="${name}"]`); assert.ok(el, name); el.value = value; };
  return { dom, w, sent, set };
}

const drain = () => new Promise(resolve => setTimeout(resolve, 10));

test('legacy URLs are stripped before third-party scripts and never decoded or rendered', async () => {
  const marker = '<img src=x onerror="window.injected=true">';
  const encoded = Buffer.from(JSON.stringify({ business_name: marker, d1_lic_num: 'TEST-PRIVATE' })).toString('base64');
  const f = fixture(`https://pinnacleriskad.com/trucking-quote.html?utm_source=test&view_submission=${encodeURIComponent(encoded)}&view_submission=bad`);
  await drain();
  assert.equal(new URL(f.w.location.href).searchParams.has('view_submission'), false);
  assert.equal(new URL(f.w.location.href).searchParams.get('utm_source'), 'test');
  assert.equal(f.w.document.querySelectorAll('img[onerror]').length, 0);
  assert.ok(f.w.document.body.textContent.includes('submission-copy link has been retired'));
  assert.ok(!f.w.document.body.textContent.includes('TEST-PRIVATE'));
  assert.equal(f.sent.crm.length, 0);
  assert.equal(f.sent.email.length, 0);
  assert.ok(html.indexOf('window.history.replaceState') < html.indexOf('googletagmanager.com'));
  assert.equal(f.w.document.querySelector('meta[name="referrer"]').content, 'no-referrer');
  f.dom.window.close();
});

test('every applicant-controlled packet value remains literal text, preserving layout and schedules', () => {
  const f = fixture();
  const marker = '<img src=x onerror="window.injected=true"><script>alert(1)</script>& " TEST';
  const input = {};
  const keys = 'business_name entity_type contact_name phone email address years_in_business effective_date annual_revenue usdot mc_number authority_status operation_type new_venture prior_coverage prior_carrier haul_radius states_of_operation cargo_type commodity_details power_unit_count trailer_count al_limit cargo_limit deductible files_noted notes'.split(' ');
  for (const key of keys) input[key] = marker;
  for (let i = 1; i <= 20; i++) {
    for (const key of 'year make model type vin gvw value zip comp_collision'.split(' ')) input[`v${i}_${key}`] = marker;
    for (const key of 'name dob lic_state lic_num cdl exp violations'.split(' ')) input[`d${i}_${key}`] = marker;
  }
  input.cov_cargo = 'Yes';
  const doc = new f.w.DOMParser().parseFromString(f.w.buildSubmissionDoc(input), 'text/html');
  assert.equal(doc.querySelectorAll('script,img,[onerror]').length, 0);
  assert.equal(doc.querySelectorAll('.section').length, 7);
  assert.equal(doc.querySelectorAll('tbody tr').length, 40);
  assert.ok(doc.body.textContent.includes(marker));
  assert.equal(doc.querySelector('.cov-grid').children.length, 9);
  assert.equal(input.business_name, marker, 'rendering must not mutate the CRM payload');
  assert.equal(f.w.packetFields({ unknown: marker, business_name: { value: marker } }).business_name, '');
  assert.equal(f.w.packetFields({ unknown: marker }).unknown, undefined);
  f.dom.window.close();
});

test('normal submissions still send CRM fields, notify by email, convert and print without a data URL', async () => {
  const f = fixture();
  for (const [k,v] of Object.entries({contact_name:'TEST ONLY Contact', email:'test@example.invalid', phone:'2025550196', business_name:'TEST & Sons', d1_name:'TEST ONLY Driver', d1_dob:'1990-01-01', d1_lic_num:'TEST-PRIVATE', notes:'TEST ONLY note'})) f.set(k,v);
  f.w.document.getElementById('truckingQuoteForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(f.sent.crm.length, 1);
  assert.equal(f.sent.crm[0].d1_lic_num, 'TEST-PRIVATE');
  assert.equal(f.sent.crm[0].business_name, 'TEST & Sons');
  assert.equal(f.sent.email.length, 1);
  assert.equal(f.sent.email[0].submission_pdf_link, '');
  assert.ok(!JSON.stringify(f.sent.email).includes('view_submission'));
  assert.equal(f.sent.prints.length, 1);
  assert.equal(f.sent.conversions.length, 1);
  assert.equal(f.w.document.getElementById('success-screen').style.display, 'block');
  f.dom.window.close();
});

test('CRM failure preserves the form and sends no notification, conversion or packet', async () => {
  const f = fixture(); f.sent.failure = new Error('Synthetic CRM failure');
  f.set('business_name', 'TEST unchanged');
  f.w.document.getElementById('truckingQuoteForm').dispatchEvent(new f.w.Event('submit', { bubbles:true, cancelable:true }));
  await drain();
  assert.equal(f.sent.email.length, 0);
  assert.equal(f.sent.conversions.length, 0);
  assert.equal(f.sent.prints.length, 0);
  assert.equal(f.w.document.querySelector('[name="business_name"]').value, 'TEST unchanged');
  assert.ok(f.w.document.querySelector('.quote-submit-error'));
  f.dom.window.close();
});

test('print window uses a parsed document, retains packet text and detaches opener', () => {
  const f = fixture();
  const popup = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  let focused = false;
  f.w.open = () => ({ document:popup.window.document, opener:f.w, focus(){focused=true;}, print(){} });
  const handle = f.w.open(); f.w.open = () => handle;
  handle.document.write = () => { throw new Error('document.write is forbidden'); };
  f.w.openPrintWindow(f.w.buildSubmissionDoc({business_name:'TEST & Sons',d1_name:'TEST Driver'}));
  assert.ok(handle.document.body.textContent.includes('TEST & Sons'));
  assert.equal(handle.opener, null);
  assert.equal(focused, true);
  popup.window.close(); f.dom.window.close();
});

test('secondary email failure does not undo confirmed CRM delivery or customer copy', async () => {
  const f = fixture(); f.sent.emailFailure = true;
  f.w.document.getElementById('truckingQuoteForm').dispatchEvent(new f.w.Event('submit', { bubbles:true, cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(f.sent.crm.length, 1);
  assert.equal(f.sent.prints.length, 1);
  assert.equal(f.w.document.getElementById('success-screen').style.display, 'block');
  f.dom.window.close();
});
