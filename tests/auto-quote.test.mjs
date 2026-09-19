import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../auto-quote.html', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../quote-submission.js', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('const EMAILJS_SERVICE_ID'))[1];

function fixture() {
  // Execute the actual form code with a DOM and intercepted delivery, never live submissions.
  const dom = new JSDOM(html, { url: 'https://pinnacleriskad.com/auto-quote.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(shared);
  const sent = { crm: [], email: [], partial: [] };
  w.PinnacleQuote.createSession = () => ({
    async submitComplete(data) { sent.crm.push(data); return { ok: true }; },
    async submitPartial(data) { sent.partial.push(data); return { ok: true }; }
  });
  w.emailjs = { async send(service, template, data) { sent.email.push({ service, template, data }); } };
  w.eval(script);
  const field = name => w.document.querySelector(`[name="${name}"]`);
  function set(name, value) {
    const el = field(name); assert.ok(el, name); el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  const data = () => w.PinnacleQuote.formToObject(w.document.getElementById('auto-quote-form'));
  const step = n => w.document.querySelector(`[data-step="${n}"]`);
  return { dom, w, sent, field, set, data, step };
}

function contact(f) {
  for (const [key, value] of Object.entries({ full_name: 'TEST ONLY Auto Intake', phone: '2025550196', email: 'auto-test@example.invalid',
    garaging_street: '123 Test Street', garaging_unit: 'Unit 2', garaging_city: 'Atlanta', garaging_state: 'GA', garaging_zip: '30339' })) f.set(key, value);
}

function vehicle(f, i) {
  const classic = f.field(`v${i}_classic`);
  classic.checked = true;
  classic.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  for (const [key, value] of Object.entries({ vin: 'TEST12345', year: '1970', make: 'TEST', model: 'Vehicle', primary_driver: 'driver_1', ownership: 'Owned', use: 'Pleasure', coverage: 'Liability only' })) f.set(`v${i}_${key}`, value);
}

test('contact step requires a full garaging address and keeps leading-zero ZIPs', async () => {
  const f = fixture(); contact(f);
  for (const key of ['street', 'city', 'state', 'zip']) {
    const name = `garaging_${key}`, previous = f.field(name).value;
    f.set(name, ''); assert.equal(f.w.wizValidate(f.step(1)), false, name); f.set(name, previous);
  }
  f.set('garaging_zip', '12A45'); assert.equal(f.w.wizValidate(f.step(1)), false);
  f.set('garaging_zip', '01234'); assert.equal(f.w.wizValidate(f.step(1)), true);
  await f.w.captureLead(); assert.equal(f.sent.partial[0].garaging_zip, '01234');
  assert.equal(f.sent.partial[0].garaging_street, '123 Test Street');
  f.dom.window.close();
});

test('alternate garaging toggles, validates, survives card rebuilds and excludes stale overrides', () => {
  const f = fixture(); contact(f); f.set('num_vehicles', '2'); vehicle(f, 1); vehicle(f, 2);
  assert.equal(f.field('v2_garaging_street').disabled, true);
  f.set('v2_same_garaging', 'no');
  assert.equal(f.w.wizValidate(f.step(3)), false);
  for (const [k, v] of Object.entries({ street: '456 Sample Avenue', unit: 'Apt 9', city: 'Miami', state: 'FL', zip: '33101' })) f.set(`v2_garaging_${k}`, v);
  assert.equal(f.w.wizValidate(f.step(3)), true);
  f.set('num_vehicles', '3');
  assert.equal(f.field('v2_same_garaging').value, 'no');
  assert.equal(f.field('v2_garaging_street').value, '456 Sample Avenue');
  assert.equal(f.field('v2_garaging_street').required, true);
  f.set('num_vehicles', '2'); f.set('v2_same_garaging', 'yes');
  assert.equal(f.data().v2_garaging_street, undefined);
  f.set('garaging_street', '789 Changed Street');
  assert.match(f.w.document.querySelector('[data-garaging-summary]').textContent, /789 Changed Street/);
  assert.equal(f.w.vehicleGaragingAddress(f.data(), 2), '789 Changed Street, Unit 2, Atlanta, GA 30339');
  f.set('v2_same_garaging', 'no'); assert.equal(f.field('v2_garaging_unit').value, 'Apt 9');
  f.dom.window.close();
});

test('complete form sends full per-vehicle addresses and driver identity through the existing EmailJS template', async () => {
  const f = fixture(); contact(f); f.set('num_vehicles', '2');
  for (const [k, v] of Object.entries({ name: 'TEST ONLY Driver', dob: '1990-01-15', license_state: 'GA', license_number: 'TEST12345', relationship: 'Self' })) f.set(`d1_${k}`, v);
  vehicle(f, 1); vehicle(f, 2); f.set('v2_same_garaging', 'no');
  for (const [k, v] of Object.entries({ street: '456 Sample Avenue', city: 'Miami', state: 'FL', zip: '33101' })) f.set(`v2_garaging_${k}`, v);
  f.w.document.getElementById('auto-quote-form').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent.crm.length, 1); assert.equal(f.sent.email.length, 1);
  const { service, template, data } = f.sent.email[0];
  assert.equal(service, 'service_mefkv18'); assert.equal(template, 'template_v2008zh');
  assert.equal(data.garaging_zip, '30339');
  for (const content of [data.secure_auto_details, f.sent.crm[0].notes]) {
    assert.match(content, /DOB 1990-01-15/); assert.match(content, /License GA TEST12345/); assert.match(content, /VIN TEST12345/);
    assert.match(content, /Vehicle 1:.*Garaging address: 123 Test Street, Unit 2, Atlanta, GA 30339/);
    assert.match(content, /Vehicle 2:.*Garaging address: 456 Sample Avenue, Miami, FL 33101/);
  }
  assert.equal(f.sent.crm[0].v2_garaging_city, 'Miami');
  assert.equal(f.w.document.getElementById('success-screen').style.display, 'block');
  assert.doesNotMatch(f.w.document.querySelector('.secure-intro').textContent, /excluded|only/);
  f.dom.window.close();
});
