# FIFA Pulse

Anonymous match-prediction voting + a live operations dashboard for the
FIFA World Cup 2026 knockouts. One Node/Express service serves the frontend,
the API, and the analytics page — no separate hosting, no CORS, no login.

- **Predictions** (`/`) — vote on the winner of each fixture. One click, no sign-up. Counts update live.
- **Analytics** (`/analytics`) — real engagement + system-health metrics, pushed live over SSE.



## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 |
| Server | Express |
| Storage | single JSON file (`backend/data/db.json`) |
| Frontend | vanilla HTML/CSS/JS, no build step |
| Realtime | Server-Sent Events (with polling fallback) |
| Hosting | Render (free web service) |
| CI | GitHub Actions (lint + smoke tests) |

## Run locally

```bash
cd backend
npm install
npm start          # http://localhost:3000
```

Then open <http://localhost:3000> to vote and <http://localhost:3000/analytics> for the dashboard.

```bash
npm run lint       # node --check (syntax)
npm test           # API smoke tests (node:test, no extra deps)
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/matches` | fixtures `[{id, teamA, teamB, date, venue, stage}]` |
| GET | `/api/results` | counts `[{matchId, teamA_votes, teamB_votes}]` |
| POST | `/api/vote` | body `{matchId, team}` → `{success, updatedCounts}` |
| GET | `/api/stats` | `{totalVotes, mostVotedTeam, totalVisitors, requestCount, uptimeSeconds, lastUpdated}` |
| GET | `/api/stats/stream` | SSE stream of stats |
| GET | `/api/metrics` | `{avgRequestsPerMin, errorCount, peakTrafficWindow, avgResponseTimeMs}` |

`POST /api/vote` validates that `matchId` exists and `team ∈ {teamA, teamB}`,
returns `400 {error}` otherwise — no garbage counters.

## Deploy (Render)

`render.yaml` is a Blueprint; connect the repo in Render and it configures itself.
Manual setup is equivalent:

- **Root directory:** `backend`
- **Build:** `npm ci`
- **Start:** `node server.js`

Render assigns a public HTTPS URL and redeploys on every push to `main`
(green CI required if you enable "Auto-Deploy: After CI checks pass").

## Known limitations (by design, for demo scope)

- **Data is ephemeral.** The JSON file lives on the free tier's ephemeral disk, so
  vote counts reset on redeploy/restart. Production would move to Postgres/Supabase —
  the schema mapping is in `Backend-Schema.md §5`.
- **Cold starts.** The free service spins down when idle; the first request after
  idle can take ~30–50s.
- **Votes aren't fraud-proof.** "One vote per match" is a client-side `localStorage`
  flag, not a server-enforced control. Clearing storage/cookies lets you vote again.
  This is an engagement demo, not a billing-grade voting system.
- **Single instance.** One process, one file — fine at demo scale, would race under
  concurrent write load at production scale. Writes are serialized to avoid file corruption.

## Layout

```
backend/
  server.js            Express app: API, middleware, SSE, static, 404
  data/db.json         datastore (matches, meta counters, request ring-buffer)
  public/
    index.html         predictions / voting
    analytics.html     live dashboard
    404.html           branded not-found
    css/styles.css
    js/app.js          voting logic + live counts
    js/analytics.js    SSE + polling fallback + flash-on-change
  test/smoke.test.js   API contract + data-integrity tests
.github/workflows/ci.yml
render.yaml
```
