'use strict';

/* Analytics dashboard: live stats via SSE, metrics via polling,
   graceful fallback to polling if the stream drops. */

const liveDot = document.getElementById('live-dot');
const liveText = document.getElementById('live-text');
const bannerEl = document.getElementById('banner');
const chartEl = document.getElementById('chart');

const API_BASE = window.location.port === '4000' ? 'http://localhost:3000' : '';

let lastStats = {};
let lastMetrics = {};
let loadedOnce = false;
let matchMeta = null; // fixtures, fetched once
const lastResult = {}; // matchId -> {a,b} for flash detection

function tile(name) {
  const el = document.querySelector(`[data-tile="${name}"] .tile-value`);
  return el;
}

/** Set a tile's text, clearing the skeleton and flashing the border on change. */
function setTile(name, text, changed) {
  const el = tile(name);
  if (!el) return;
  el.classList.remove('skeleton');
  if (el.textContent !== text) {
    el.textContent = text;
    if (changed && loadedOnce) {
      const box = el.closest('[data-tile]');
      if (box) {
        box.classList.remove('flash-border');
        void box.offsetWidth; // restart animation
        box.classList.add('flash-border');
      }
    }
  }
}

function setLive(state, text) {
  if (state === 'live') {
    liveDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    liveText.className = 'font-label-lg text-label-lg uppercase text-emerald-600 font-bold tracking-widest';
    liveText.textContent = 'System Live: Real-Time Engine Active';
  } else if (state === 'stale') {
    liveDot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
    liveText.className = 'font-label-lg text-label-lg uppercase text-yellow-600 font-bold tracking-widest';
    liveText.textContent = text;
  } else {
    // error
    liveDot.className = 'w-2.5 h-2.5 rounded-full bg-secondary';
    liveText.className = 'font-label-lg text-label-lg uppercase text-secondary font-bold tracking-widest';
    liveText.textContent = text;
  }
}

function banner(msg) {
  if (!msg) {
    bannerEl.className = 'hidden';
    return;
  }
  bannerEl.textContent = msg;
  bannerEl.className = 'mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded-lg font-bold text-center';
}

function fmtUptime(sec) {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function fmtRelative(iso, totalVotes) {
  if (!totalVotes) return 'No votes yet';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function renderStats(s) {
  setTile('totalVotes', Number(s.totalVotes).toLocaleString(), s.totalVotes !== lastStats.totalVotes);
  setTile('mostVotedTeam', s.mostVotedTeam || '—', s.mostVotedTeam !== lastStats.mostVotedTeam);
  setTile('totalVisitors', Number(s.totalVisitors).toLocaleString(), s.totalVisitors !== lastStats.totalVisitors);
  setTile('requestCount', Number(s.requestCount).toLocaleString(), s.requestCount !== lastStats.requestCount);
  setTile('uptime', fmtUptime(s.uptimeSeconds), false);
  setTile('lastUpdated', fmtRelative(s.lastUpdated, s.totalVotes), s.lastUpdated !== lastStats.lastUpdated);
  
  renderActivityFeed(s.votesLog || []);

  lastStats = s;
  loadedOnce = true;
}

function updateFill(tileName, pct) {
  const tileEl = document.querySelector(`[data-tile="${tileName}"]`);
  if (tileEl) {
    const fill = tileEl.querySelector('[data-fill]');
    if (fill) fill.style.width = pct + '%';
  }
}

function renderMetrics(m) {
  setTile('avgRequestsPerMin', Number(m.avgRequestsPerMin).toLocaleString(), m.avgRequestsPerMin !== lastMetrics.avgRequestsPerMin);
  updateFill('avgRequestsPerMin', Math.min(100, Math.round((m.avgRequestsPerMin / 1000) * 100)));

  setTile('errorCount', Number(m.errorCount).toLocaleString(), m.errorCount !== lastMetrics.errorCount);
  updateFill('errorCount', m.errorCount > 0 ? Math.min(100, m.errorCount * 10) : 0);

  setTile('peakTrafficWindow', m.peakTrafficWindow || '—', m.peakTrafficWindow !== lastMetrics.peakTrafficWindow);
  updateFill('peakTrafficWindow', m.peakTrafficWindow ? 85 : 0);

  setTile('avgResponseTimeMs', `${m.avgResponseTimeMs}ms`, m.avgResponseTimeMs !== lastMetrics.avgResponseTimeMs);
  updateFill('avgResponseTimeMs', Math.min(100, Math.round((m.avgResponseTimeMs / 400) * 100)));

  lastMetrics = m;
}

async function fetchStats() {
  const res = await fetch(API_BASE + '/api/stats');
  if (!res.ok) throw new Error('stats');
  return res.json();
}

async function fetchMetrics() {
  try {
    const res = await fetch(API_BASE + '/api/metrics');
    if (res.ok) renderMetrics(await res.json());
  } catch {
    /* metrics are best-effort; don't fail the whole page */
  }
}

// --- Votes-by-fixture chart ----------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function isTbd(name) { return /^TBD/i.test(name); }

function getFlagUrl(countryName) {
  if (isTbd(countryName)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50" viewBox="0 0 80 50"><rect width="80" height="50" fill="#f1f5f9" rx="4"/><text x="50%" y="60%" font-family="system-ui, sans-serif" font-size="26" font-weight="900" fill="#cbd5e1" dominant-baseline="middle" text-anchor="middle">?</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  const mapping = {
    'france': 'https://flagcdn.com/w80/fr.png',
    'morocco': 'https://flagcdn.com/w80/ma.png',
    'spain': 'https://flagcdn.com/w80/es.png',
    'belgium': 'https://flagcdn.com/w80/be.png',
    'norway': 'https://flagcdn.com/w80/no.png',
    'england': 'https://flagcdn.com/w80/gb-eng.png',
    'argentina': 'https://flagcdn.com/w80/ar.png',
    'switzerland': 'https://flagcdn.com/w80/ch.png',
    'netherlands': 'https://flagcdn.com/w80/nl.png',
    'portugal': 'https://flagcdn.com/w80/pt.png',
    'germany': 'https://flagcdn.com/w80/de.png',
    'italy': 'https://flagcdn.com/w80/it.png',
    'usa': 'https://flagcdn.com/w80/us.png'
  };
  const clean = countryName.toLowerCase().trim();
  return mapping[clean] || 'https://flagcdn.com/w80/un.png';
}

function getCountryCode(countryName) {
  const mapping = {
    'france': 'FRA',
    'morocco': 'MAR',
    'spain': 'ESP',
    'belgium': 'BEL',
    'norway': 'NOR',
    'england': 'ENG',
    'argentina': 'ARG',
    'switzerland': 'SUI',
    'netherlands': 'NED',
    'portugal': 'POR',
    'germany': 'GER',
    'italy': 'ITA',
    'usa': 'USA'
  };
  const clean = countryName.toLowerCase().trim();
  return mapping[clean] || countryName.slice(0, 3).toUpperCase();
}

function buildChart() {
  chartEl.innerHTML = matchMeta
    .map((m) => {
      const tbdA = isTbd(m.teamA);
      const tbdB = isTbd(m.teamB);
      const codeA = getCountryCode(m.teamA);
      const codeB = getCountryCode(m.teamB);
      const flagA = getFlagUrl(m.teamA);
      const flagB = getFlagUrl(m.teamB);
      return `
      <div class="flex flex-col gap-2 pb-6 border-b border-outline-variant last:border-0 last:pb-0" data-match="${m.id}">
        <div class="flex justify-between items-center text-on-background">
          <!-- Team A (Left) -->
          <div class="flex items-center gap-3">
            ${tbdA ? '' : `<img class="w-8 h-5 object-cover rounded border border-gray-200" src="${flagA}" alt="${esc(m.teamA)}" />`}
            <span class="font-bold text-headline-sm uppercase ${tbdA ? 'text-outline opacity-50 font-normal' : ''}">${codeA}</span>
            <span class="text-primary font-bold font-label-md" data-va>0</span>
          </div>
          <!-- Stage -->
          <span class="font-label-md uppercase text-outline font-bold text-xs">${esc(m.stage)}</span>
          <!-- Team B (Right) -->
          <div class="flex items-center gap-3">
            <span class="text-secondary font-bold font-label-md" data-vb>0</span>
            <span class="font-bold text-headline-sm uppercase ${tbdB ? 'text-outline opacity-50 font-normal' : ''}">${codeB}</span>
            ${tbdB ? '' : `<img class="w-8 h-5 object-cover rounded border border-gray-200" src="${flagB}" alt="${esc(m.teamB)}" />`}
          </div>
        </div>
        <div class="w-full bg-surface-container-high h-[12px] overflow-hidden flex rounded-sm" role="img"
             aria-label="${esc(m.teamA)} versus ${esc(m.teamB)}: no votes yet">
          <div class="bg-primary h-full transition-all duration-500" data-fa style="width: 0%"></div>
          <div class="bg-secondary h-full transition-all duration-500 ml-[2px]" data-fb style="width: 0%"></div>
        </div>
      </div>`;
    })
    .join('');
}

function renderChart(results) {
  if (!matchMeta) return;
  if (!chartEl.querySelector('[data-match]')) buildChart();
  const byId = Object.fromEntries(results.map((r) => [r.matchId, r]));

  for (const m of matchMeta) {
    const row = chartEl.querySelector(`[data-match="${m.id}"]`);
    if (!row) continue;
    const r = byId[m.id] || { teamA_votes: 0, teamB_votes: 0 };
    const a = r.teamA_votes;
    const b = r.teamB_votes;
    const total = a + b;

    let aPct = 0;
    let bPct = 0;
    let gap = '2px';
    if (total > 0) {
      aPct = (a / total) * 100;
      bPct = (b / total) * 100;
      if (aPct > 0 && bPct > 0) {
        aPct = Math.max(5, aPct - 1);
        bPct = Math.max(5, bPct - 1);
      }
    } else {
      aPct = 0;
      bPct = 0;
      gap = '0px';
    }

    row.querySelector('[data-va]').textContent = a.toLocaleString();
    row.querySelector('[data-vb]').textContent = b.toLocaleString();
    
    const fa = row.querySelector('[data-fa]');
    const fb = row.querySelector('[data-fb]');
    fa.style.width = aPct + '%';
    fb.style.width = bPct + '%';
    fb.style.marginLeft = gap;

    const bar = row.querySelector('[role="img"]');
    bar.setAttribute(
      'aria-label',
      total
        ? `${m.teamA} ${a} votes (${Math.round(a / total * 100)}%), ${m.teamB} ${b} votes (${Math.round(b / total * 100)}%)`
          : `${m.teamA} versus ${m.teamB}: no votes yet`,
    );

    // flash the value that grew
    const prev = lastResult[m.id];
    if (prev && loadedOnce) {
      if (a !== prev.a) flashEl(row.querySelector('[data-va]'));
      if (b !== prev.b) flashEl(row.querySelector('[data-vb]'));
    }
    lastResult[m.id] = { a, b };
  }
}

function renderActivityFeed(votes) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  if (!votes || votes.length === 0) {
    feed.innerHTML = `<div class="text-outline text-body-sm text-center py-12">Waiting for new predictions...</div>`;
    return;
  }

  // Reverse so the newest votes appear first
  const reversedVotes = [...votes].reverse();

  feed.innerHTML = reversedVotes
    .map((vote) => {
      const time = new Date(vote.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const flagUrl = getFlagUrl(vote.votedTeam);
      
      return `
      <div class="flex items-center justify-between p-3 bg-surface border border-outline-variant rounded-lg">
        <div class="flex items-center gap-3">
          <img class="w-6 h-4 object-cover rounded border border-gray-200" src="${flagUrl}" alt="${esc(vote.votedTeam)}" />
          <div class="flex flex-col">
            <span class="text-body-sm font-bold text-on-surface">
              Predicted <span class="text-primary font-extrabold">${esc(vote.votedTeam)}</span> to beat ${esc(vote.opponent)}
            </span>
            <span class="text-[10px] text-outline uppercase font-bold text-xs">${esc(vote.stage)} fixture</span>
          </div>
        </div>
        <span class="text-[11px] font-mono text-outline">${time}</span>
      </div>`;
    })
    .join('');
}

function flashEl(el) {
  // We can flash the color temporarily using Tailwind text-secondary style or similar
  el.classList.add('text-secondary');
  setTimeout(() => {
    el.classList.remove('text-secondary');
  }, 1000);
}

async function fetchResults() {
  try {
    const res = await fetch(API_BASE + '/api/results');
    if (res.ok) renderChart(await res.json());
  } catch {
    /* chart is best-effort; tiles remain the source of truth */
  }
}

// --- Live connection ------------------------------------------------------

let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  setLive('stale', 'Live (polling)');
  const tick = async () => {
    try {
      renderStats(await fetchStats());
      banner(null);
    } catch {
      setLive('error', 'Connection lost');
      banner('Unable to load analytics. Retrying…');
    }
  };
  tick();
  pollTimer = setInterval(tick, 5000);
}

function startStream() {
  if (typeof EventSource === 'undefined') return startPolling();

  const es = new EventSource(API_BASE + '/api/stats/stream');

  es.onopen = () => { setLive('live', 'Live'); banner(null); };
  es.onmessage = (e) => {
    try {
      const stats = JSON.parse(e.data);
      const grew = stats.totalVotes !== lastStats.totalVotes;
      renderStats(stats);
      setLive('live', 'Live');
      banner(null);
      if (grew) fetchResults();
    } catch { /* ignore malformed frame */ }
  };
  es.onerror = () => {
    setLive('stale', 'Reconnecting…');
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      startPolling();
    }
  };
}

async function loadFixtures() {
  try {
    const res = await fetch(API_BASE + '/api/matches');
    if (res.ok) { matchMeta = await res.json(); buildChart(); }
  } catch {
    /* chart just won't render; rest of the dashboard is unaffected */
  }
}

function initThroughputSim() {
  const bars = document.querySelectorAll('main section div.bg-primary.transition-all, main section div.bg-secondary.transition-all');
  setInterval(() => {
    bars.forEach(bar => {
      const randomHeight = Math.floor(Math.random() * 60) + 30;
      bar.style.height = `${randomHeight}%`;
    });
  }, 3000);
}

async function init() {
  try {
    renderStats(await fetchStats()); // paint immediately, don't wait for SSE
  } catch {
    setLive('error', 'Offline');
    banner('Unable to load analytics. Retrying…');
  }
  await loadFixtures();
  fetchMetrics();
  fetchResults();
  startStream();
  initThroughputSim();

  // Metrics + per-fixture results aren't in the SSE payload — poll them.
  setInterval(fetchMetrics, 5000);
  setInterval(fetchResults, 5000);
  // Keep relative "last updated" / uptime honest between server pushes.
  setInterval(() => { if (lastStats.uptimeSeconds != null) renderStats(lastStats); }, 1000);
}

init();
