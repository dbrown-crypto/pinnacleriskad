"""Exercise the real ASGI route without external FMCSA calls or API keys."""
import unittest
from unittest.mock import patch, AsyncMock

import httpx
import property_lookup


class DotLookupTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_returns_uncacheable_503_with_cors(self):
        transport = httpx.ASGITransport(app=property_lookup.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://lookup.test") as client:
            with patch.object(property_lookup, "FMCSA_WEB_KEY", ""), patch.object(property_lookup.httpx, "AsyncClient") as upstream:
                response = await client.get("/dot-lookup?dot=1234567", headers={"Origin": "https://pinnacleriskad.com"})
                upstream.assert_not_called()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"found": False, "error": "Server not configured"})
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["access-control-allow-origin"], "https://pinnacleriskad.com")

    async def test_configured_lookup_retains_carrier_response_contract(self):
        carrier = {"legalName": "Example Transport LLC", "totalPowerUnits": 2, "mcNumber": "12345"}
        transport = httpx.ASGITransport(app=property_lookup.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://lookup.test") as client:
            with patch.object(property_lookup, "FMCSA_WEB_KEY", "test-only-key"), patch.object(property_lookup.httpx, "AsyncClient") as upstream:
                upstream.return_value.__aenter__.return_value.get = AsyncMock(return_value=httpx.Response(200, json={"content": {"carrier": carrier}}))
                response = await client.get("/dot-lookup?dot=1234567")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"]["carrier"], carrier)

    async def test_no_record_remains_a_normal_lookup_result(self):
        transport = httpx.ASGITransport(app=property_lookup.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://lookup.test") as client:
            with patch.object(property_lookup, "FMCSA_WEB_KEY", "test-only-key"), patch.object(property_lookup.httpx, "AsyncClient") as upstream:
                upstream.return_value.__aenter__.return_value.get = AsyncMock(return_value=httpx.Response(200, json={"content": {"carrier": None}}))
                response = await client.get("/dot-lookup?dot=1234567")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["content"]["carrier"])


if __name__ == "__main__":
    unittest.main()
