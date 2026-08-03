import json
import os
import time
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

import httpx

import property_lookup


ORIGIN_HEADERS = {
    "Origin": "https://pinnacleriskad.com",
    "X-Forwarded-For": "203.0.113.20",
}


def request_payload(**overrides):
    payload = {
        "line_of_business": "personal_auto",
        "submission_id": "11111111-1111-4111-8111-111111111111",
        "submission_state": "complete",
        "form_started_at_ms": time.time() * 1000 - 5000,
        "honeypot": "",
        "fields": {
            "full_name": " Derrick   Brown ",
            "phone": "(770) 758-3197",
            "email": "DBROWN@EXAMPLE.COM",
            "garaging_zip": "30339",
            "num_vehicles": "2",
            "num_drivers": "2",
        },
    }
    payload.update(overrides)
    return payload


class QuoteEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await property_lookup.quote_rate_limiter.reset()
        self.env = patch.dict(os.environ, {
            "GHL_PERSONAL_LINES_WEBHOOK_URL": "https://crm.example.test/personal",
            "GHL_TRUCKING_WEBHOOK_URL": "https://crm.example.test/trucking",
            "GHL_COMMERCIAL_WEBHOOK_URL": "https://crm.example.test/commercial",
        })
        self.env.start()

    async def asyncTearDown(self):
        self.env.stop()
        if hasattr(property_lookup.app.state, "crm_transport"):
            delattr(property_lookup.app.state, "crm_transport")

    async def post(self, payload, headers=None):
        transport = httpx.ASGITransport(app=property_lookup.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://api.example.test") as client:
            return await client.post("/quote-submit", json=payload, headers=headers or ORIGIN_HEADERS)

    async def test_successful_crm_response(self):
        captured = {}

        def handler(request):
            captured.update(json.loads(request.content))
            return httpx.Response(200, json={"status": "success"})

        property_lookup.app.state.crm_transport = httpx.MockTransport(handler)
        response = await self.post(request_payload())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)
        self.assertEqual(captured["submission_state"], "complete")
        self.assertEqual(captured["submission_id"], request_payload()["submission_id"])
        self.assertEqual(captured["phone"], "+17707583197")
        self.assertEqual(captured["email"], "dbrown@example.com")

    async def test_crm_400_and_500_are_failures(self):
        for status in (400, 500):
            await property_lookup.quote_rate_limiter.reset()
            property_lookup.app.state.crm_transport = httpx.MockTransport(
                lambda request, value=status: httpx.Response(value, json={"error": "upstream"})
            )
            response = await self.post(request_payload())
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["code"], "crm_rejected")

    async def test_crm_timeout(self):
        def handler(request):
            raise httpx.ReadTimeout("timed out", request=request)

        property_lookup.app.state.crm_transport = httpx.MockTransport(handler)
        response = await self.post(request_payload())
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["code"], "crm_timeout")

    async def test_malformed_crm_response(self):
        property_lookup.app.state.crm_transport = httpx.MockTransport(
            lambda request: httpx.Response(200, text="not-json")
        )
        response = await self.post(request_payload())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["code"], "crm_malformed_response")

    async def test_origin_and_referer_validation(self):
        property_lookup.app.state.crm_transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"status": "success"})
        )
        blocked = await self.post(request_payload(), {"Origin": "https://attacker.example"})
        self.assertEqual(blocked.status_code, 403)
        allowed = await self.post(request_payload(), {
            "Referer": "https://www.pinnacleriskad.com/auto-quote.html",
            "X-Forwarded-For": "203.0.113.21",
        })
        self.assertEqual(allowed.status_code, 200)

    async def test_honeypot_and_minimum_time(self):
        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"status": "success"})

        property_lookup.app.state.crm_transport = httpx.MockTransport(handler)
        honeypot = await self.post(request_payload(honeypot="bot"))
        self.assertEqual(honeypot.status_code, 422)
        self.assertEqual(honeypot.json()["code"], "spam_detected")
        too_fast = await self.post(request_payload(form_started_at_ms=time.time() * 1000))
        self.assertEqual(too_fast.status_code, 422)
        self.assertEqual(too_fast.json()["code"], "completion_time_rejected")
        self.assertEqual(calls, 0)

    async def test_allowlist_and_required_values(self):
        property_lookup.app.state.crm_transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"status": "success"})
        )
        fields = request_payload()["fields"] | {"admin_override": "true"}
        unexpected = await self.post(request_payload(fields=fields))
        self.assertEqual(unexpected.status_code, 422)
        self.assertEqual(unexpected.json()["code"], "unexpected_fields")
        missing = await self.post(request_payload(fields={"full_name": "Derrick Brown", "email": "d@example.com"}))
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(missing.json()["code"], "missing_required")

    async def test_per_ip_rate_limit_is_enforced(self):
        property_lookup.app.state.crm_transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"status": "success"})
        )
        for number in range(property_lookup.QUOTE_RATE_LIMIT):
            payload = request_payload(submission_id=f"11111111-1111-4111-8111-{number:012d}")
            response = await self.post(payload)
            self.assertEqual(response.status_code, 200)
        blocked = await self.post(request_payload(submission_id="11111111-1111-4111-8111-999999999999"))
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Retry-After", blocked.headers)

    async def test_html_form_fields_match_server_allowlists(self):
        class FormFields(HTMLParser):
            def __init__(self, form_id):
                super().__init__()
                self.form_id = form_id
                self.inside = False
                self.fields = []

            def handle_starttag(self, tag, attrs):
                values = dict(attrs)
                if tag == "form" and values.get("id") == self.form_id:
                    self.inside = True
                if self.inside and tag in {"input", "select", "textarea"} and values.get("name"):
                    self.fields.append((values["name"], values.get("type", "")))

            def handle_endtag(self, tag):
                if tag == "form" and self.inside:
                    self.inside = False

        forms = {
            "auto-quote.html": ("auto-quote-form", "personal_auto"),
            "home-quote.html": ("home-quote-form", "homeowners"),
            "umbrella-quote.html": ("umbrella-quote-form", "personal_umbrella"),
            "trucking-quote.html": ("truckingQuoteForm", "trucking"),
            "landlord-insurance-quote.html": ("landlord-quote-form", "landlord"),
            "quote.html": ("quoteForm", "commercial"),
        }
        root = Path(__file__).resolve().parents[1]
        for filename, (form_id, line_of_business) in forms.items():
            parser = FormFields(form_id)
            parser.feed((root / filename).read_text())
            for field, input_type in parser.fields:
                if field == "website" or field.startswith("_") or input_type == "file":
                    continue
                allowed = field in property_lookup.QUOTE_FIELD_ALLOWLISTS[line_of_business]
                if line_of_business == "trucking":
                    allowed = allowed or property_lookup.trucking_dynamic_field_is_allowed(field)
                self.assertTrue(allowed, f"{filename}: {field} is not allowlisted")


if __name__ == "__main__":
    unittest.main()
