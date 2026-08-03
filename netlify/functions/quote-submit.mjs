const ALLOWED_ORIGINS = new Set([
  'https://pinnacleriskad.com',
  'https://www.pinnacleriskad.com'
]);

const BODY_LIMIT = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const MIN_COMPLETION_MS = 3000;
const SUBMISSION_ID = /^[A-Za-z0-9-]{20,100}$/;

const COMMON_FIELDS = new Set([
  'first_name', 'last_name', 'full_name', 'contact_name', 'phone', 'email',
  'contact_phone', 'contact_email', 'coverage_type', 'line_of_business',
  'client_type', 'source', 'form_page', 'page_url', 'referrer', 'gclid',
  'campaign', 'ad_group', 'lead_source', 'submitted_at', 'notes',
  'description', 'files_noted', 'form', 'lead_status', 'note', 'partial'
]);

function fields(...names) {
  return new Set([...COMMON_FIELDS, ...names]);
}

const FIELD_ALLOWLISTS = {
  personal_auto: fields(
    'is_client', 'form_depth', 'source_page', 'garaging_zip', 'zip',
    'num_vehicles', 'num_drivers', 'current_carrier', 'current_limit',
    'renewal_date', 'drv_cdl', 'drv_violation', 'drv_sr22', 'drv_teen',
    'drv_declined', 'drv_rideshare', 'also_home', 'also_umbrella',
    'also_landlord', 'smsService', 'smsMarketing'
  ),
  homeowners: fields(
    'is_client', 'form_depth', 'source_page', 'property_address', 'roof_year',
    'occupancy', 'current_carrier', 'renewal_date', 'hm_nonrenewed',
    'hm_claims', 'hm_roof15', 'hm_pool', 'hm_dog', 'hm_florida',
    'also_auto', 'also_umbrella', 'also_landlord', 'smsService', 'smsMarketing'
  ),
  personal_umbrella: fields(
    'is_client', 'form_depth', 'source_page', 'home_state', 'state',
    'current_auto_carrier', 'current_home_carrier', 'auto_liability_limit',
    'desired_limit', 'own_home', 'own_rentals', 'own_business', 'own_teen',
    'own_pool', 'own_dog', 'own_boat', 'own_rental_multi', 'num_drivers',
    'num_vehicles', 'also_auto', 'also_home', 'also_landlord', 'smsService',
    'smsMarketing'
  ),
  trucking: fields(
    'business_name', 'company', 'address', 'entity_type', 'usdot', 'dot_number',
    'mc_number', 'authority_status', 'years_in_business', 'new_venture',
    'operation_type', 'cargo_type', 'cargo', 'commodity_details', 'haul_radius',
    'states_of_operation', 'states', 'annual_revenue', 'effective_date',
    'prior_coverage', 'prior_carrier', 'current_carrier', 'power_unit_count',
    'driver_count', 'trailer_count', 'al_limit', 'cargo_limit', 'deductible',
    'cov_auto_liability', 'cov_physical_damage', 'cov_cargo',
    'cov_general_liability', 'cov_bobtail', 'cov_trailer_interchange',
    'cov_workers_comp', 'cov_occ_accident', 'cov_excess'
  ),
  landlord: fields(
    'property_address', 'property_type', 'effective_date', 'year_built', 'roof_age',
    'occupancy_status', 'dwelling_limit', 'liability_limit', 'prior_losses',
    'prior_losses_describe', 'currently_insured', 'insured_lapse_explain',
    'construction_type', 'sq_footage', 'num_stories', 'num_units', 'roof_material',
    'roof_shape', 'electrical_panel', 'plumbing_type', 'update_roof',
    'update_electrical', 'update_plumbing', 'update_hvac', 'valuation_pref',
    'monthly_rent', 'deductible_pref', 'form_pref', 'rental_type',
    'commercial_space', 'commercial_pct', 'vacant_how_long', 'vacant_reason',
    'vacant_secured', 'vacant_utilities', 'vacant_renovation', 'reno_scope',
    'reno_pct_complete', 'reno_gc', 'reno_occupied', 'has_pool', 'pool_fenced',
    'pool_diving', 'has_trampoline', 'has_dogs', 'dog_breeds', 'has_wood_stove',
    'loss_details', 'has_lapse', 'lapse_explain', 'fl_coast_distance',
    'fl_wind_mit', 'fl_sinkhole', 'mortgagee_info', 'bathrooms', 'bedrooms'
  ),
  commercial: fields(
    'firstName', 'lastName', 'company', 'state', 'coverage', 'details',
    'smsService', 'smsMarketing', 'smsOptInTimestamp', 'smsOptInSource',
    'smsOptInPageUrl', 'smsServiceConsent', 'smsMarketingConsent',
    'smsDisclosureVersion'
  )
};

const REQUIRED_COMPLETE = {
  personal_auto: ['full_name', 'phone', 'email', 'garaging_zip', 'num_vehicles', 'num_drivers'],
  homeowners: ['full_name', 'phone', 'email', 'property_address', 'roof_year', 'occupancy'],
  personal_umbrella: ['full_name', 'phone', 'email', 'home_state', 'current_auto_carrier'],
  trucking: ['contact_name', 'phone', 'email', 'business_name', 'operation_type', 'haul_radius', 'cargo_type', 'power_unit_count', 'driver_count', 'd1_name'],
  landlord: ['full_name', 'phone', 'email', 'property_address', 'occupancy_status', 'liability_limit'],
  commercial: ['firstName', 'lastName', 'email', 'state', 'coverage']
};

const WEBHOOK_ENV = {
  personal_auto: 'GHL_PERSONAL_LINES_WEBHOOK_URL',
  homeowners: 'GHL_PERSONAL_LINES_WEBHOOK_URL',
  personal_umbrella: 'GHL_PERSONAL_LINES_WEBHOOK_URL',
  trucking: 'GHL_TRUCKING_WEBHOOK_URL',
  landlord: 'GHL_COMMERCIAL_WEBHOOK_URL',
  commercial: 'GHL_COMMERCIAL_WEBHOOK_URL'
};

const DISPLAY_NAMES = {
  personal_auto: 'Personal Auto',
  homeowners: 'Homeowners',
  personal_umbrella: 'Personal Umbrella',
  trucking: 'Commercial Trucking',
  landlord: 'Landlord Insurance',
  commercial: 'Commercial Insurance'
};

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
    'Vary': 'Origin'
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

function truckingDynamicField(field) {
  return /^(?:v(?:[1-9]|1[0-9]|20)_(?:year|make|model|vin|type|gvw|value|zip|cc|comp_collision)|d(?:[1-9]|1[0-9]|20)_(?:name|dob|lic_num|lic_state|exp|cdl|violations))$/.test(field);
}

function sanitizeValue(value, field) {
  const maxLength = ['notes', 'note', 'details', 'description', 'commodity_details', 'loss_details'].includes(field) ? 12000 : 2000;
  if (Array.isArray(value)) {
    if (value.length > 20) throw new Error('too_many_values');
    return value.map((item) => sanitizeValue(item, field));
  }
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('invalid_type');
  const clean = value === null ? '' : String(value).trim();
  if (clean.length > maxLength) throw new Error('field_too_long');
  return clean;
}

function normalizeContact(input) {
  const output = { ...input };
  const first = String(output.firstName || '').trim().replace(/\s+/g, ' ');
  const last = String(output.lastName || '').trim().replace(/\s+/g, ' ');
  const full = String(output.full_name || output.contact_name || `${first} ${last}`).trim().replace(/\s+/g, ' ');
  if (full) {
    const parts = full.split(' ');
    output.full_name = full;
    output.contact_name = full;
    output.first_name = output.first_name || parts[0];
    output.last_name = output.last_name || parts.slice(1).join(' ');
  }
  if (first) output.firstName = first;
  if (last) output.lastName = last;
  const email = String(output.email || output.contact_email || '').trim().toLowerCase();
  if (email) {
    output.email = email;
    output.contact_email = email;
  }
  let phone = String(output.phone || output.contact_phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) phone = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) phone = `+${digits}`;
  else if (digits.length >= 10 && digits.length <= 15) phone = `+${digits}`;
  if (phone) {
    output.phone = phone;
    output.contact_phone = phone;
  }
  return output;
}

function validateFields(line, state, fields) {
  const allowed = FIELD_ALLOWLISTS[line];
  const unexpected = Object.keys(fields).filter((field) => !allowed.has(field) && !(line === 'trucking' && truckingDynamicField(field)));
  if (unexpected.length) return ['unexpected_fields', 'The request contains fields that are not accepted for this quote form.'];
  if (state === 'complete' && REQUIRED_COMPLETE[line].some((field) => !fields[field])) {
    return ['missing_required', 'Please complete all required fields before submitting.'];
  }
  const name = fields.full_name || fields.contact_name || '';
  if (name.length < 2) return ['invalid_name', 'Please enter a valid full name.'];
  const email = fields.email || fields.contact_email || '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return ['invalid_email', 'Please enter a valid email address.'];
  const phone = fields.phone || fields.contact_phone || '';
  const phoneLength = phone.replace(/\D/g, '').length;
  if (phone && (phoneLength < 10 || phoneLength > 15)) return ['invalid_phone', 'Please enter a valid phone number.'];
  if (state === 'partial' && !email && !phone) return ['missing_contact', 'A phone number or email address is required.'];
  return null;
}

async function forwardToCrm(webhookUrl, upstreamPayload, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal
    });
    return { response };
  } catch {
    return { error: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSubmission(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > BODY_LIMIT) return fail(413, 'request_too_large', 'The submission is too large.');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > BODY_LIMIT) return fail(413, 'request_too_large', 'The submission is too large.');

  let data;
  try { data = JSON.parse(raw); }
  catch { return fail(400, 'invalid_json', 'The request body must be valid JSON.'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') return fail(400, 'invalid_request', 'The request body must be a JSON object.');

  const line = data.line_of_business;
  const submissionId = data.submission_id;
  const state = data.submission_state;
  if (!FIELD_ALLOWLISTS[line]) return fail(422, 'invalid_line_of_business', 'The quote type is not accepted.');
  if (typeof submissionId !== 'string' || !SUBMISSION_ID.test(submissionId)) return fail(422, 'invalid_submission_id', 'The submission identifier is invalid.');
  if (!['partial', 'complete'].includes(state)) return fail(422, 'invalid_submission_state', 'The submission state is invalid.');
  if (!data.fields || Array.isArray(data.fields) || typeof data.fields !== 'object' || !Object.keys(data.fields).length || Object.keys(data.fields).length > 200) {
    return fail(422, 'invalid_fields', 'The quote fields are invalid.');
  }
  if (String(data.honeypot || '').trim()) return fail(422, 'spam_detected', 'The submission was rejected.');
  if (state === 'complete') {
    if (typeof data.form_started_at_ms !== 'number') return fail(422, 'invalid_start_time', 'The form start time is invalid.');
    if (Date.now() - data.form_started_at_ms < MIN_COMPLETION_MS) {
      return fail(422, 'completion_time_rejected', 'Please take a moment to review the form before submitting.');
    }
  }

  let cleanFields = {};
  try {
    for (const [field, value] of Object.entries(data.fields)) cleanFields[field] = sanitizeValue(value, field);
  } catch {
    return fail(422, 'invalid_field_value', 'One or more quote fields are invalid.');
  }
  cleanFields = normalizeContact(cleanFields);
  const validation = validateFields(line, state, cleanFields);
  if (validation) return fail(422, validation[0], validation[1]);

  const webhookUrl = String(process.env[WEBHOOK_ENV[line]] || '').trim();
  if (!webhookUrl.startsWith('https://')) return fail(503, 'crm_not_configured', 'The quote service is temporarily unavailable.');

  const upstreamPayload = {
    ...cleanFields,
    submission_id: submissionId,
    submission_state: state,
    form_type: line,
    line_of_business: cleanFields.line_of_business || DISPLAY_NAMES[line],
    partial: state === 'partial' ? 'yes - contact step only' : 'no'
  };

  const forwarded = await forwardToCrm(webhookUrl, upstreamPayload);
  if (forwarded.error === 'timeout') return fail(504, 'crm_timeout', 'The CRM did not respond in time. Please try again.');
  if (forwarded.error) return fail(502, 'crm_network_error', 'The CRM could not be reached. Please try again.');
  const upstream = forwarded.response;

  if (!upstream.ok) return fail(502, 'crm_rejected', 'The CRM rejected the submission. Please try again.');
  let upstreamData;
  try { upstreamData = JSON.parse(await upstream.text()); }
  catch { return fail(502, 'crm_malformed_response', 'The CRM returned an invalid response. Please try again.'); }
  if (!upstreamData || Array.isArray(upstreamData) || typeof upstreamData !== 'object') {
    return fail(502, 'crm_malformed_response', 'The CRM returned an invalid response. Please try again.');
  }

  return json(200, { ok: true, submission_id: submissionId, submission_state: state });
}

export default async function quoteSubmit(request) {
  const origin = requestOrigin(request);
  if (!ALLOWED_ORIGINS.has(origin)) {
    return fail(403, 'origin_not_allowed', 'This submission origin is not allowed.');
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return withCors(fail(405, 'method_not_allowed', 'This request method is not allowed.'), origin);
  }
  return withCors(await handleSubmission(request), origin);
}

export const config = {
  path: '/api/quote-submit',
  method: ['POST', 'OPTIONS'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 300,
    windowLimit: 10
  }
};

export const testExports = { FIELD_ALLOWLISTS, truckingDynamicField, forwardToCrm };
