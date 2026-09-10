/**
 * API-level tests for the Vendor Request Queue.
 *
 * Each test below targets one specific bug found during manual QA
 * (see /BUG_REPORT.md for the original write-ups). Every test asserts
 * the SPEC-CORRECT behavior, so each one currently FAILS against the
 * live app.js/server.js in this repo — that failure is the proof the
 * bug exists. Fixing the underlying bug should make the corresponding
 * test pass with no changes to the test itself.
 */

const request = require('supertest');

// server.js calls app.listen() as a side effect of being required, and
// does not export the app/server. We spin it up once on a fixed test
// port and issue plain HTTP requests against it with supertest's
// agent() so cookies (session isolation) persist across calls within
// a test, matching how a real browser session behaves.
process.env.PORT = process.env.PORT || '4123';
require('../server.js');

const BASE_URL = `http://localhost:${process.env.PORT}`;

/** Returns a supertest agent with its own persistent session cookie,
 * then resets that session's data to the known seed state. */
async function freshAgent() {
  const agent = request.agent(BASE_URL);
  // Trigger session creation cookie by hitting any route first.
  await agent.get('/api/vendors');
  await agent.post('/api/reset');
  return agent;
}

describe('POST /api/requests — creation validation & response shape', () => {
  test('BUG-08-02: rejects an invalid checkType with 400', async () => {
    const agent = await freshAgent();
    const res = await agent
      .post('/api/requests')
      .send({ checkType: 'NOT_REAL', candidateName: 'Test' });
    expect(res.status).toBe(400);
  });

  test('BUG-08-04: rejects a blank/whitespace-only candidateName with 400', async () => {
    const agent = await freshAgent();
    const res = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: '   ' });
    expect(res.status).toBe(400);
  });

  test('BUG: trims leading/trailing whitespace from candidateName instead of storing it as-is', async () => {
    const agent = await freshAgent();
    const res = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: '  Ana  ' });
    expect(res.status).toBe(201);
    expect(res.body.candidateName).toBe('Ana');
  });

  test('BUG-08-03: a successful creation returns 201 Created, not 200 OK', async () => {
    const agent = await freshAgent();
    const res = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: 'Status Code Test' });
    expect(res.status).toBe(201);
  });

  test('a new request always starts in REQUESTED, even if the client supplies state/id (mass assignment guard)', async () => {
    const agent = await freshAgent();
    const res = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: 'Mass Assign Test', state: 'COMPLETED', id: 9999 });
    expect(res.body.state).toBe('REQUESTED');
    expect(res.body.id).not.toBe(9999);
  });
});

describe('GET /api/requests/summary — aggregate counts', () => {
  test('BUG-08-09: counts per state match the actual number of requests in each state', async () => {
    const agent = await freshAgent();
    const requests = (await agent.get('/api/requests')).body;
    const summary = (await agent.get('/api/requests/summary')).body;

    const expected = { REQUESTED: 0, ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0 };
    requests.forEach((r) => { expected[r.state] += 1; });

    expect(summary).toEqual(expected);
    // Extra explicit check for the exact discrepancy observed manually:
    // seed data has exactly 1 IN_PROGRESS request, but summary reports 5
    // because every non-COMPLETED request is double-counted into IN_PROGRESS.
    expect(summary.IN_PROGRESS).toBe(expected.IN_PROGRESS);
  });
});

describe('GET/PATCH /api/requests/:id — missing-id handling', () => {
  test('GET a non-existent request returns 404, not a thrown error', async () => {
    const agent = await freshAgent();
    const res = await agent.get('/api/requests/999999');
    expect(res.status).toBe(404);
  });

  test('PATCH transition on a non-existent request returns 404, not a bare 500', async () => {
    const agent = await freshAgent();
    const res = await agent
      .patch('/api/requests/999999/transition')
      .send({ to: 'ASSIGNED' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/requests/:id/transition — state machine enforcement', () => {
  test('BUG-08-06 (API side): cannot skip states — REQUESTED cannot jump straight to COMPLETED', async () => {
    const agent = await freshAgent();
    const created = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: 'Skip Test' });
    const id = created.body.id;

    const res = await agent
      .patch(`/api/requests/${id}/transition`)
      .send({ to: 'COMPLETED' });

    expect(res.status).toBe(400);
  });

  test('cannot transition backward (e.g. IN_PROGRESS -> ASSIGNED)', async () => {
    const agent = await freshAgent();
    // Request #3 in seed data starts at IN_PROGRESS.
    const res = await agent
      .patch('/api/requests/3/transition')
      .send({ to: 'ASSIGNED' });

    expect(res.status).toBe(400);
  });

  test('rejects an unknown/invalid "to" state with 400 instead of silently applying it', async () => {
    const agent = await freshAgent();
    const created = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: 'Enum Test' });
    const id = created.body.id;

    const res = await agent
      .patch(`/api/requests/${id}/transition`)
      .send({ to: 'NOT_A_REAL_STATE' });

    expect(res.status).toBe(400);
  });

  test('a valid single-step transition still succeeds (sanity check the guard is not over-broad)', async () => {
    const agent = await freshAgent();
    const created = await agent
      .post('/api/requests')
      .send({ checkType: 'IDENTITY', candidateName: 'Valid Step Test' });
    const id = created.body.id;

    const res = await agent
      .patch(`/api/requests/${id}/transition`)
      .send({ to: 'ASSIGNED' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ASSIGNED');
  });
});

describe('PATCH /api/requests/:id/assign — vendor assignment rules', () => {
  test('BUG-08-07a: rejects assigning an inactive vendor with 400', async () => {
    const agent = await freshAgent();
    // v3 "Old Ledger Associates" is seeded as active: false.
    const res = await agent
      .patch('/api/requests/1/assign')
      .send({ vendorId: 'v3' });

    expect(res.status).toBe(400);
  });

  test('BUG-08-07b: rejects (re-)assigning a vendor once the request is COMPLETED', async () => {
    const agent = await freshAgent();
    // Request #4 in seed data is already COMPLETED.
    const res = await agent
      .patch('/api/requests/4/assign')
      .send({ vendorId: 'v1' });

    expect(res.status).toBe(400);
  });

  test('sending vendorId: null successfully clears the assignment instead of returning "Unknown vendor"', async () => {
    const agent = await freshAgent();
    // Request #2 in seed data starts assigned to v1.
    const res = await agent
      .patch('/api/requests/2/assign')
      .send({ vendorId: null });

    expect(res.status).toBe(200);
    expect(res.body.vendorId).toBeNull();
  });

  test('a valid, active vendor can still be assigned (sanity check the guards are not over-broad)', async () => {
    const agent = await freshAgent();
    const res = await agent
      .patch('/api/requests/1/assign')
      .send({ vendorId: 'v1' });

    expect(res.status).toBe(200);
    expect(res.body.vendorId).toBe('v1');
  });
});

describe('GET /api/vendors — data exposure', () => {
  test('inactive vendors are still returned (documented behavior, not a bug by itself) but each vendor exposes only expected fields', async () => {
    const agent = await freshAgent();
    const res = await agent.get('/api/vendors');
    res.body.forEach((v) => {
      expect(Object.keys(v).sort()).toEqual(['active', 'id', 'name'].sort());
    });
  });
});
