# Pinnacle property lookup endpoint — RentCast underwriting autofill
import os
import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Pinnacle Property Lookup")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

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


FMCSA_WEB_KEY = os.environ.get(
    "FMCSA_WEB_KEY", "311d231f2053b66d7f2d499fec6efcce6920de93")
FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services"


@app.get("/dot-lookup")
async def dot_lookup(dot: str = Query(..., min_length=1, max_length=12)):
    """Server-side FMCSA carrier lookup so the site never depends on
    flaky public CORS proxies. Returns FMCSA's raw JSON shape
    ({content: {carrier: {...}}}) that the front end already parses."""
    dot_clean = "".join(ch for ch in dot if ch.isdigit())
    if not dot_clean:
        return {"found": False, "error": "Invalid DOT number"}

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


@app.get("/")
def health():
    return {"ok": True, "configured": bool(RENTCAST_API_KEY)}
