import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import quoteSubmit, { config, testExports } from '../netlify/functions/quote-submit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'GHL_PERSONAL_LINES_WEBHOOK_URL',
  'GHL_TRUCKING_WEBHOOK_URL',
  'GHL_COMMERCIAL_WEBHOOK_URL'
];

function payload(overrides = {}) {
  return {
    line_of_business: 'personal_auto',
    submission_id: '11111111-1111-4111-8111-111111111111',
    submission_state: 'complete',
    form_started_at_ms: Date.now() - 5000,
    honeypot: '',
    fields: {
      full_name: ' Derrick   Brown ',
      phone: '(770) 758-3197',
      email: 'DBROWN@EXAMPLE.COM',
      garaging_zip: '30339',
      num_vehicles: '1',
      num_drivers: '1',
      d1_name: 'Derrick Brown',
      d1_dob: '1990-01-15',
      d1_license_number: 'D1234567',
      d1_license_state: 'GA',
      d1_relationship: 'Self',
      v1_vin: '1HGCM82633A004352',
      v1_vin_status: 'verified',
      v1_year: '2003',
      v1_make: 'HONDA',
      v1_model: 'Accord',
      v1_primary_driver: 'driver_1',
      v1_ownership: 'Owned',
      v1_use: 'Commute',
      v1_coverage: 'Comprehensive and collision'
    },
    ...overrides
  };
}

function request(body = payload(), headers = {}) {
  return new Request('https://pinnacleriskad.com/api/quote-submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://pinnacleriskad.com',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function bodyOf(response) {
  return JSON.parse(await response.text());
}

test.beforeEach(() => {
  process.env.GHL_PERSONAL_LINES_WEBHOOK_URL = 'https://crm.example.test/personal';
  process.env.GHL_TRUCKING_WEBHOOK_URL = 'https://crm.example.test/trucking';
  process.env.GHL_COMMERCIAL_WEBHOOK_URL = 'https://crm.example.test/commercial';
});

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ENV_KEYS) delete process.env[key];
});

test('successful CRM response is authoritative and normalized', async () => {
  let upstream;
  globalThis.fetch = async (_url, options) => {
    upstream = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
  };
  const response = await quoteSubmit(request());
  const result = await bodyOf(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(upstream.submission_id, payload().submission_id);
  assert.equal(upstream.submission_state, 'complete');
  assert.equal(upstream.full_name, 'Derrick Brown');
  assert.equal(upstream.contact_name, 'Derrick Brown');
  assert.equal(upstream.phone, '+17707583197');
  assert.equal(upstream.contact_phone, '+17707583197');
  assert.equal(upstream.email, 'dbrown@example.com');
  assert.equal(upstream.contact_email, 'dbrown@example.com');
});

for (const status of [400, 500]) {
  test(`CRM ${status} is returned as an authoritative failure`, async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'upstream' }), { status });
    const response = await quoteSubmit(request());
    assert.equal(response.status, 502);
    assert.equal((await bodyOf(response)).code, 'crm_rejected');
  });
}

test('malformed successful CRM response is rejected', async () => {
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  const response = await quoteSubmit(request());
  assert.equal(response.status, 502);
  assert.equal((await bodyOf(response)).code, 'crm_malformed_response');
});

test('upstream timeout aborts the CRM request', async () => {
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const result = await testExports.forwardToCrm('https://crm.example.test', {}, 5);
  assert.equal(result.error, 'timeout');
});

test('upstream network failure is classified without exposing details', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const response = await quoteSubmit(request());
  assert.equal(response.status, 502);
  assert.equal((await bodyOf(response)).code, 'crm_network_error');
});

test('Origin or Referer must match the two production origins', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  };
  const blocked = await quoteSubmit(request(payload(), { Origin: 'https://attacker.example' }));
  assert.equal(blocked.status, 403);

  const refererRequest = new Request('https://pinnacleriskad.com/api/quote-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://www.pinnacleriskad.com/auto-quote.html' },
    body: JSON.stringify(payload())
  });
  const allowed = await quoteSubmit(refererRequest);
  assert.equal(allowed.status, 200);
  assert.equal(calls, 1);
});

test('allowed origins receive CORS headers and preflight never reaches CRM', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  };

  const preflight = await quoteSubmit(new Request('https://pinnacleriskadvisors.net/api/quote-submit', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://pinnacleriskad.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://pinnacleriskad.com');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');

  const response = await quoteSubmit(request());
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://pinnacleriskad.com');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(calls, 1);
});

test('honeypot and minimum completion time stop requests before CRM', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  const honeypot = await quoteSubmit(request(payload({ honeypot: 'bot' })));
  assert.equal(honeypot.status, 422);
  assert.equal((await bodyOf(honeypot)).code, 'spam_detected');

  const tooFast = await quoteSubmit(request(payload({ form_started_at_ms: Date.now() })));
  assert.equal(tooFast.status, 422);
  assert.equal((await bodyOf(tooFast)).code, 'completion_time_rejected');
  assert.equal(calls, 0);
});

test('field allowlist and complete-state required fields are enforced', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const unexpected = await quoteSubmit(request(payload({ fields: { ...payload().fields, admin_override: 'true' } })));
  assert.equal(unexpected.status, 422);
  assert.equal((await bodyOf(unexpected)).code, 'unexpected_fields');

  const missing = await quoteSubmit(request(payload({ fields: { full_name: 'Derrick Brown', email: 'd@example.com' } })));
  assert.equal(missing.status, 422);
  assert.equal((await bodyOf(missing)).code, 'missing_required');
});

test('Netlify native per-IP and domain rate limiting is configured', () => {
  assert.deepEqual(config.method, ['POST', 'OPTIONS']);
  assert.deepEqual(config.rateLimit, {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 300,
    windowLimit: 10
  });
});

test('all static form fields are accepted by their line allowlist', () => {
  const forms = {
    'auto-quote.html': ['auto-quote-form', 'personal_auto'],
    'home-quote.html': ['home-quote-form', 'homeowners'],
    'umbrella-quote.html': ['umbrella-quote-form', 'personal_umbrella'],
    'trucking-quote.html': ['truckingQuoteForm', 'trucking'],
    'landlord-insurance-quote.html': ['landlord-quote-form', 'landlord'],
    'quote.html': ['quoteForm', 'commercial'],
    'georgia-motor-carrier-insurance.html': ['motor-carrier-lead-form', 'trucking'],
    'georgia-bobtail-non-trucking-liability.html': ['bobtail-lead-form', 'trucking']
  };
  for (const [filename, [formId, line]] of Object.entries(forms)) {
    const html = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    const formMatch = html.match(new RegExp(`<form[^>]*id=["']${formId}["'][^>]*>([\\s\\S]*?)<\\/form>`, 'i'));
    assert.ok(formMatch, `${filename}: form not found`);
    const controls = [...formMatch[1].matchAll(/<(?:input|select|textarea)\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi)];
    for (const control of controls) {
      const field = control[1];
      const tag = control[0];
      if (field === 'website' || field.startsWith('_') || /\btype=["']file["']/i.test(tag)) continue;
      const allowed = testExports.FIELD_ALLOWLISTS[line].has(field)
        || (line === 'trucking' && testExports.truckingDynamicField(field))
        || (line === 'personal_auto' && testExports.personalAutoDynamicField(field));
      assert.equal(allowed, true, `${filename}: ${field} is not allowlisted`);
    }
  }
});

test('short trucking landing form is complete with contact, company, and operation type', async () => {
  let upstream;
  globalThis.fetch = async (_url, options) => {
    upstream = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
  };
  const short = payload({
    line_of_business: 'trucking',
    fields: {
      form_depth: 'short',
      contact_name: 'Derrick Brown',
      phone: '(770) 758-3197',
      email: 'dbrown@example.com',
      business_name: 'Pinnacle Transport LLC',
      operation_type: 'Own authority motor carrier',
      gclid: 'test-click-id',
      campaign_id: '1001',
      ad_group_id: '2002',
      keyword: 'motor carrier insurance',
      match_type: 'e',
      creative_id: '3003',
      device: 'm',
      landing_page_variant: 'ga-motor-carrier',
      smsService: 'yes'
    }
  });
  const response = await quoteSubmit(request(short));
  assert.equal(response.status, 200);
  assert.equal((await bodyOf(response)).ok, true);
  assert.equal(upstream.form_depth, 'short');
  assert.equal(upstream.ad_group_id, '2002');
  assert.equal(upstream.submission_state, 'complete');
});

test('short trucking landing form still enforces its five required fields', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  const short = payload({
    line_of_business: 'trucking',
    fields: {
      form_depth: 'short',
      contact_name: 'Derrick Brown',
      phone: '(770) 758-3197',
      email: 'dbrown@example.com',
      business_name: 'Pinnacle Transport LLC'
    }
  });
  const response = await quoteSubmit(request(short));
  assert.equal(response.status, 422);
  assert.equal((await bodyOf(response)).code, 'missing_required');
  assert.equal(calls, 0);
});

test('personal auto dynamic driver and vehicle fields are restricted', () => {
  assert.equal(testExports.personalAutoDynamicField('d1_license_number'), true);
  assert.equal(testExports.personalAutoDynamicField('d12_dob'), true);
  assert.equal(testExports.personalAutoDynamicField('v10_vin_status'), true);
  assert.equal(testExports.personalAutoDynamicField('d13_license_number'), false);
  assert.equal(testExports.personalAutoDynamicField('v11_vin'), false);
  assert.equal(testExports.personalAutoDynamicField('d1_social_security_number'), false);
});

test('personal auto rejects unverified VINs and incomplete driver identity', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };

  const badVinFields = { ...payload().fields, v1_vin_status: 'unverified' };
  const badVin = await quoteSubmit(request(payload({ fields: badVinFields })));
  assert.equal(badVin.status, 422);
  assert.equal((await bodyOf(badVin)).code, 'vin_not_verified');

  const badDriverFields = { ...payload().fields, d1_dob: 'not-a-date' };
  const badDriver = await quoteSubmit(request(payload({ fields: badDriverFields })));
  assert.equal(badDriver.status, 422);
  assert.equal((await bodyOf(badDriver)).code, 'invalid_driver_details');
  assert.equal(calls, 0);
});

function addressedAutoFields() {
  return { ...payload().fields, garaging_address_version: '1', garaging_street: '123 Test Street',
    garaging_unit: 'Unit 2', garaging_city: 'Atlanta', garaging_state: 'GA', v1_same_garaging: 'yes' };
}

test('auto addresses reach CRM, with shared addresses resolved and vehicle overrides preserved', async () => {
  let upstream;
  globalThis.fetch = async (_url, options) => { upstream = JSON.parse(options.body); return new Response('{}', { status: 200 }); };
  const fields = { ...addressedAutoFields(), num_vehicles: '2', v1_garaging_street: 'Stale hidden address' };
  for (const [key, value] of Object.entries(payload().fields)) if (key.startsWith('v1_')) fields[key.replace('v1_', 'v2_')] = value;
  Object.assign(fields, { v2_same_garaging: 'no', v2_garaging_street: '456 Sample Avenue', v2_garaging_unit: 'Apt 9',
    v2_garaging_city: 'Miami', v2_garaging_state: 'FL', v2_garaging_zip: '33101' });
  assert.equal((await quoteSubmit(request(payload({ fields })))).status, 200);
  assert.equal(upstream.garaging_street, '123 Test Street');
  assert.equal(upstream.v1_garaging_street, '123 Test Street');
  assert.equal(upstream.v1_garaging_unit, 'Unit 2');
  assert.equal(upstream.v2_garaging_street, '456 Sample Avenue');
  assert.equal(upstream.v2_garaging_zip, '33101');
  assert.equal(upstream.d1_license_number, 'D1234567');
});

test('full-address auto requests reject missing or malformed addresses before CRM', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  for (const overrides of [
    { garaging_street: '' }, { garaging_city: '' }, { garaging_state: 'ZZ' }, { garaging_zip: 'ABC12' },
    { garaging_unit: 'x'.repeat(81) }, { garaging_street: ['123 Street', '456 Street'] },
    { v1_same_garaging: '' }, { v1_same_garaging: 'no' },
    { v1_same_garaging: 'no', v1_garaging_street: '456 Street', v1_garaging_city: 'Miami', v1_garaging_state: 'FL', v1_garaging_zip: '1234' }
  ]) {
    const response = await quoteSubmit(request(payload({ fields: { ...addressedAutoFields(), ...overrides } })));
    assert.equal(response.status, 422, JSON.stringify(overrides));
  }
  assert.equal(calls, 0);
});

test('maximum household size fits the new field limit with all vehicle garaging addresses', async () => {
  let upstream;
  globalThis.fetch = async (_url, options) => { upstream = JSON.parse(options.body); return new Response('{}', { status: 200 }); };
  const fields = { ...addressedAutoFields(), num_drivers: '12', num_vehicles: '10' };
  const driver = { name: 'TEST ONLY Driver', dob: '1990-01-15', license_number: 'TEST12345', license_state: 'GA', relationship: 'Other', cdl: '', incidents: '' };
  const vehicle = { vin: '1HGCM82633A004352', vin_status: 'verified', classic: '', year: '2003', make: 'HONDA', model: 'Accord',
    trim: '', body_class: '', vehicle_type: '', drive_type: '', fuel_type: '', primary_driver: 'driver_1', ownership: 'Owned', use: 'Pleasure', annual_mileage: '', coverage: 'Liability only',
    same_garaging: 'no', garaging_street: '456 Sample Avenue', garaging_unit: '', garaging_city: 'Miami', garaging_state: 'FL', garaging_zip: '33101' };
  for (let i = 1; i <= 12; i++) for (const [key, value] of Object.entries(driver)) fields[`d${i}_${key}`] = value;
  for (let i = 1; i <= 10; i++) for (const [key, value] of Object.entries(vehicle)) fields[`v${i}_${key}`] = value;
  assert.ok(Object.keys(fields).length > 300);
  assert.equal((await quoteSubmit(request(payload({ fields })))).status, 200);
  assert.equal(upstream.v10_garaging_zip, '33101');
  assert.equal(upstream.d12_license_number, 'TEST12345');
  assert.equal(testExports.personalAutoDynamicField('v11_garaging_street'), false);
});
