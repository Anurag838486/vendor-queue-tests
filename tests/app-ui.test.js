/**
 * @jest-environment jsdom
 *
 * Frontend tests for app.js. app.js is a plain script (not a module) that
 * wires itself up to the DOM as soon as it's loaded and immediately calls
 * init(), which fetches vendors/requests. To test it in isolation we:
 *   1. Build a minimal HTML fixture with the element ids app.js expects.
 *   2. Stub global.fetch with an in-memory fake of the API.
 *   3. Evaluate the real app.js source into the jsdom global scope so its
 *      top-level functions (vendorOptionsHtml, cardHtml, onTransition, ...)
 *      become callable globals for the test to exercise directly.
 *
 * Each test asserts the SPEC-CORRECT behavior, so it currently FAILS
 * against the bugs left in app.js — that failure is the proof of the bug.
 */

const fs = require('fs');
const path = require('path');

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const VENDORS = [
  { id: 'v1', name: 'Swift Verify Co', active: true },
  { id: 'v2', name: 'ClearCheck Partners', active: true },
  { id: 'v3', name: 'Old Ledger Associates', active: false }
];

const REQUESTS = [
  { id: 1, checkType: 'IDENTITY', candidateName: 'Ananya Iyer', state: 'REQUESTED', vendorId: null },
  { id: 2, checkType: 'EDUCATION', candidateName: 'Dev Kapoor', state: 'ASSIGNED', vendorId: 'v1' },
  { id: 3, checkType: 'EMPLOYMENT', candidateName: 'Neha Joshi', state: 'IN_PROGRESS', vendorId: 'v2' },
  { id: 4, checkType: 'ADDRESS', candidateName: 'Farhan Ali', state: 'COMPLETED', vendorId: 'v1' },
  { id: 5, checkType: 'IDENTITY', candidateName: 'Ritika Malhotra', state: 'ASSIGNED', vendorId: 'v2' }
];

function byState(state) {
  return REQUESTS.filter((r) => r.state === state);
}

/** Sets up the DOM fixture, stubs fetch, loads app.js fresh, and waits
 * for its async init() to finish loading vendors + the board. */
async function loadApp({ fetchImpl } = {}) {
  document.body.innerHTML = `
    <form id="new-request-form">
      <select id="new-checkType"><option>IDENTITY</option></select>
      <input id="new-candidateName" />
      <button type="submit">Create</button>
    </form>
    <button id="reset-data-btn">Reset</button>
    <div id="toast" class="hidden"></div>
    <div id="board"></div>
  `;

  global.fetch = fetchImpl || jest.fn((url) => {
    if (url === '/api/vendors') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(VENDORS) });
    }
    if (url === '/api/requests/summary') {
      const summary = { REQUESTED: 0, ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0 };
      REQUESTS.forEach((r) => { summary[r.state] += 1; });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summary) });
    }
    const stateMatch = /\/api\/requests\?state=(\w+)/.exec(url);
    if (stateMatch) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(byState(stateMatch[1])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  // Evaluate the real, unmodified app.js source in this test's global
  // scope so its top-level `function` declarations become callable here.
  // eslint-disable-next-line no-eval
  (0, eval)(APP_JS_SOURCE);

  // init() (called at the bottom of app.js) kicks off async fetches;
  // flush microtasks so loadVendors()/loadBoard() finish before we assert.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('vendorOptionsHtml() — dropdown contents', () => {
  test('excludes inactive vendors from the options list', async () => {
    await loadApp();
    const html = vendorOptionsHtml(null); // eslint-disable-line no-undef
    expect(html).not.toContain('Old Ledger Associates');
  });

  test('marks the option matching currentVendorId as selected', async () => {
    await loadApp();
    const html = vendorOptionsHtml('v1'); // eslint-disable-line no-undef
    expect(html).toMatch(/<option value="v1"[^>]*selected[^>]*>/);
  });
});

describe('cardHtml() — per-card rendering rules', () => {
  test('disables the vendor-select once the request is COMPLETED', async () => {
    await loadApp();
    const completedRequest = { id: 4, checkType: 'ADDRESS', candidateName: 'Farhan Ali', state: 'COMPLETED', vendorId: 'v1' };
    const html = cardHtml(completedRequest); // eslint-disable-line no-undef

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const select = wrapper.querySelector('.vendor-select');
    expect(select.hasAttribute('disabled')).toBe(true);
  });

  test('only the single valid next-state button is enabled, not every future state', async () => {
    await loadApp();
    const requestedItem = { id: 1, checkType: 'IDENTITY', candidateName: 'Ananya Iyer', state: 'REQUESTED', vendorId: null };
    const html = cardHtml(requestedItem); // eslint-disable-line no-undef

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const buttons = Array.from(wrapper.querySelectorAll('.state-btn'));

    const enabledTargets = buttons.filter((b) => !b.disabled).map((b) => b.dataset.to);
    expect(enabledTargets).toEqual(['ASSIGNED']);
  });

  test('the vendor-select pre-selects the request\'s actual assigned vendor', async () => {
    await loadApp();
    const assignedItem = { id: 2, checkType: 'EDUCATION', candidateName: 'Dev Kapoor', state: 'ASSIGNED', vendorId: 'v1' };
    const html = cardHtml(assignedItem); // eslint-disable-line no-undef

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const select = wrapper.querySelector('.vendor-select');
    expect(select.value).toBe('v1');
  });
});

describe('onTransition() — feedback + refresh behavior', () => {
  test('shows a failure toast (not a success toast) when the API rejects the transition', async () => {
    await loadApp({
      fetchImpl: jest.fn((url, opts) => {
        if (opts && opts.method === 'PATCH' && url.includes('/transition')) {
          return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Cannot transition' }) });
        }
        if (url === '/api/vendors') return Promise.resolve({ ok: true, json: () => Promise.resolve(VENDORS) });
        if (url === '/api/requests/summary') return Promise.resolve({ ok: true, json: () => Promise.resolve({ REQUESTED: 5, ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0 }) });
        const stateMatch = /\/api\/requests\?state=(\w+)/.exec(url);
        if (stateMatch) return Promise.resolve({ ok: true, json: () => Promise.resolve(byState(stateMatch[1])) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      })
    });

    const fakeButton = { dataset: { id: '1', to: 'COMPLETED' } };
    await onTransition(fakeButton); // eslint-disable-line no-undef

    const toast = document.getElementById('toast');
    expect(toast.textContent.toLowerCase()).not.toContain('moved to');
  });

  test('reloads the board after a successful transition so the count of board-loading fetches increases', async () => {
    const fetchSpy = jest.fn((url, opts) => {
      if (opts && opts.method === 'PATCH' && url.includes('/transition')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, state: 'ASSIGNED' }) });
      }
      if (url === '/api/vendors') return Promise.resolve({ ok: true, json: () => Promise.resolve(VENDORS) });
      if (url === '/api/requests/summary') return Promise.resolve({ ok: true, json: () => Promise.resolve({ REQUESTED: 0, ASSIGNED: 5, IN_PROGRESS: 0, COMPLETED: 0 }) });
      const stateMatch = /\/api\/requests\?state=(\w+)/.exec(url);
      if (stateMatch) return Promise.resolve({ ok: true, json: () => Promise.resolve(byState(stateMatch[1])) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await loadApp({ fetchImpl: fetchSpy });
    const callsBeforeTransition = fetchSpy.mock.calls.length;

    const fakeButton = { dataset: { id: '1', to: 'ASSIGNED' } };
    await onTransition(fakeButton); // eslint-disable-line no-undef
    await Promise.resolve();
    await Promise.resolve();

    // A successful transition should trigger loadBoard(), which issues a
    // fresh summary fetch + one fetch per state (5 more calls minimum).
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBeforeTransition + 1);
  });
});

describe('onAssign() — feedback on failure', () => {
  test('shows a failure toast (not a success toast) when the API rejects the assignment', async () => {
    await loadApp({
      fetchImpl: jest.fn((url, opts) => {
        if (opts && opts.method === 'PATCH' && url.includes('/assign')) {
          return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Unknown vendor' }) });
        }
        if (url === '/api/vendors') return Promise.resolve({ ok: true, json: () => Promise.resolve(VENDORS) });
        if (url === '/api/requests/summary') return Promise.resolve({ ok: true, json: () => Promise.resolve({ REQUESTED: 5, ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0 }) });
        const stateMatch = /\/api\/requests\?state=(\w+)/.exec(url);
        if (stateMatch) return Promise.resolve({ ok: true, json: () => Promise.resolve(byState(stateMatch[1])) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      })
    });

    const fakeSelect = { dataset: { id: '1' }, value: 'v3' };
    await onAssign(fakeSelect); // eslint-disable-line no-undef

    const toast = document.getElementById('toast');
    expect(toast.textContent.toLowerCase()).not.toContain('vendor assigned');
  });
});
