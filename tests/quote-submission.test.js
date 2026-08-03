const test = require('node:test');
const assert = require('node:assert/strict');
const Quote = require('../quote-submission.js');

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function validFields() {
  return { full_name: '  Derrick   Brown ', phone: '(770) 758-3197', email: 'DBROWN@EXAMPLE.COM' };
}

function sessionFor(fetchFn, options = {}) {
  let current = 1000;
  const session = Quote.createSession({
    formKey: options.formKey || 'test',
    lineOfBusiness: 'personal_auto',
    storage: options.storage || storage(),
    now: () => current,
    fetchFn,
    timeoutMs: options.timeoutMs || 100,
    cryptoApi: { randomUUID: () => '11111111-1111-4111-8111-111111111111' }
  });
  current = 5000;
  return session;
}

test('successful CRM response is authoritative and normalized', async () => {
  let requestUrl;
  let requestBody;
  const session = sessionFor(async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return response(200, {
      ok: true,
      submission_id: requestBody.submission_id,
      submission_state: requestBody.submission_state
    });
  });
  const result = await session.submitComplete(validFields(), '');
  assert.equal(result.ok, true);
  assert.equal(requestUrl, 'https://pinnacleriskadvisors.net/api/quote-submit');
  assert.equal(requestBody.fields.email, 'dbrown@example.com');
  assert.equal(requestBody.fields.phone, '+17707583197');
  assert.equal(requestBody.fields.full_name, 'Derrick Brown');
});

for (const status of [400, 500]) {
  test(`CRM ${status} response is a failure`, async () => {
    const session = sessionFor(async () => response(status, { ok: false, code: 'crm_rejected', message: 'Rejected' }));
    await assert.rejects(session.submitComplete(validFields(), ''), (error) => error.status === status);
  });
}

test('malformed response is a failure', async () => {
  const session = sessionFor(async () => response(200, 'not-json'));
  await assert.rejects(session.submitComplete(validFields(), ''), (error) => error.code === 'malformed_response');
});

test('offline network failure is recoverable', async () => {
  let calls = 0;
  const session = sessionFor(async (_url, options) => {
    calls += 1;
    if (calls === 1) throw new TypeError('offline');
    const body = JSON.parse(options.body);
    return response(200, { ok: true, submission_id: body.submission_id, submission_state: body.submission_state });
  });
  await assert.rejects(session.submitComplete(validFields(), ''), (error) => error.code === 'network');
  const retry = await session.submitComplete(validFields(), '');
  assert.equal(retry.ok, true);
  assert.equal(calls, 2);
});

test('timeout aborts the primary request', async () => {
  const session = sessionFor((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }), { timeoutMs: 5 });
  await assert.rejects(session.submitComplete(validFields(), ''), (error) => error.code === 'timeout');
});

test('rapid double-click produces one completed request', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const session = sessionFor(async (_url, options) => {
    calls += 1;
    await pending;
    const body = JSON.parse(options.body);
    return response(200, { ok: true, submission_id: body.submission_id, submission_state: body.submission_state });
  });
  const first = session.submitComplete(validFields(), '');
  const second = session.submitComplete(validFields(), '');
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(firstResult.duplicate, false);
  assert.equal(secondResult.duplicate, true);
});

test('partial retry and complete transition share one stable ID', async () => {
  const bodies = [];
  let calls = 0;
  const session = sessionFor(async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    calls += 1;
    if (calls === 1) throw new TypeError('temporary offline');
    return response(200, { ok: true, submission_id: body.submission_id, submission_state: body.submission_state });
  });
  await assert.rejects(session.submitPartial(validFields(), ''), (error) => error.code === 'network');
  await session.submitPartial(validFields(), '');
  await session.submitComplete(validFields(), '');
  assert.deepEqual(bodies.map((body) => body.submission_state), ['partial', 'partial', 'complete']);
  assert.equal(new Set(bodies.map((body) => body.submission_id)).size, 1);
});

test('honeypot and minimum-time submissions are blocked before fetch', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return response(200, {}); };
  const botSession = sessionFor(fetchFn, { formKey: 'honeypot' });
  await assert.rejects(botSession.submitComplete(validFields(), 'filled'), (error) => error.code === 'spam');

  let current = 1000;
  const fastSession = Quote.createSession({
    formKey: 'too-fast', lineOfBusiness: 'personal_auto', storage: storage(),
    now: () => current, fetchFn,
    cryptoApi: { randomUUID: () => '22222222-2222-4222-8222-222222222222' }
  });
  current = 2000;
  await assert.rejects(fastSession.submitComplete(validFields(), ''), (error) => error.code === 'too_fast');
  assert.equal(calls, 0);
});

test('EmailJS failure remains secondary', async () => {
  const notified = await Quote.notifySecondary(async () => { throw new Error('EmailJS failed'); });
  assert.equal(notified, false);
});
