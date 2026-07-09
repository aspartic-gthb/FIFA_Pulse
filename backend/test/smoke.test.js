'use strict';

/* Smoke tests — no framework, just node:test + node:http against the real app.
   Verifies the contract the frontend depends on and the data-integrity rules. */

const { test, after, before } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the app at a disposable copy of the seed so tests never touch the
// committed db.json. Must be set before requiring the server.
const tmpDb = path.join(os.tmpdir(), `fifa-pulse-test-${process.pid}.json`);
fs.copyFileSync(path.join(__dirname, '..', 'data', 'db.json'), tmpDb);
process.env.DB_FILE = tmpDb;

const app = require('../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  try { fs.unlinkSync(tmpDb); } catch { /* already gone */ }
});

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      base + path,
      { method, headers: data ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* html/text */ }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('GET /api/matches returns 5 fixtures with the expected shape', async () => {
  const { status, json } = await req('GET', '/api/matches');
  assert.equal(status, 200);
  assert.equal(json.length, 5);
  for (const m of json) {
    for (const k of ['id', 'teamA', 'teamB', 'date', 'venue', 'stage']) {
      assert.ok(k in m, `missing ${k}`);
    }
  }
});

test('GET /api/results returns per-match counts', async () => {
  const { status, json } = await req('GET', '/api/results');
  assert.equal(status, 200);
  assert.equal(json.length, 5);
  assert.ok('teamA_votes' in json[0] && 'teamB_votes' in json[0]);
});

test('POST /api/vote increments and echoes updated counts', async () => {
  const before = (await req('GET', '/api/results')).json.find((r) => r.matchId === 'm1');
  const { status, json } = await req('POST', '/api/vote', { matchId: 'm1', team: 'teamA' });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.updatedCounts.teamA_votes, before.teamA_votes + 1);
});

test('POST /api/vote rejects unknown matchId with 400', async () => {
  const { status, json } = await req('POST', '/api/vote', { matchId: 'nope', team: 'teamA' });
  assert.equal(status, 400);
  assert.ok(json.error);
});

test('POST /api/vote rejects invalid team with 400', async () => {
  const { status, json } = await req('POST', '/api/vote', { matchId: 'm1', team: 'teamZ' });
  assert.equal(status, 400);
  assert.ok(json.error);
});

test('GET /api/stats exposes the dashboard fields', async () => {
  const { status, json } = await req('GET', '/api/stats');
  assert.equal(status, 200);
  for (const k of ['totalVotes', 'mostVotedTeam', 'totalVisitors', 'requestCount', 'uptimeSeconds', 'lastUpdated']) {
    assert.ok(k in json, `missing ${k}`);
  }
  assert.ok(json.totalVotes >= 1);
});

test('GET /api/metrics exposes the ops fields', async () => {
  const { status, json } = await req('GET', '/api/metrics');
  assert.equal(status, 200);
  for (const k of ['avgRequestsPerMin', 'errorCount', 'peakTrafficWindow', 'avgResponseTimeMs']) {
    assert.ok(k in json, `missing ${k}`);
  }
});

test('unknown API route returns JSON 404', async () => {
  const { status, json } = await req('GET', '/api/does-not-exist');
  assert.equal(status, 404);
  assert.ok(json.error);
});

test('unknown page returns the branded HTML 404', async () => {
  const { status, raw } = await req('GET', '/totally-missing');
  assert.equal(status, 404);
  assert.match(raw, /404/);
});
