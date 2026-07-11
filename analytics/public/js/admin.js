'use strict';

/* Admin Dashboard Logic: passcode lock and full operational analytics */

const lockScreen = document.getElementById('lock-screen');
const dashboardContent = document.getElementById('dashboard-content');
const passcodeForm = document.getElementById('passcode-form');
const passcodeInput = document.getElementById('passcode-input');
const lockError = document.getElementById('lock-error');
const btnLock = document.getElementById('btn-lock');

const liveDot = document.getElementById('live-dot');
const liveText = document.getElementById('live-text');
const bannerEl = document.getElementById('banner');
const chartEl = document.getElementById('chart');

const API_BASE = window.location.port === '4000' ? 'http://localhost:3000' : '';

let lastStats = {};
let lastMetrics = {};
let loadedOnce = false;
let matchMeta = null;
const lastResult = {};

// Passcode configuration
const ADMIN_PASSCODE = 'gdgc2026';
// --- Lock Logic (Always request passcode on page load) ---

passcodeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = passcodeInput.value.trim();
  if (value === ADMIN_PASSCODE) {
    lockError.classList.add('hidden');
    unlockDashboard();
  } else {
    lockError.classList.remove('hidden');
    passcodeInput.value = '';
    passcodeInput.focus();
  }
});

btnLock.addEventListener('click', () => {
  lockScreen.classList.remove('hidden');
  dashboardContent.classList.add('hidden');
  stopPolling();
});

function unlockDashboard() {
  lockScreen.classList.add('hidden');
  dashboardContent.classList.remove('hidden');
  init();
}

// --- Telemetry Dashboard Operations ---

function tile(name) {
  const el = document.querySelector(`[data-tile="${name}"] .tile-value`);
  return el;
}

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
        void box.offsetWidth;
        box.classList.add('flash-border');
      }
    }
  }
}

function setLive(state, text) {
  if (state === 'live') {
    liveDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    liveText.className = 'font-label-lg text-label-lg uppercase text-emerald-600 font-bold tracking-widest';
    liveText.textContent = 'Active Ops Telemetry Stream';
  } else if (state === 'stale') {
    liveDot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
    liveText.className = 'font-label-lg text-label-lg uppercase text-yellow-600 font-bold tracking-widest';
    liveText.textContent = text;
  } else {
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

  renderLatencyHistory(m.latencyHistory || []);
  renderRouteDistribution(m.routeBreakdown || []);
  renderErrorConsole(m.recentErrors || []);

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

// --- Votes-by-fixture chart ---

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
    /* chart is best-effort */
  }
}

// --- Live connection ---

let pollTimer = null;
let sseSource = null;
let metricsInterval = null;
let resultsInterval = null;
let timerInterval = null;

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

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  if (metricsInterval) clearInterval(metricsInterval);
  if (resultsInterval) clearInterval(resultsInterval);
  if (timerInterval) clearInterval(timerInterval);
}

function startStream() {
  if (typeof EventSource === 'undefined') return startPolling();

  sseSource = new EventSource(API_BASE + '/api/stats/stream');

  sseSource.onopen = () => { setLive('live', 'Live'); banner(null); };
  sseSource.onmessage = (e) => {
    try {
      const stats = JSON.parse(e.data);
      const grew = stats.totalVotes !== lastStats.totalVotes;
      renderStats(stats);
      setLive('live', 'Live');
      banner(null);
      if (grew) fetchResults();
    } catch { /* ignore malformed frame */ }
  };
  sseSource.onerror = () => {
    setLive('stale', 'Reconnecting…');
    if (sseSource.readyState === EventSource.CLOSED) {
      sseSource.close();
      startPolling();
    }
  };
}

async function loadFixtures() {
  try {
    const res = await fetch(API_BASE + '/api/matches');
    if (res.ok) { matchMeta = await res.json(); buildChart(); }
  } catch {
    /* chart just won't render */
  }
}

function renderLatencyHistory(history) {
  const container = document.getElementById('latency-bars');
  if (!container) return;
  const bars = container.children;
  if (!bars || bars.length !== 12) return;

  // Pad history with 0s if we have less than 12 points
  const padded = [...Array(12 - history.length).fill(0), ...history];
  
  // Find maximum latency in the history to scale heights proportionally
  const max = Math.max(...padded, 100);

  padded.forEach((ms, idx) => {
    const bar = bars[idx];
    if (!bar) return;

    if (ms === 0) {
      bar.style.height = '10%';
      bar.title = 'No request';
      bar.className = 'bg-primary w-full transition-all duration-300 opacity-20';
      return;
    }

    const heightPct = Math.min(100, Math.max(10, Math.round((ms / max) * 100)));
    bar.style.height = `${heightPct}%`;
    bar.title = `${ms}ms`;

    if (ms >= 150) {
      bar.className = 'bg-secondary w-full transition-all duration-300';
    } else {
      bar.className = 'bg-primary w-full transition-all duration-300';
    }
  });
}

function renderRouteDistribution(breakdown) {
  const container = document.getElementById('route-distribution');
  if (!container) return;

  if (!breakdown || breakdown.length === 0) {
    container.innerHTML = `<div class="text-outline text-center py-12">Waiting for traffic data...</div>`;
    return;
  }

  container.innerHTML = breakdown
    .map((item) => {
      let badgeColor = 'bg-gray-100 text-gray-700';
      if (item.route.startsWith('/api/vote')) badgeColor = 'bg-amber-100 text-amber-800';
      else if (item.route.startsWith('/api/stats')) badgeColor = 'bg-emerald-100 text-emerald-800';
      else if (item.route.startsWith('/api/')) badgeColor = 'bg-blue-100 text-blue-800';

      return `
      <div class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center text-xs">
          <span class="font-mono font-bold ${badgeColor} px-2 py-0.5 rounded text-[10px]">${esc(item.route)}</span>
          <span class="text-outline font-bold text-[11px]">${item.count} reqs (${item.percentage}%)</span>
        </div>
        <div class="w-full bg-surface-container-high h-[6px] overflow-hidden rounded-sm">
          <div class="bg-primary h-full transition-all duration-500" style="width: ${item.percentage}%"></div>
        </div>
      </div>`;
    })
    .join('');
}

function renderErrorConsole(errors) {
  const consoleEl = document.getElementById('error-console');
  if (!consoleEl) return;

  if (!errors || errors.length === 0) {
    consoleEl.innerHTML = `<div class="text-emerald-500/60 text-center py-12 font-sans">[ SYSTEM STATUS: SECURE — NO ERRORS DETECTED ]</div>`;
    return;
  }

  consoleEl.innerHTML = errors
    .map((err) => {
      const time = new Date(err.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const statusBadge = `<span class="bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold mr-2">${err.status}</span>`;
      return `
      <div class="flex items-center justify-between py-1.5 border-b border-emerald-500/10 last:border-0 hover:bg-white/5 px-2 rounded transition-colors">
        <div>
          ${statusBadge}
          <span class="text-emerald-300 font-bold font-mono">${esc(err.route)}</span>
        </div>
        <span class="text-emerald-500/70 font-mono text-[10px]">${time}</span>
      </div>`;
    })
    .join('');
}

async function init() {
  try {
    renderStats(await fetchStats());
  } catch {
    setLive('error', 'Offline');
    banner('Unable to load analytics. Retrying…');
  }
  await loadFixtures();
  fetchMetrics();
  fetchResults();
  startStream();

  metricsInterval = setInterval(fetchMetrics, 5000);
  resultsInterval = setInterval(fetchResults, 5000);
  timerInterval = setInterval(() => { if (lastStats.uptimeSeconds != null) renderStats(lastStats); }, 1000);
}

// No session auto-init, always default to lock screen
