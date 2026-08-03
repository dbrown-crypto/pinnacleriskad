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
      num_vehicles: '2',
      num_drivers: '2'
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
    'quote.html': ['quoteForm', 'commercial']
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
        || (line === 'trucking' && testExports.truckingDynamicField(field));
      assert.equal(allowed, true, `${filename}: ${field} is not allowlisted`);
    }
  }
});
