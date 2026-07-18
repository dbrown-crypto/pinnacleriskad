# Pinnacle property lookup endpoint
# Deploy on Render as its own service, or fold this route into your existing FastAPI app.
#
# Setup on Render:
#   1. Add this file to your service (or copy the /property-lookup route into your app).
#   2. Set an environment variable: RENTCAST_API_KEY = your key from app.rentcast.io
#   3. requirements.txt must include: fastapi  uvicorn  httpx
#   4. Start command: uvicorn property_lookup:app --host 0.0.0.0 --port $PORT
#
# The RentCast key stays here on the server and is never exposed in the web page.

import os
import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Pinnacle Property Lookup")

# Only your own site may call this from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

RENTCAST_API_KEY = os.environ.get("RENTCAST_API_KEY", "")
RENTCAST_URL = "https://api.rentcast.io/v1/properties"

# Map RentCast values to the exact dropdown options on your landlord form.
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
    params = {"address": address}

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(RENTCAST_URL, params=params, headers=headers)
    except Exception:
        return {"found": False, "error": "Upstream request failed"}

    if resp.status_code != 200:
        return {"found": False, "status": resp.status_code}

    data = resp.json()
    # RentCast can return a list of records or a single object.
    record = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not record:
        return {"found": False}

    features = record.get("features") or {}
    floor_count = features.get("floorCount")

    return {
        "found": True,
        "year_built": record.get("yearBuilt"),
        "square_footage": record.get("squareFootage"),
        "stories": str(floor_count) if floor_count else None,
        "units": features.get("unitCount"),
        "roof_material": map_value(features.get("roofType"), ROOF_MAP),
        "construction_type": map_value(
            features.get("exteriorType") or features.get("architectureType"), CONSTRUCTION_MAP
        ),
        "property_type": record.get("propertyType"),
    }


# Simple health check for Render
@app.get("/")
def health():
    return {"ok": True, "configured": bool(RENTCAST_API_KEY)}
