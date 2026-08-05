import test from 'node:test';
import assert from 'node:assert/strict';
import vinDecode, { config, testExports } from '../netlify/functions/vin-decode.mjs';

const ORIGINAL_FETCH = globalThis.fetch;
const VALID_VIN = '1HGCM82633A004352';

function request(body = { vin: VALID_VIN }, headers = {}) {
  return new Request('https://pinnacleriskadvisors.net/api/vin-decode', {
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

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('verified NHTSA response returns normalized vehicle details', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    Results: [{
      ErrorCode: '0',
      ModelYear: '2003',
      Make: 'HONDA',
      Model: 'Accord',
      Trim: 'EX',
      BodyClass: 'Sedan/Saloon',
      VehicleType: 'PASSENGER CAR',
      DriveType: '4x2',
      FuelTypePrimary: 'Gasoline'
    }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const response = await vinDecode(request());
  const result = await bodyOf(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.vehicle.vin, VALID_VIN);
  assert.equal(result.vehicle.year, '2003');
  assert.equal(result.vehicle.make, 'HONDA');
  assert.equal(result.vehicle.model, 'Accord');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('invalid modern VIN format is rejected before NHTSA', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  const response = await vinDecode(request({ vin: '1HGCM82633A00I352' }));
  assert.equal(response.status, 422);
  assert.equal((await bodyOf(response)).code, 'invalid_vin_format');
  assert.equal(calls, 0);
});

test('NHTSA errors or incomplete identity do not verify a VIN', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    Results: [{ ErrorCode: '1,14', ErrorText: 'Check digit and missing data', Make: 'HONDA' }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const response = await vinDecode(request());
  assert.equal(response.status, 422);
  assert.equal((await bodyOf(response)).code, 'vin_not_verified');
});

test('decoder timeout and malformed upstream responses fail closed', async () => {
  const timeout = await testExports.decodeWithNhtsa(VALID_VIN, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }), 5);
  assert.equal(timeout.error, 'timeout');

  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  const malformed = await vinDecode(request());
  assert.equal(malformed.status, 502);
  assert.equal((await bodyOf(malformed)).code, 'decoder_unavailable');
});

test('origin allowlist, preflight, and Netlify rate limit are enforced', async () => {
  const blocked = await vinDecode(request({ vin: VALID_VIN }, { Origin: 'https://attacker.example' }));
  assert.equal(blocked.status, 403);

  const preflight = await vinDecode(new Request('https://pinnacleriskadvisors.net/api/vin-decode', {
    method: 'OPTIONS',
    headers: { Origin: 'https://www.pinnacleriskad.com' }
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://www.pinnacleriskad.com');
  assert.deepEqual(config.rateLimit, {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 300,
    windowLimit: 30
  });
});

test('VIN pattern accepts valid characters and rejects I, O, and Q', () => {
  assert.equal(testExports.VIN_PATTERN.test(VALID_VIN), true);
  assert.equal(testExports.VIN_PATTERN.test('1HGCM82633A00I352'), false);
  assert.equal(testExports.VIN_PATTERN.test('SHORTVIN'), false);
});
