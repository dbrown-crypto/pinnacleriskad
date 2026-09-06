const test = require('node:test');
const assert = require('node:assert/strict');
const Landing = require('../trucking-landing.js');

test('captures ValueTrack and UTM attribution independently', () => {
  const data = Landing.queryAttribution('?gclid=abc123&campaignid=10&adgroupid=20&keyword=motor%20carrier%20insurance&matchtype=e&creative=30&device=m&utm_campaign=ga-trucking&utm_source=google&utm_medium=cpc&utm_content=motor');
  assert.equal(data.gclid, 'abc123');
  assert.equal(data.campaign_id, '10');
  assert.equal(data.ad_group_id, '20');
  assert.equal(data.keyword, 'motor carrier insurance');
  assert.equal(data.match_type, 'e');
  assert.equal(data.creative_id, '30');
  assert.equal(data.device, 'm');
  assert.equal(data.campaign, 'ga-trucking');
  assert.equal(data.campaign_source, 'google');
  assert.equal(data.campaign_medium, 'cpc');
  assert.equal(data.ad_group, 'motor');
});

test('step-two URL carries DOT and non-PII click attribution', () => {
  const url = Landing.continuationUrl('12-34 567', '?gclid=abc&campaignid=10&keyword=bobtail%20insurance&utm_campaign=ga');
  assert.equal(url, '/trucking-quote.html?dot=1234567&gclid=abc&campaignid=10&keyword=bobtail+insurance&utm_campaign=ga');
  assert.equal(url.includes('email='), false);
  assert.equal(url.includes('phone='), false);
});

test('DOT lookup accepts the existing carrier response shape', async () => {
  let requested;
  const carrier = await Landing.lookupDot('1234567', async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ content: { carrier: { legalName: 'Test Carrier LLC', totalPowerUnits: 2 } } }) };
  });
  assert.equal(requested.endsWith('dot=1234567'), true);
  assert.equal(carrier.legalName, 'Test Carrier LLC');
  assert.equal(carrier.totalPowerUnits, 2);
});

test('conversion destination matches the working trucking quote form', () => {
  assert.equal(Landing.conversionDestination, 'AW-18335963415/EQMqCIG2sNMcEJeyoqdE');
});
