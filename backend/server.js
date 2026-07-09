'use strict';

/**
 * FIFA Pulse — single Express service.
 *
 * Responsibilities:
 *   - serve the static frontend (public/)
 *   - expose the voting + analytics API (see TRD §3)
 *   - track ops telemetry (requests, visitors, uptime, errors) in one JSON file
 *
 * Storage is a single JSON file (data/db.json). This is a deliberate scope
 * choice for a free-tier demo — see README "Known limitations". All writes go
 * through a serial queue so concurrent votes can't corrupt the file.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend');
const ANALYTICS_DIR = path.join(__dirname, '..', 'analytics', 'public');
// Datastore path is overridable (DB_FILE) so tests run against a throwaway
// copy and never dirty the committed seed.
const DB_PATH = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(__dirname, 'data', 'db.json');
const REQUEST_LOG_CAP = 500;
const VISITOR_COOKIE = 'fifa_pulse_visitor';

// Process boot time — uptime is derived from this at read time, never stored
// as a duration (durations go stale). See Backend-Schema §3.
const BOOT_TIME = Date.now();

// ---------------------------------------------------------------------------
// Datastore: load once into memory, persist through a serial write queue.
// ---------------------------------------------------------------------------

let db = loadDb();

function loadDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  // Reset process-scoped fields so uptime/telemetry reflect *this* run.
  parsed.meta.startedAt = new Date(BOOT_TIME).toISOString();
  parsed.requestLog = [];
  return parsed;
}

let writeChain = Promise.resolve();
/** Serialize writes so overlapping votes never interleave file writes. */
function persist() {
  writeChain = writeChain
    .then(() => fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2)))
    .catch((err) => console.error('[persist] write failed:', err.message));
  return writeChain;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cookieParser());
app.use(express.json());

// CORS middleware: allow requests from other origins (such as analytics-service on port 4000)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Telemetry: count every request, record timing in a bounded ring buffer.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  db.meta.requestCount += 1;

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    db.requestLog.push({
      timestamp: new Date().toISOString(),
      route: req.path,
      status: res.statusCode,
      responseTimeMs: Math.round(ms * 100) / 100,
    });
    if (db.requestLog.length > REQUEST_LOG_CAP) {
      db.requestLog.splice(0, db.requestLog.length - REQUEST_LOG_CAP);
    }
  });
  next();
});

// Visitor tracking: first hit without our cookie counts as a unique visitor.
// Cookie holds a random UUID only — no personal data (TRD §4).
app.use((req, res, next) => {
  if (!req.cookies[VISITOR_COOKIE]) {
    db.meta.totalVisitors += 1;
    res.cookie(VISITOR_COOKIE, crypto.randomUUID(), {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      sameSite: 'lax',
    });
    persist();
  }
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalVotes() {
  return db.matches.reduce((sum, m) => sum + m.votes.teamA + m.votes.teamB, 0);
}

/** Most-voted team name across all matches (ignores unresolved TBD slots). */
function mostVotedTeam() {
  const tally = new Map();
  for (const m of db.matches) {
    if (!/^TBD/i.test(m.teamA)) {
      tally.set(m.teamA, (tally.get(m.teamA) || 0) + m.votes.teamA);
    }
    if (!/^TBD/i.test(m.teamB)) {
      tally.set(m.teamB, (tally.get(m.teamB) || 0) + m.votes.teamB);
    }
  }
  let best = null;
  let bestCount = -1;
  for (const [team, count] of tally) {
    if (count > bestCount) {
      best = team;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

function buildStats() {
  return {
    totalVotes: totalVotes(),
    mostVotedTeam: mostVotedTeam(),
    totalVisitors: db.meta.totalVisitors,
    requestCount: db.meta.requestCount,
    uptimeSeconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
    lastUpdated: db.meta.lastUpdated,
  };
}

function buildMetrics() {
  const log = db.requestLog;
  const errorCount = db.meta.errorCount;

  // Average response time over the sampled window.
  const avgResponseTimeMs = log.length
    ? Math.round((log.reduce((s, e) => s + e.responseTimeMs, 0) / log.length) * 100) / 100
    : 0;

  // Requests/min over the window the ring buffer actually spans.
  let avgRequestsPerMin = 0;
  if (log.length > 1) {
    const first = new Date(log[0].timestamp).getTime();
    const last = new Date(log[log.length - 1].timestamp).getTime();
    const minutes = Math.max((last - first) / 60000, 1 / 60);
    avgRequestsPerMin = Math.round(log.length / minutes);
  }

  // Peak traffic window: busiest clock-hour bucket in the sample.
  const hourBuckets = new Map();
  for (const e of log) {
    const h = new Date(e.timestamp).getUTCHours();
    hourBuckets.set(h, (hourBuckets.get(h) || 0) + 1);
  }
  let peakHour = null;
  let peakCount = -1;
  for (const [h, c] of hourBuckets) {
    if (c > peakCount) {
      peakHour = h;
      peakCount = c;
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  const peakTrafficWindow =
    peakHour === null ? null : `${pad(peakHour)}:00–${pad((peakHour + 1) % 24)}:00 UTC`;

  return { avgRequestsPerMin, errorCount, peakTrafficWindow, avgResponseTimeMs };
}

// Small wrapper so a thrown handler bumps errorCount and returns clean JSON
// (never a raw stack trace to the client — TRD §4).
function api(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      db.meta.errorCount += 1;
      console.error(`[api] ${req.method} ${req.path}:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// SSE — push stats to the analytics dashboard without polling (bonus).
// ---------------------------------------------------------------------------

const sseClients = new Set();

function broadcastStats() {
  const payload = `data: ${JSON.stringify(buildStats())}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get('/api/matches', api((req, res) => {
  res.json(
    db.matches.map(({ id, teamA, teamB, date, venue, stage }) => ({
      id, teamA, teamB, date, venue, stage,
    })),
  );
}));

app.get('/api/results', api((req, res) => {
  res.json(
    db.matches.map((m) => ({
      matchId: m.id,
      teamA_votes: m.votes.teamA,
      teamB_votes: m.votes.teamB,
    })),
  );
}));

app.post('/api/vote', api(async (req, res) => {
  const { matchId, team } = req.body || {};
  const match = db.matches.find((m) => m.id === matchId);

  if (!match) {
    db.meta.errorCount += 1;
    return res.status(400).json({ error: 'Unknown matchId' });
  }
  if (team !== 'teamA' && team !== 'teamB') {
    db.meta.errorCount += 1;
    return res.status(400).json({ error: "team must be 'teamA' or 'teamB'" });
  }

  match.votes[team] += 1;
  db.meta.lastUpdated = new Date().toISOString();
  await persist();
  broadcastStats();

  res.json({
    success: true,
    updatedCounts: {
      matchId: match.id,
      teamA_votes: match.votes.teamA,
      teamB_votes: match.votes.teamB,
    },
  });
}));

app.get('/api/stats', api((req, res) => {
  res.json(buildStats());
}));

app.get('/api/metrics', api((req, res) => {
  res.json(buildMetrics());
}));

app.get('/api/stats/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify(buildStats())}\n\n`);
  sseClients.add(res);

  // Heartbeat keeps the connection alive through proxies and refreshes the
  // uptime counter even when no votes are coming in.
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify(buildStats())}\n\n`);
  }, 10000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Static frontend + explicit routes
// ---------------------------------------------------------------------------

app.use('/analytics', express.static(ANALYTICS_DIR, { extensions: ['html'] }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// 404 — JSON for the API, branded page for everything else.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FIFA Pulse running on http://localhost:${PORT}`);
  });
}

module.exports = app;
