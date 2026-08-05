const ALLOWED_ORIGINS = new Set([
  'https://pinnacleriskad.com',
  'https://www.pinnacleriskad.com'
]);

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const BODY_LIMIT = 2048;
const NHTSA_TIMEOUT_MS = 6000;

function json(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function fail(status, code, message) {
  return json(status, { ok: false, code, message });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function withCors(response, origin) {
  for (const [name, value] of Object.entries(corsHeaders(origin))) response.headers.set(name, value);
  return response;
}

function requestOrigin(request) {
  const origin = (request.headers.get('origin') || '').replace(/\/$/, '');
  if (origin) return origin;
  const referer = request.headers.get('referer');
  if (!referer) return '';
  try { return new URL(referer).origin; }
  catch { return ''; }
}

function cleanVehicle(result, vin) {
  return {
    vin,
    year: String(result.ModelYear || '').trim(),
    make: String(result.Make || '').trim(),
    model: String(result.Model || '').trim(),
    trim: String(result.Trim || '').trim(),
    body_class: String(result.BodyClass || '').trim(),
    vehicle_type: String(result.VehicleType || '').trim(),
    drive_type: String(result.DriveType || '').trim(),
    fuel_type: String(result.FuelTypePrimary || '').trim()
  };
}

function decodedCleanly(result) {
  const codes = String(result.ErrorCode || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.length === 1 && codes[0] === '0';
}

async function decodeWithNhtsa(vin, fetchFn = fetch, timeoutMs = NHTSA_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const endpoint = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
    const response = await fetchFn(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return { error: 'upstream' };
    let payload;
    try { payload = await response.json(); }
    catch { return { error: 'malformed' }; }
    const result = payload && Array.isArray(payload.Results) ? payload.Results[0] : null;
    if (!result || typeof result !== 'object') return { error: 'malformed' };
    return { result };
  } catch {
    return { error: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function handleVinDecode(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > BODY_LIMIT) return fail(413, 'request_too_large', 'The VIN request is too large.');

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > BODY_LIMIT) return fail(413, 'request_too_large', 'The VIN request is too large.');

  let data;
  try { data = JSON.parse(raw); }
  catch { return fail(400, 'invalid_json', 'The VIN request must be valid JSON.'); }

  const vin = String(data && data.vin || '').toUpperCase().replace(/\s+/g, '');
  if (!VIN_PATTERN.test(vin)) {
    return fail(422, 'invalid_vin_format', 'Enter a 17-character VIN without the letters I, O, or Q.');
  }

  const decoded = await decodeWithNhtsa(vin);
  if (decoded.error === 'timeout') return fail(504, 'decoder_timeout', 'The vehicle database did not respond in time. Please try again.');
  if (decoded.error) return fail(502, 'decoder_unavailable', 'The vehicle database is temporarily unavailable. Please try again.');

  const vehicle = cleanVehicle(decoded.result, vin);
  if (!decodedCleanly(decoded.result) || !vehicle.year || !vehicle.make || !vehicle.model) {
    return fail(422, 'vin_not_verified', 'We could not verify that VIN. Check every character or mark the vehicle for manual review.');
  }

  return json(200, { ok: true, verified: true, vehicle });
}

export default async function vinDecode(request) {
  const origin = requestOrigin(request);
  if (!ALLOWED_ORIGINS.has(origin)) return fail(403, 'origin_not_allowed', 'This request origin is not allowed.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return withCors(fail(405, 'method_not_allowed', 'This request method is not allowed.'), origin);
  return withCors(await handleVinDecode(request), origin);
}

export const config = {
  path: '/api/vin-decode',
  method: ['POST', 'OPTIONS'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 300,
    windowLimit: 30
  }
};

export const testExports = { VIN_PATTERN, cleanVehicle, decodedCleanly, decodeWithNhtsa };
