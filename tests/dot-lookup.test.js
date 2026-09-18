const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const landingSource = fs.readFileSync(require.resolve('../trucking-landing.js'), 'utf8');
const quotePage = fs.readFileSync(require.resolve('../trucking-quote.html'), 'utf8');
const quoteLookup = quotePage.slice(quotePage.indexOf('async function lookupDOT()'), quotePage.indexOf('function onVinInput('));
const flush = () => new Promise(resolve => setImmediate(resolve));
const payload = { content: { carrier: { legalName: 'Example Transport LLC', totalPowerUnits: 2 } } };
const reply = (body = payload, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });

function node(value = '') {
  return {
    value, textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {},
    handlers: {}, classes: new Set(), focused: false,
    focus() { this.focused = true; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    get classList() { return { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
  };
}

function fixture(kind, fetchFn, { abort = true, businessName = '', step = 0 } = {}) {
  const timers = new Map(); let serial = 0; const requests = []; const moves = [];
  const dot = node('1234567'); const business = node(businessName); const units = node();
  const button = node(); button.textContent = 'Look Up My DOT';
  const error = node(); const result = node(); const skip = node(); const manual = node(); manual.hidden = true;
  const byId = {
    'usdot-input': dot, 'dot-lookup-btn': button, 'dot-error': error, 'dot-result': result,
    'dot-result-grid': node(), 'dot-filled-note': node(), 'dot-manual-note': manual, 'dot-confirm': node()
  };
  const fields = {
    '[name="usdot"]': dot, '[name="business_name"]': business, '[name="power_unit_count"]': units,
    'input[name="business_name"]': business, 'select[name="power_unit_count"]': units,
    '[data-dot-lookup]': button, '[data-dot-result]': result, '[data-dot-error]': error, '[data-no-dot]': skip,
    '[type="submit"]': node()
  };
  const form = { querySelector: key => fields[key] || null, getAttribute: () => '', parentElement: { querySelector: () => null }, addEventListener() {} };
  const context = {
    URLSearchParams, ...(abort ? { AbortController } : {}), wizIdx: step,
    console: { error() {} },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { requests.push({ url, options }); return fetchFn(url, options); },
    document: {
      readyState: 'complete', getElementById: id => byId[id] || null,
      querySelector: key => fields[key] || null,
      querySelectorAll: key => key === '.pra-landing-form' ? [form] : []
    },
    PinnacleQuote: { createSession: () => ({}) },
    dotState(state) { context.state = state; }, focusHeroDot() {},
    wizGo(i) { context.wizIdx = i; moves.push(i); }
  };
  vm.runInNewContext(kind === 'landing' ? landingSource : quoteLookup, context);
  return {
    context, dot, business, units, button, error, result, skip, manual, timers, requests, moves,
    start() { return kind === 'landing' ? button.handlers.click() : context.lookupDOT(); },
    expire() { const entry = [...timers.values()][0]; assert.equal(entry.ms, 6000); entry.fn(); }
  };
}

for (const kind of ['landing', 'quote']) {
  test(`${kind}: successful lookup fills carrier name/units and clears timeout`, async () => {
    const f = fixture(kind, async () => reply());
    await f.start(); await flush();
    assert.equal(f.business.value, 'Example Transport LLC');
    assert.equal(f.units.value, '2'); assert.equal(f.dot.value, '1234567');
    assert.equal(f.button.disabled, false); assert.equal(f.timers.size, 0);
    assert.equal(f.error.textContent, '');
  });

  test(`${kind}: lookup respects visitor-entered business name`, async () => {
    const f = fixture(kind, async () => reply(), { businessName: 'My entered name' });
    await f.start(); await flush(); assert.equal(f.business.value, 'My entered name');
  });

  for (const [label, fetchFn] of [
    ['missing configuration', async () => reply({ found: false, error: 'Server not configured' }, false)],
    ['not found', async () => reply({ content: { carrier: null } })],
    ['network failure', async () => { throw new Error('offline'); }],
    ['malformed JSON', async () => ({ ok: true, json: async () => { throw new Error('bad json'); }, text: async () => '<html>' })]
  ]) {
    test(`${kind}: ${label} preserves DOT and opens manual entry`, async () => {
      const f = fixture(kind, fetchFn);
      await f.start(); await flush();
      assert.equal(f.dot.value, '1234567'); assert.equal(f.business.focused, true);
      assert.equal(f.button.disabled, false); assert.equal(f.timers.size, 0);
      assert.match(f.error.textContent, /business name/);
      if (kind === 'quote') { assert.deepEqual(f.moves, [1]); assert.equal(f.manual.hidden, false); }
    });
  }

  for (const abort of [true, false]) {
    test(`${kind}: deadline works ${abort ? 'with' : 'without'} AbortController and ignores late success`, async () => {
      let resolveFetch;
      const f = fixture(kind, () => new Promise(resolve => { resolveFetch = resolve; }), { abort });
      const pending = f.start(); await flush(); f.expire(); await pending; await flush();
      assert.equal(f.button.disabled, false); assert.equal(f.business.focused, true);
      assert.equal(f.dot.value, '1234567'); assert.equal(f.timers.size, 0);
      if (abort) assert.equal(f.requests[0].options.signal.aborted, true);
      f.business.value = 'Manually entered after timeout';
      resolveFetch(reply()); await flush();
      assert.equal(f.business.value, 'Manually entered after timeout'); assert.equal(f.units.value, '');
    });
  }

  test(`${kind}: timeout covers a stalled response body`, async () => {
    const f = fixture(kind, async () => ({ ok: true, json: () => new Promise(() => {}), text: () => new Promise(() => {}) }));
    const pending = f.start(); await flush(); f.expire(); await pending; await flush();
    assert.equal(f.button.disabled, false); assert.equal(f.business.focused, true);
  });
}

test('quote: late failure does not navigate away from a later wizard step', async () => {
  const f = fixture('quote', async () => reply({}, false), { step: 3 });
  await f.start(); assert.deepEqual(f.moves, []); assert.equal(f.business.focused, false);
});

test('quote: failed lookup restores an emptied payload mirror and confirms the retained DOT', async () => {
  let rejectFetch;
  const f = fixture('quote', () => new Promise((_, reject) => { rejectFetch = reject; }));
  const pending = f.start();
  f.dot.value = '';
  rejectFetch(new Error('offline'));
  await pending;
  assert.equal(f.dot.value, '1234567');
  assert.match(f.manual.textContent, /USDOT number \(1234567\) is saved/);
  assert.deepEqual(f.moves, [1]);
});

test('quote: fallback retains a newer DOT already present in the payload mirror', async () => {
  let rejectFetch;
  const f = fixture('quote', () => new Promise((_, reject) => { rejectFetch = reject; }));
  const pending = f.start();
  f.dot.value = '7654321';
  rejectFetch(new Error('offline'));
  await pending;
  assert.equal(f.dot.value, '7654321');
  assert.match(f.manual.textContent, /USDOT number \(7654321\) is saved/);
});

test('landing: explicit no-DOT path works without requesting a lookup', () => {
  const f = fixture('landing', () => { throw new Error('must not fetch'); });
  f.skip.handlers.click(); assert.equal(f.dot.value, ''); assert.equal(f.business.focused, true);
  assert.equal(f.requests.length, 0);
});
