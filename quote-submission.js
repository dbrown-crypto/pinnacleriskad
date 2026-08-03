(function (root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinnacleQuote = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /* The public .com site is hosted on GitHub Pages. Quote delivery runs on
     the agency's Netlify project, which provides the required server-side
     function runtime. */
  var DEFAULT_ENDPOINT = 'https://pinnacleriskadvisors.net/api/quote-submit';
  var DEFAULT_TIMEOUT_MS = 12000;
  var MIN_COMPLETION_MS = 3000;
  var memoryStorage = {};

  function safeStorage() {
    try {
      if (root.sessionStorage) {
        var probe = 'pra_quote_storage_probe';
        root.sessionStorage.setItem(probe, '1');
        root.sessionStorage.removeItem(probe);
        return root.sessionStorage;
      }
    } catch (error) {
      logDiagnostic('session_storage_unavailable', error);
    }
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null; },
      setItem: function (key, value) { memoryStorage[key] = String(value); },
      removeItem: function (key) { delete memoryStorage[key]; }
    };
  }

  function randomId(cryptoApi) {
    var api = cryptoApi || root.crypto;
    if (api && typeof api.randomUUID === 'function') return api.randomUUID();
    if (api && typeof api.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      api.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    return 'fallback-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizePhone(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
    return digits.length >= 10 && digits.length <= 15 ? '+' + digits : raw;
  }

  function contactFields(fields) {
    var clean = Object.assign({}, fields || {});
    var fullName = normalizeName(clean.full_name || clean.contact_name || [clean.firstName, clean.lastName].filter(Boolean).join(' '));
    var parts = fullName.split(' ').filter(Boolean);
    if (fullName) {
      clean.full_name = fullName;
      clean.contact_name = normalizeName(clean.contact_name || fullName);
      clean.first_name = normalizeName(clean.first_name || parts[0]);
      clean.last_name = normalizeName(clean.last_name || parts.slice(1).join(' '));
    }
    if (clean.email !== undefined) clean.email = normalizeEmail(clean.email);
    if (clean.phone !== undefined) clean.phone = normalizePhone(clean.phone);
    if (clean.contact_email !== undefined) clean.contact_email = normalizeEmail(clean.contact_email || clean.email);
    if (clean.contact_phone !== undefined) clean.contact_phone = normalizePhone(clean.contact_phone || clean.phone);
    delete clean.website;
    return clean;
  }

  function validateContact(fields, state) {
    var name = normalizeName(fields.full_name || fields.contact_name || [fields.firstName, fields.lastName].filter(Boolean).join(' '));
    var email = normalizeEmail(fields.email || fields.contact_email);
    var phone = normalizePhone(fields.phone || fields.contact_phone);
    if (name.length < 2) throw submissionError('validation', 'Please enter your full name.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw submissionError('validation', 'Please enter a valid email address.');
    if (phone && phone.replace(/\D/g, '').length < 10) throw submissionError('validation', 'Please enter a valid phone number.');
    if (state === 'complete' && !email) throw submissionError('validation', 'Please enter your email address.');
    if (state === 'partial' && !email && !phone) throw submissionError('validation', 'A phone number or email address is required.');
  }

  function submissionError(code, message, status) {
    var error = new Error(message || 'Submission failed.');
    error.code = code;
    if (status) error.status = status;
    return error;
  }

  function safeJson(response) {
    return response.text().then(function (text) {
      if (!text) throw submissionError('malformed_response', 'The submission service returned an invalid response.', response.status);
      try { return JSON.parse(text); }
      catch (error) { throw submissionError('malformed_response', 'The submission service returned an invalid response.', response.status); }
    });
  }

  function postJson(url, body, options) {
    options = options || {};
    var fetchFn = options.fetchFn || root.fetch;
    if (typeof fetchFn !== 'function') return Promise.reject(submissionError('network', 'The submission service is unavailable.'));
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
      credentials: 'omit'
    }).then(function (response) {
      return safeJson(response).then(function (payload) {
        if (!response.ok) throw submissionError(payload.code || 'http_error', payload.message || 'The submission service rejected the request.', response.status);
        if (!payload || payload.ok !== true || payload.submission_id !== body.submission_id || payload.submission_state !== body.submission_state) {
          throw submissionError('malformed_response', 'The submission service returned an invalid response.', response.status);
        }
        return payload;
      });
    }).catch(function (error) {
      if (error && error.name === 'AbortError') throw submissionError('timeout', 'The submission service timed out.');
      if (error && error.code) throw error;
      throw submissionError('network', 'We could not reach the submission service.');
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function createSession(options) {
    options = options || {};
    var formKey = String(options.formKey || 'quote').replace(/[^a-z0-9_-]/gi, '_');
    var lineOfBusiness = String(options.lineOfBusiness || 'commercial');
    var storage = options.storage || safeStorage();
    var prefix = 'pra_quote:' + formKey + ':';
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var id = storage.getItem(prefix + 'submission_id');
    if (!id) {
      id = randomId(options.cryptoApi);
      storage.setItem(prefix + 'submission_id', id);
    }
    var startedAt = Number(storage.getItem(prefix + 'started_at_ms'));
    if (!startedAt || !isFinite(startedAt)) {
      startedAt = now();
      storage.setItem(prefix + 'started_at_ms', String(startedAt));
    }
    var partialInFlight = null;
    var completeInFlight = null;

    function submit(state, fields, honeypot) {
      if (state !== 'partial' && state !== 'complete') return Promise.reject(submissionError('validation', 'Invalid submission state.'));
      if (String(honeypot || '').trim()) return Promise.reject(submissionError('spam', 'We could not submit this request.'));
      var elapsed = now() - startedAt;
      if (state === 'complete' && elapsed < (options.minCompletionMs || MIN_COMPLETION_MS)) {
        return Promise.reject(submissionError('too_fast', 'Please take a moment to review the form before submitting.'));
      }
      var normalized = contactFields(fields);
      try { validateContact(normalized, state); }
      catch (error) { return Promise.reject(error); }

      if (state === 'partial') {
        if (storage.getItem(prefix + 'partial_sent') === 'true') return Promise.resolve({ ok: true, duplicate: true, submission_id: id, submission_state: state });
        var attempts = Number(storage.getItem(prefix + 'partial_attempts') || 0);
        if (attempts >= 2) return Promise.resolve({ ok: false, skipped: true, submission_id: id, submission_state: state });
        if (partialInFlight) return partialInFlight.then(function (result) { return Object.assign({}, result, { duplicate: true }); });
        storage.setItem(prefix + 'partial_attempts', String(attempts + 1));
      } else {
        if (storage.getItem(prefix + 'complete_sent') === 'true') return Promise.resolve({ ok: true, duplicate: true, submission_id: id, submission_state: state });
        if (completeInFlight) return completeInFlight.then(function (result) { return Object.assign({}, result, { duplicate: true }); });
      }

      var request = {
        line_of_business: lineOfBusiness,
        submission_id: id,
        submission_state: state,
        form_started_at_ms: startedAt,
        honeypot: String(honeypot || ''),
        fields: normalized
      };
      var promise = postJson(options.endpoint || DEFAULT_ENDPOINT, request, options).then(function (result) {
        if (state === 'partial') storage.setItem(prefix + 'partial_sent', 'true');
        else storage.setItem(prefix + 'complete_sent', 'true');
        return Object.assign({}, result, { duplicate: false });
      });
      if (state === 'partial') {
        partialInFlight = promise.finally(function () { partialInFlight = null; });
        return partialInFlight;
      }
      completeInFlight = promise.finally(function () { completeInFlight = null; });
      return completeInFlight;
    }

    return {
      submissionId: id,
      startedAt: startedAt,
      submitPartial: function (fields, honeypot) { return submit('partial', fields, honeypot); },
      submitComplete: function (fields, honeypot) { return submit('complete', fields, honeypot); }
    };
  }

  function formToObject(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof File !== 'undefined' && value instanceof File) return;
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (!Array.isArray(data[key])) data[key] = [data[key]];
        data[key].push(value);
      } else data[key] = value;
    });
    return data;
  }

  function failureMessage(error) {
    if (error && (error.code === 'validation' || error.code === 'too_fast')) return error.message;
    return 'We could not deliver your quote request. Your information is still here, so please try again.';
  }

  function showFailure(form, error) {
    if (!form || !root.document) return;
    var box = form.querySelector('.quote-submit-error');
    if (!box) {
      box = root.document.createElement('div');
      box.className = 'quote-submit-error';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:16px 0;padding:14px 16px;border:1px solid #b42318;border-radius:6px;background:#fff4f2;color:#7a271a;font-size:14px;line-height:1.55;';
      var button = form.querySelector('[type="submit"]');
      if (button && button.parentNode) button.parentNode.insertBefore(box, button);
      else form.appendChild(box);
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    var message = root.document.createElement('span');
    message.textContent = failureMessage(error) + ' You can also call ';
    box.appendChild(message);
    var phone = root.document.createElement('a');
    phone.href = 'tel:+17707583197'; phone.textContent = '(770) 758-3197';
    box.appendChild(phone);
    box.appendChild(root.document.createTextNode(' or email '));
    var email = root.document.createElement('a');
    email.href = 'mailto:dbrown@pinnacleriskad.com'; email.textContent = 'dbrown@pinnacleriskad.com';
    box.appendChild(email);
    box.appendChild(root.document.createTextNode('.'));
  }

  function clearFailure(form) {
    if (!form) return;
    var box = form.querySelector('.quote-submit-error');
    if (box) box.remove();
  }

  function logDiagnostic(context, error) {
    if (!root.console || typeof root.console.warn !== 'function') return;
    root.console.warn('[quote] ' + context, {
      code: error && error.code ? error.code : 'unknown',
      status: error && error.status ? error.status : undefined,
      message: error && error.message ? error.message : 'Unknown error'
    });
  }

  function notifySecondary(send, timeoutMs) {
    if (typeof send !== 'function') return Promise.resolve(false);
    var timer;
    var notification = Promise.resolve().then(send).then(function () {
      return { ok: true };
    }).catch(function (error) {
      return { ok: false, error: error };
    });
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve({ ok: false, timeout: true }); }, timeoutMs || 5000);
    });
    return Promise.race([notification, timeout]).then(function (result) {
      clearTimeout(timer);
      if (result.ok) return true;
      logDiagnostic(result.timeout ? 'secondary_notification_timeout' : 'secondary_notification_failed', result.error);
      return false;
    });
  }

  return {
    createSession: createSession,
    formToObject: formToObject,
    normalizeName: normalizeName,
    normalizePhone: normalizePhone,
    normalizeEmail: normalizeEmail,
    notifySecondary: notifySecondary,
    showFailure: showFailure,
    clearFailure: clearFailure,
    logDiagnostic: logDiagnostic,
    _test: { randomId: randomId, postJson: postJson, contactFields: contactFields, validateContact: validateContact }
  };
});
