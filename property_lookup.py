# Pinnacle property lookup endpoint — RentCast underwriting autofill
import asyncio
import ipaddress
import os
import re
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Pinnacle Property Lookup")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pinnacleriskad.com",
        "https://www.pinnacleriskad.com",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
    max_age=600,
)

ALLOWED_SITE_ORIGINS = {
    "https://pinnacleriskad.com",
    "https://www.pinnacleriskad.com",
}
QUOTE_BODY_LIMIT = 64 * 1024
QUOTE_UPSTREAM_TIMEOUT_SECONDS = 8.0
QUOTE_MIN_COMPLETION_SECONDS = 3.0
QUOTE_RATE_LIMIT = 10
QUOTE_RATE_WINDOW_SECONDS = 300
SUBMISSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{20,100}$")

COMMON_QUOTE_FIELDS = {
    "first_name", "last_name", "full_name", "contact_name", "phone", "email",
    "contact_phone", "contact_email", "coverage_type", "line_of_business",
    "client_type", "source", "form_page", "page_url", "referrer", "gclid",
    "campaign", "ad_group", "lead_source", "submitted_at", "notes",
    "description", "files_noted", "form", "lead_status", "note", "partial",
}
QUOTE_FIELD_ALLOWLISTS = {
    "personal_auto": COMMON_QUOTE_FIELDS | {
        "is_client", "form_depth", "source_page", "garaging_zip", "zip",
        "num_vehicles", "num_drivers", "current_carrier", "current_limit",
        "renewal_date", "drv_cdl", "drv_violation", "drv_sr22", "drv_teen",
        "drv_declined", "drv_rideshare", "also_home", "also_umbrella",
        "also_landlord", "smsService", "smsMarketing",
    },
    "homeowners": COMMON_QUOTE_FIELDS | {
        "is_client", "form_depth", "source_page", "property_address", "roof_year",
        "occupancy", "current_carrier", "renewal_date", "hm_nonrenewed",
        "hm_claims", "hm_roof15", "hm_pool", "hm_dog", "hm_florida",
        "also_auto", "also_umbrella", "also_landlord", "smsService", "smsMarketing",
    },
    "personal_umbrella": COMMON_QUOTE_FIELDS | {
        "is_client", "form_depth", "source_page", "home_state", "state",
        "current_auto_carrier", "current_home_carrier", "auto_liability_limit",
        "desired_limit", "own_home", "own_rentals", "own_business", "own_teen",
        "own_pool", "own_dog", "own_boat", "own_rental_multi", "num_drivers",
        "num_vehicles", "also_auto", "also_home", "also_landlord", "smsService",
        "smsMarketing",
    },
    "trucking": COMMON_QUOTE_FIELDS | {
        "business_name", "company", "address", "entity_type", "usdot", "dot_number",
        "mc_number", "authority_status", "years_in_business", "new_venture",
        "operation_type", "cargo_type", "cargo", "commodity_details", "haul_radius",
        "states_of_operation", "states", "annual_revenue", "effective_date",
        "prior_coverage", "prior_carrier", "current_carrier", "power_unit_count",
        "driver_count", "trailer_count", "al_limit", "cargo_limit", "deductible",
        "cov_auto_liability", "cov_physical_damage", "cov_cargo",
        "cov_general_liability", "cov_bobtail", "cov_trailer_interchange",
        "cov_workers_comp", "cov_occ_accident", "cov_excess",
    },
    "landlord": COMMON_QUOTE_FIELDS | {
        "property_address", "property_type", "effective_date", "year_built", "roof_age",
        "occupancy_status", "dwelling_limit", "liability_limit", "prior_losses",
        "prior_losses_describe", "currently_insured", "insured_lapse_explain",
        "construction_type", "sq_footage", "num_stories", "num_units", "roof_material",
        "roof_shape", "electrical_panel", "plumbing_type", "update_roof",
        "update_electrical", "update_plumbing", "update_hvac", "valuation_pref",
        "monthly_rent", "deductible_pref", "form_pref", "rental_type",
        "commercial_space", "commercial_pct", "vacant_how_long", "vacant_reason",
        "vacant_secured", "vacant_utilities", "vacant_renovation", "reno_scope",
        "reno_pct_complete", "reno_gc", "reno_occupied", "has_pool", "pool_fenced",
        "pool_diving", "has_trampoline", "has_dogs", "dog_breeds", "has_wood_stove",
        "loss_details", "has_lapse", "lapse_explain", "fl_coast_distance",
        "fl_wind_mit", "fl_sinkhole", "mortgagee_info", "bathrooms", "bedrooms",
    },
    "commercial": COMMON_QUOTE_FIELDS | {
        "firstName", "lastName", "company", "state", "coverage", "details",
        "smsService", "smsMarketing", "smsOptInTimestamp", "smsOptInSource",
        "smsOptInPageUrl", "smsServiceConsent", "smsMarketingConsent",
        "smsDisclosureVersion",
    },
}
QUOTE_REQUIRED_COMPLETE = {
    "personal_auto": ("full_name", "phone", "email", "garaging_zip", "num_vehicles", "num_drivers"),
    "homeowners": ("full_name", "phone", "email", "property_address", "roof_year", "occupancy"),
    "personal_umbrella": ("full_name", "phone", "email", "home_state", "current_auto_carrier"),
    "trucking": ("contact_name", "phone", "email", "business_name", "operation_type", "haul_radius", "cargo_type", "power_unit_count", "driver_count", "d1_name"),
    "landlord": ("full_name", "phone", "email", "property_address", "occupancy_status", "liability_limit"),
    "commercial": ("firstName", "lastName", "email", "state", "coverage"),
}
QUOTE_WEBHOOK_ENVS = {
    "personal_auto": "GHL_PERSONAL_LINES_WEBHOOK_URL",
    "homeowners": "GHL_PERSONAL_LINES_WEBHOOK_URL",
    "personal_umbrella": "GHL_PERSONAL_LINES_WEBHOOK_URL",
    "trucking": "GHL_TRUCKING_WEBHOOK_URL",
    "landlord": "GHL_COMMERCIAL_WEBHOOK_URL",
    "commercial": "GHL_COMMERCIAL_WEBHOOK_URL",
}
QUOTE_DISPLAY_NAMES = {
    "personal_auto": "Personal Auto",
    "homeowners": "Homeowners",
    "personal_umbrella": "Personal Umbrella",
    "trucking": "Commercial Trucking",
    "landlord": "Landlord Insurance",
    "commercial": "Commercial Insurance",
}


class InMemoryRateLimiter:
    """Actual per-process rate limiting for the single-instance Render service."""

    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds
        self.entries = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def allow(self, key):
        now = time.monotonic()
        async with self.lock:
            bucket = self.entries[key]
            while bucket and bucket[0] <= now - self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                retry_after = max(1, int(self.window_seconds - (now - bucket[0])))
                return False, retry_after
            bucket.append(now)
            return True, 0

    async def reset(self):
        async with self.lock:
            self.entries.clear()


quote_rate_limiter = InMemoryRateLimiter(QUOTE_RATE_LIMIT, QUOTE_RATE_WINDOW_SECONDS)

RENTCAST_API_KEY = os.environ.get("RENTCAST_API_KEY", "")
RENTCAST_BASE = "https://api.rentcast.io/v1"

ROOF_MAP = {
    "asphalt": "Asphalt Shingle", "shingle": "Asphalt Shingle", "composition": "Asphalt Shingle",
    "metal": "Metal",
    "tile": "Tile", "clay": "Tile", "concrete": "Tile",
    "membrane": "Flat/Membrane", "flat": "Flat/Membrane", "rubber": "Flat/Membrane", "built-up": "Flat/Membrane",
}
CONSTRUCTION_MAP = {
    "frame": "Frame", "wood": "Frame",
    "masonry": "Masonry", "brick": "Masonry", "block": "Masonry", "concrete": "Masonry",
    "stucco": "Masonry Veneer", "veneer": "Masonry Veneer",
}


def map_value(value, table):
    if not value:
        return None
    text = str(value).lower()
    for key, out in table.items():
        if key in text:
            return out
    return None


@app.get("/property-lookup")
async def property_lookup(address: str = Query(..., min_length=6)):
    if not RENTCAST_API_KEY:
        return {"found": False, "error": "Server not configured"}

    headers = {"Accept": "application/json", "X-Api-Key": RENTCAST_API_KEY}

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(RENTCAST_BASE + "/properties",
                                    params={"address": address}, headers=headers)
        except Exception:
            return {"found": False, "error": "Upstream request failed"}

        if resp.status_code != 200:
            return {"found": False, "status": resp.status_code}

        data = resp.json()
        record = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
        if not record:
            return {"found": False}

        features = record.get("features") or {}
        floor_count = features.get("floorCount")

        # Best-effort value estimate to pre-fill Coverage A (won't break the lookup if unavailable)
        estimated_value = None
        try:
            v = await client.get(RENTCAST_BASE + "/avm/value",
                                 params={"address": address}, headers=headers)
            if v.status_code == 200:
                estimated_value = (v.json() or {}).get("price")
        except Exception:
            pass

    return {
        "found": True,
        "year_built": record.get("yearBuilt"),
        "square_footage": record.get("squareFootage"),
        "stories": str(floor_count) if floor_count else None,
        "units": features.get("unitCount"),
        "roof_material": map_value(features.get("roofType"), ROOF_MAP),
        "construction_type": map_value(
            features.get("exteriorType") or features.get("architectureType"), CONSTRUCTION_MAP),
        "property_type": record.get("propertyType"),
        "bedrooms": record.get("bedrooms"),
        "bathrooms": record.get("bathrooms"),
        "lot_size": record.get("lotSize"),
        "county": record.get("county"),
        "estimated_value": estimated_value,
    }


FMCSA_WEB_KEY = os.environ.get("FMCSA_WEB_KEY", "")
FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services"


@app.get("/dot-lookup")
async def dot_lookup(dot: str = Query(..., min_length=1, max_length=12)):
    """Server-side FMCSA carrier lookup so the site never depends on
    flaky public CORS proxies. Returns FMCSA's raw JSON shape
    ({content: {carrier: {...}}}) that the front end already parses."""
    dot_clean = "".join(ch for ch in dot if ch.isdigit())
    if not dot_clean:
        return {"found": False, "error": "Invalid DOT number"}
    if not FMCSA_WEB_KEY:
        return {"found": False, "error": "Server not configured"}

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                f"{FMCSA_BASE}/carriers/{dot_clean}",
                params={"webKey": FMCSA_WEB_KEY},
                headers={"Accept": "application/json"},
            )
        except Exception:
            return {"found": False, "error": "Upstream request failed"}

        if resp.status_code != 200:
            return {"found": False, "status": resp.status_code}

        try:
            data = resp.json()
        except Exception:
            return {"found": False, "error": "Bad upstream response"}

        # FMCSA's main carrier record does not include the MC number —
        # it lives in the docket-numbers feed. Merge it in server-side so
        # the site gets everything in one call.
        try:
            content = data.get("content") if isinstance(data, dict) else None
            carrier = content.get("carrier") if isinstance(content, dict) else None
            if carrier is not None and not carrier.get("mcNumber"):
                d2 = await client.get(
                    f"{FMCSA_BASE}/carriers/{dot_clean}/docket-numbers",
                    params={"webKey": FMCSA_WEB_KEY},
                    headers={"Accept": "application/json"},
                )
                if d2.status_code == 200:
                    dockets = (d2.json() or {}).get("content") or []
                    if isinstance(dockets, dict):
                        dockets = [dockets]
                    for item in dockets:
                        if not isinstance(item, dict):
                            continue
                        rec = item.get("carrier") if isinstance(item.get("carrier"), dict) else item
                        num = rec.get("docketNumber")
                        if num:
                            carrier["mcNumber"] = num
                            break
        except Exception:
            pass  # MC merge is best-effort; never break the main lookup

    return data


def quote_error(status_code, code, message, headers=None):
    return JSONResponse(
        status_code=status_code,
        content={"ok": False, "code": code, "message": message},
        headers=headers or {},
    )


def request_origin_is_allowed(request):
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin:
        return origin in ALLOWED_SITE_ORIGINS
    referer = request.headers.get("referer") or ""
    if not referer:
        return False
    parsed = urlparse(referer)
    return f"{parsed.scheme}://{parsed.netloc}" in ALLOWED_SITE_ORIGINS


def request_client_ip(request):
    direct = request.client.host if request.client else "unknown"
    try:
        direct_is_private = ipaddress.ip_address(direct).is_private
    except ValueError:
        direct_is_private = False
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if direct_is_private and forwarded:
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return direct


def trucking_dynamic_field_is_allowed(field):
    return bool(re.fullmatch(
        r"(?:v(?:[1-9]|1[0-9]|20)_(?:year|make|model|vin|type|gvw|value|zip|cc|comp_collision)"
        r"|d(?:[1-9]|1[0-9]|20)_(?:name|dob|lic_num|lic_state|exp|cdl|violations))",
        field,
    ))


def sanitize_quote_value(value, field):
    max_length = 12000 if field in {"notes", "note", "details", "description", "commodity_details", "loss_details"} else 2000
    if isinstance(value, list):
        if len(value) > 20:
            raise ValueError("too many values")
        return [sanitize_quote_value(item, field) for item in value]
    if not isinstance(value, (str, int, float, bool)) and value is not None:
        raise ValueError("invalid field type")
    clean = "" if value is None else str(value).strip()
    if len(clean) > max_length:
        raise ValueError("field too long")
    return clean


def normalize_quote_contact(fields):
    first = " ".join(fields.get("firstName", "").split())
    last = " ".join(fields.get("lastName", "").split())
    full = " ".join((fields.get("full_name") or fields.get("contact_name") or f"{first} {last}").split())
    if full:
        parts = full.split()
        fields["full_name"] = full
        fields["contact_name"] = fields.get("contact_name") or full
        fields["first_name"] = fields.get("first_name") or parts[0]
        fields["last_name"] = fields.get("last_name") or " ".join(parts[1:])
    email = (fields.get("email") or fields.get("contact_email") or "").strip().lower()
    if email:
        fields["email"] = email
        fields["contact_email"] = fields.get("contact_email") or email
    phone = fields.get("phone") or fields.get("contact_phone") or ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        phone = "+1" + digits
    elif len(digits) == 11 and digits.startswith("1"):
        phone = "+" + digits
    elif 10 <= len(digits) <= 15:
        phone = "+" + digits
    if phone:
        fields["phone"] = phone
        fields["contact_phone"] = fields.get("contact_phone") or phone
    return fields


def validate_quote_fields(line_of_business, state, fields):
    allowed = QUOTE_FIELD_ALLOWLISTS[line_of_business]
    unknown = [
        field for field in fields
        if field not in allowed and not (
            line_of_business == "trucking" and trucking_dynamic_field_is_allowed(field)
        )
    ]
    if unknown:
        return "unexpected_fields", "The request contains fields that are not accepted for this quote form."

    if state == "complete":
        missing = [field for field in QUOTE_REQUIRED_COMPLETE[line_of_business] if not fields.get(field)]
        if missing:
            return "missing_required", "Please complete all required fields before submitting."

    name = fields.get("full_name") or fields.get("contact_name") or ""
    if len(name) < 2:
        return "invalid_name", "Please enter a valid full name."
    email = fields.get("email") or fields.get("contact_email") or ""
    if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", email):
        return "invalid_email", "Please enter a valid email address."
    phone = fields.get("phone") or fields.get("contact_phone") or ""
    if phone and not 10 <= len(re.sub(r"\D", "", phone)) <= 15:
        return "invalid_phone", "Please enter a valid phone number."
    if state == "partial" and not email and not phone:
        return "missing_contact", "A phone number or email address is required."
    return None


async def forward_quote_to_crm(request, webhook_url, payload):
    transport = getattr(request.app.state, "crm_transport", None)
    timeout = httpx.Timeout(QUOTE_UPSTREAM_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
        return await client.post(
            webhook_url,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )


@app.post("/quote-submit")
async def quote_submit(request: Request):
    if not request_origin_is_allowed(request):
        return quote_error(403, "origin_not_allowed", "This submission origin is not allowed.")

    allowed, retry_after = await quote_rate_limiter.allow(request_client_ip(request))
    if not allowed:
        return quote_error(
            429,
            "rate_limited",
            "Too many requests. Please wait before trying again.",
            {"Retry-After": str(retry_after)},
        )

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > QUOTE_BODY_LIMIT:
        return quote_error(413, "request_too_large", "The submission is too large.")
    body = await request.body()
    if len(body) > QUOTE_BODY_LIMIT:
        return quote_error(413, "request_too_large", "The submission is too large.")
    try:
        data = await request.json()
    except Exception:
        return quote_error(400, "invalid_json", "The request body must be valid JSON.")
    if not isinstance(data, dict):
        return quote_error(400, "invalid_request", "The request body must be a JSON object.")

    line_of_business = data.get("line_of_business")
    submission_id = data.get("submission_id")
    state = data.get("submission_state")
    fields = data.get("fields")
    if line_of_business not in QUOTE_FIELD_ALLOWLISTS:
        return quote_error(422, "invalid_line_of_business", "The quote type is not accepted.")
    if not isinstance(submission_id, str) or not SUBMISSION_ID_RE.fullmatch(submission_id):
        return quote_error(422, "invalid_submission_id", "The submission identifier is invalid.")
    if state not in {"partial", "complete"}:
        return quote_error(422, "invalid_submission_state", "The submission state is invalid.")
    if not isinstance(fields, dict) or not fields or len(fields) > 200:
        return quote_error(422, "invalid_fields", "The quote fields are invalid.")
    if str(data.get("honeypot") or "").strip():
        return quote_error(422, "spam_detected", "The submission was rejected.")

    started_at_ms = data.get("form_started_at_ms")
    if state == "complete":
        if not isinstance(started_at_ms, (int, float)):
            return quote_error(422, "invalid_start_time", "The form start time is invalid.")
        elapsed_seconds = (time.time() * 1000 - started_at_ms) / 1000
        if elapsed_seconds < QUOTE_MIN_COMPLETION_SECONDS:
            return quote_error(422, "completion_time_rejected", "Please take a moment to review the form before submitting.")

    clean_fields = {}
    try:
        for field, value in fields.items():
            if not isinstance(field, str):
                raise ValueError("invalid field name")
            clean_fields[field] = sanitize_quote_value(value, field)
    except ValueError:
        return quote_error(422, "invalid_field_value", "One or more quote fields are invalid.")
    clean_fields = normalize_quote_contact(clean_fields)
    validation_error = validate_quote_fields(line_of_business, state, clean_fields)
    if validation_error:
        return quote_error(422, validation_error[0], validation_error[1])

    webhook_env = QUOTE_WEBHOOK_ENVS[line_of_business]
    webhook_url = os.environ.get(webhook_env, "").strip()
    if not webhook_url.startswith("https://"):
        return quote_error(503, "crm_not_configured", "The quote service is temporarily unavailable.")

    upstream_payload = dict(clean_fields)
    upstream_payload["submission_id"] = submission_id
    upstream_payload["submission_state"] = state
    upstream_payload["form_type"] = line_of_business
    upstream_payload.setdefault("line_of_business", QUOTE_DISPLAY_NAMES[line_of_business])
    upstream_payload["partial"] = "yes - contact step only" if state == "partial" else "no"

    try:
        upstream = await forward_quote_to_crm(request, webhook_url, upstream_payload)
    except httpx.TimeoutException:
        return quote_error(504, "crm_timeout", "The CRM did not respond in time. Please try again.")
    except httpx.RequestError:
        return quote_error(502, "crm_network_error", "The CRM could not be reached. Please try again.")

    if not 200 <= upstream.status_code < 300:
        return quote_error(502, "crm_rejected", "The CRM rejected the submission. Please try again.")
    try:
        upstream_data = upstream.json()
    except ValueError:
        return quote_error(502, "crm_malformed_response", "The CRM returned an invalid response. Please try again.")
    if not isinstance(upstream_data, dict):
        return quote_error(502, "crm_malformed_response", "The CRM returned an invalid response. Please try again.")

    return {
        "ok": True,
        "submission_id": submission_id,
        "submission_state": state,
    }


@app.get("/")
def health():
    return {
        "ok": True,
        "configured": bool(RENTCAST_API_KEY),
        "rentcast_configured": bool(RENTCAST_API_KEY),
        "fmcsa_configured": bool(FMCSA_WEB_KEY),
        "quote_webhooks_configured": {
            "personal_lines": bool(os.environ.get("GHL_PERSONAL_LINES_WEBHOOK_URL")),
            "trucking": bool(os.environ.get("GHL_TRUCKING_WEBHOOK_URL")),
            "commercial": bool(os.environ.get("GHL_COMMERCIAL_WEBHOOK_URL")),
        },
    }
