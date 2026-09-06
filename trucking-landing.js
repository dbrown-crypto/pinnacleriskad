(function (root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinnacleTruckingLanding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var LOOKUP_ENDPOINT = 'https://pinnacleriskad.onrender.com/dot-lookup?dot=';
  var CONVERSION_DESTINATION = 'AW-18335963415/EQMqCIG2sNMcEJeyoqdE';
  var ATTRIBUTION_KEYS = [
    'gclid', 'gbraid', 'wbraid', 'campaignid', 'adgroupid', 'keyword',
    'matchtype', 'creative', 'device', 'utm_campaign', 'utm_source',
    'utm_medium', 'utm_content'
  ];

  function queryAttribution(search) {
    var query = new URLSearchParams(search || '');
    return {
      gclid: query.get('gclid') || '',
      gbraid: query.get('gbraid') || '',
      wbraid: query.get('wbraid') || '',
      campaign: query.get('utm_campaign') || '',
      campaign_id: query.get('campaignid') || '',
      ad_group: query.get('adgroup') || query.get('utm_content') || '',
      ad_group_id: query.get('adgroupid') || '',
      keyword: query.get('keyword') || '',
      match_type: query.get('matchtype') || '',
      creative_id: query.get('creative') || '',
      device: query.get('device') || '',
      campaign_source: query.get('utm_source') || '',
      campaign_medium: query.get('utm_medium') || ''
    };
  }

  function continuationUrl(dot, search) {
    var params = new URLSearchParams();
    var current = new URLSearchParams(search || '');
    var cleanDot = String(dot || '').replace(/\D/g, '');
    if (cleanDot) params.set('dot', cleanDot);
    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = current.get(key);
      if (value) params.set(key, value);
    });
    var suffix = params.toString();
    return '/trucking-quote.html' + (suffix ? '?' + suffix : '');
  }

  function text(node, value) {
    if (node) node.textContent = value || '';
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function safeCarrier(payload) {
    return payload && payload.content && payload.content.carrier
      ? payload.content.carrier
      : null;
  }

  function lookupDot(dot, fetchFn) {
    var clean = String(dot || '').replace(/\D/g, '');
    if (!clean) return Promise.reject(new Error('Enter a USDOT number.'));
    var request = fetchFn || root.fetch;
    if (typeof request !== 'function') return Promise.reject(new Error('Lookup is unavailable.'));
    return request(LOOKUP_ENDPOINT + encodeURIComponent(clean), {
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('Lookup service rejected the request.');
      return response.json();
    }).then(function (payload) {
      var carrier = safeCarrier(payload);
      if (!carrier) throw new Error('No carrier record was returned.');
      return carrier;
    });
  }

  function fireConversion(detail) {
    if (typeof root.gtag === 'function') {
      root.gtag('event', 'conversion', {
        send_to: CONVERSION_DESTINATION,
        transaction_id: detail.submission_id || ''
      });
    }
    root.dataLayer = root.dataLayer || [];
    root.dataLayer.push({
      event: 'trucking_quote_form_submit',
      form_name: detail.form_name || '',
      submission_id: detail.submission_id || '',
      landing_page_variant: detail.landing_page_variant || ''
    });
  }

  function initDotLookup(form) {
    var input = form.querySelector('[name="usdot"]');
    var button = form.querySelector('[data-dot-lookup]');
    var skip = form.querySelector('[data-no-dot]');
    var result = form.querySelector('[data-dot-result]');
    var error = form.querySelector('[data-dot-error]');
    var business = form.querySelector('[name="business_name"]');
    var units = form.querySelector('[name="power_unit_count"]');
    if (!input || !button) return;

    button.addEventListener('click', function () {
      var original = button.textContent;
      button.disabled = true;
      button.textContent = 'Looking up…';
      text(error, '');
      show(result, false);
      lookupDot(input.value).then(function (carrier) {
        var name = carrier.legalName || carrier.dbaName || 'Carrier found';
        if (business && !business.value) business.value = name;
        if (units && !units.value && carrier.totalPowerUnits) units.value = String(carrier.totalPowerUnits);
        text(result, name + (carrier.totalPowerUnits ? ' · ' + carrier.totalPowerUnits + ' power unit' + (String(carrier.totalPowerUnits) === '1' ? '' : 's') : ''));
        show(result, true);
        if (business) business.focus();
      }).catch(function () {
        text(error, 'We could not retrieve that record. Check the number or continue without it.');
        if (business) business.focus();
      }).finally(function () {
        button.disabled = false;
        button.textContent = original;
      });
    });

    if (skip) skip.addEventListener('click', function () {
      input.value = '';
      text(error, 'No problem. Enter your business name and continue.');
      show(result, false);
      if (business) business.focus();
    });
  }

  function initRouting(form) {
    var route = form.querySelector('[name="operation_type"]');
    var leased = form.querySelector('[data-leased-route]');
    if (!route || !leased) return;
    function sync() { show(leased, route.value === 'Leased-on owner operator'); }
    route.addEventListener('change', sync);
    sync();
  }

  function initForm(form) {
    if (!root.PinnacleQuote) return;
    var variant = form.getAttribute('data-variant') || 'trucking-landing';
    var session = root.PinnacleQuote.createSession({
      formKey: variant,
      lineOfBusiness: 'trucking'
    });
    var button = form.querySelector('[type="submit"]');
    var success = form.parentElement.querySelector('[data-form-success]');
    var continueLink = success ? success.querySelector('[data-continue-quote]') : null;
    initDotLookup(form);
    initRouting(form);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      root.PinnacleQuote.clearFailure(form);
      var original = button.textContent;
      button.disabled = true;
      button.textContent = 'Sending…';
      var fields = root.PinnacleQuote.formToObject(form);
      var honeypot = fields.website || '';
      delete fields.website;
      var attribution = queryAttribution(root.location ? root.location.search : '');
      Object.assign(fields, attribution, {
        coverage_type: form.getAttribute('data-coverage') || 'Commercial Trucking',
        line_of_business: 'Commercial Trucking',
        form_depth: 'short',
        source_page: root.location ? root.location.pathname : '',
        form_page: root.location ? root.location.pathname : '',
        page_url: root.location ? root.location.href : '',
        referrer: root.document ? root.document.referrer : '',
        landing_page_variant: variant,
        lead_source: attribution.gclid || attribution.gbraid || attribution.wbraid ? 'Google Ads Trucking Landing Page' : 'Website Trucking Landing Page',
        source: attribution.gclid || attribution.gbraid || attribution.wbraid ? 'google-ads' : 'website',
        submitted_at: new Date().toISOString(),
        contact_name: fields.contact_name || '',
        contact_phone: fields.phone || '',
        contact_email: fields.email || '',
        company: fields.business_name || '',
        dot_number: fields.usdot || ''
      });

      session.submitComplete(fields, honeypot).then(function (response) {
        if (!response.duplicate) fireConversion({
          submission_id: response.submission_id,
          form_name: variant,
          landing_page_variant: variant
        });
        if (continueLink) continueLink.href = continuationUrl(fields.usdot, root.location ? root.location.search : '');
        form.hidden = true;
        show(success, true);
        if (success) success.focus();
      }).catch(function (error) {
        button.disabled = false;
        button.textContent = original;
        root.PinnacleQuote.logDiagnostic(variant + '_submit_failed', error);
        root.PinnacleQuote.showFailure(form, error);
      });
    });
  }

  function boot() {
    if (!root.document) return;
    Array.prototype.forEach.call(root.document.querySelectorAll('.pra-landing-form'), initForm);
    Array.prototype.forEach.call(root.document.querySelectorAll('[data-call-link]'), function (link) {
      link.addEventListener('click', function () {
        var attribution = queryAttribution(root.location ? root.location.search : '');
        root.dataLayer = root.dataLayer || [];
        root.dataLayer.push({
          event: 'phone_link_click',
          phone_number: '+17707583197',
          page_path: root.location ? root.location.pathname : '',
          campaign_id: attribution.campaign_id,
          ad_group_id: attribution.ad_group_id,
          gclid: attribution.gclid
        });
        if (typeof root.gtag === 'function') {
          root.gtag('event', 'phone_link_click', {
            phone_number: '+17707583197',
            page_path: root.location ? root.location.pathname : ''
          });
        }
      });
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return {
    queryAttribution: queryAttribution,
    continuationUrl: continuationUrl,
    lookupDot: lookupDot,
    safeCarrier: safeCarrier,
    conversionDestination: CONVERSION_DESTINATION
  };
});
