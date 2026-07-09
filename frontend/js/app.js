'use strict';

/* Predictions page: load fixtures + live counts, cast votes without reload. */

const VOTED_KEY = 'fifa_pulse_voted';
const matchesEl = document.getElementById('matches');
const bannerEl = document.getElementById('banner');
const summaryEl = document.getElementById('summary');

// Live view of every fixture's counts, kept in sync so the summary bar can
// recompute the crowd favorite without re-fetching.
const counts = {}; // matchId -> {teamA, teamB, teamAName, teamBName}
let matchCount = 0;
let loadedMatches = [];

/** Which matches this browser has already voted on (UI convenience only). */
function getVoted() {
  try {
    return JSON.parse(localStorage.getItem(VOTED_KEY)) || {};
  } catch {
    return {};
  }
}
function setVoted(matchId, team) {
  const voted = getVoted();
  voted[matchId] = team;
  localStorage.setItem(VOTED_KEY, JSON.stringify(voted));
}

function banner(msg, isError) {
  if (!msg) {
    bannerEl.className = 'hidden';
    return;
  }
  bannerEl.textContent = msg;
  bannerEl.className = 'mb-6 p-4 border rounded-lg font-bold text-center ' + 
    (isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-700');
}

function fmtVenueDate(iso, venue) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', timeZone: 'UTC',
  }).toUpperCase();
  const city = venue.split('(')[0].trim().toUpperCase();
  return `${day} — ${city}`;
}

function isTbd(name) {
  return /^TBD/i.test(name);
}

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

function showLoading() {
  matchesEl.innerHTML = Array.from({ length: 5 })
    .map(
      (_, i) => `
      <div class="bg-white rounded-xl shadow-lg border border-gray-200 p-5 flex flex-col gap-4 animate-pulse">
        <div class="flex justify-between items-center border-b border-gray-100 pb-2">
          <div class="h-3 bg-gray-200 rounded w-20"></div>
          <div class="h-3 bg-gray-200 rounded w-24"></div>
        </div>
        <div class="flex items-center justify-between py-2">
          <div class="flex-1 flex flex-col items-center">
            <div class="w-12 h-8 bg-gray-200 rounded shadow-sm"></div>
            <div class="h-4 bg-gray-200 rounded w-10 mt-2"></div>
          </div>
          <div class="flex gap-1.5 px-2">
            <div class="w-8 h-8 bg-gray-100 border border-gray-200 rounded"></div>
            <div class="w-8 h-8 bg-gray-100 border border-gray-200 rounded"></div>
          </div>
          <div class="flex-1 flex flex-col items-center">
            <div class="w-12 h-8 bg-gray-200 rounded shadow-sm"></div>
            <div class="h-4 bg-gray-200 rounded w-10 mt-2"></div>
          </div>
        </div>
        <div class="h-8 bg-gray-200 rounded w-full"></div>
        <div class="h-8 bg-gray-200 rounded w-full"></div>
      </div>`
    )
    .join('');
}

function voteButton(teamName, code, votedTeam, teamKey) {
  const tbd = isTbd(teamName);
  if (tbd) {
    return `
      <button class="w-full py-2.5 bg-gray-100 text-gray-400 text-xs font-bold uppercase rounded-lg border border-gray-200 cursor-not-allowed flex justify-between items-center px-4" disabled>
        <span>Awaiting Team</span>
        <span class="material-symbols-outlined text-sm">lock</span>
      </button>`;
  }
  if (votedTeam) {
    if (votedTeam === teamKey) {
      return `
        <button class="w-full py-2.5 bg-gray-200 text-gray-500 text-xs font-bold uppercase rounded-lg border border-gray-300 cursor-default flex justify-between items-center px-4" disabled>
          <span>Voted ${teamName}</span>
          <span class="material-symbols-outlined text-sm font-bold text-emerald-500">check</span>
        </button>`;
    } else {
      return `
        <button class="w-full py-2.5 bg-white text-gray-300 text-xs font-bold uppercase rounded-lg border border-gray-100 cursor-default flex justify-between items-center px-4 opacity-40" disabled>
          <span>Vote ${teamName}</span>
          <span class="material-symbols-outlined text-sm">add_circle</span>
        </button>`;
    }
  }
  return `
    <button class="w-full py-2.5 bg-[#0e2245] hover:bg-[#1a3666] text-white text-xs font-bold uppercase rounded-lg transition-all flex justify-between items-center px-4 active:scale-[0.98]" data-vote-btn="${teamKey}">
      <span>Vote ${teamName}</span>
      <span class="material-symbols-outlined text-sm">add_circle</span>
    </button>`;
}

function renderCard(match, result) {
  const voted = getVoted()[match.id];
  const a = result ? result.teamA_votes : match.votes?.teamA || 0;
  const b = result ? result.teamB_votes : match.votes?.teamB || 0;
  const total = a + b;
  const aPct = total ? Math.round((a / total) * 100) : 0;
  const bPct = total ? Math.round((b / total) * 100) : 0;

  const card = document.createElement('div');
  const isFinal = match.stage.toLowerCase() === 'final';
  if (isFinal) {
    card.className = 'bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col justify-between professional-shadow transition-transform hover:scale-[1.01] hover:border-gray-300 col-span-full lg:col-start-2 lg:col-span-2 mx-auto w-full max-w-md';
  } else {
    card.className = 'bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col justify-between professional-shadow transition-transform hover:scale-[1.01] hover:border-gray-300';
  }
  card.dataset.matchId = match.id;

  const codeA = getCountryCode(match.teamA);
  const codeB = getCountryCode(match.teamB);
  const flagA = getFlagUrl(match.teamA);
  const flagB = getFlagUrl(match.teamB);

  card.innerHTML = `
    <!-- Card Header -->
    <div class="bg-gray-50 border-b border-gray-100 py-2.5 px-4 flex justify-between items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider">
      <span>${escapeHtml(match.stage)}</span>
      <span>${fmtVenueDate(match.date, match.venue)}</span>
    </div>

    <!-- Flags and Percentages Row -->
    <div class="flex items-center justify-between p-5 pt-6 pb-4">
      <!-- Team A -->
      <div class="flex flex-col items-center flex-1">
        <img class="w-12 h-8 md:w-14 md:h-9 object-cover rounded border border-gray-200 shadow-sm" src="${flagA}" alt="${escapeHtml(match.teamA)}" />
        <span class="font-black text-sm text-gray-800 mt-2 tracking-wide uppercase">${codeA}</span>
      </div>

      <!-- Live Score Box Display -->
      <div class="flex items-center gap-1.5 px-2">
        <div class="w-10 h-10 bg-gray-100 border border-gray-200 rounded flex items-center justify-center font-bold text-gray-800 text-sm">
          ${total ? aPct : '-'}
        </div>
        <div class="w-10 h-10 bg-gray-100 border border-gray-200 rounded flex items-center justify-center font-bold text-gray-800 text-sm">
          ${total ? bPct : '-'}
        </div>
      </div>

      <!-- Team B -->
      <div class="flex flex-col items-center flex-1">
        <img class="w-12 h-8 md:w-14 md:h-9 object-cover rounded border border-gray-200 shadow-sm" src="${flagB}" alt="${escapeHtml(match.teamB)}" />
        <span class="font-black text-sm text-gray-800 mt-2 tracking-wide uppercase">${codeB}</span>
      </div>
    </div>

    <!-- Popular Picks section -->
    <div class="px-5 mb-4 text-center">
      <div class="text-[9px] uppercase tracking-widest text-gray-400 font-extrabold mb-2">Popular Picks</div>
      <div class="flex justify-center gap-2">
        <span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-[10px] font-black tracking-wide">${codeA} (${total ? aPct + '%' : '0%'})</span>
        <span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-[10px] font-black tracking-wide">${codeB} (${total ? bPct + '%' : '0%'})</span>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="px-5 mb-5 flex flex-col gap-2">
      ${voteButton(match.teamA, codeA, voted, 'teamA')}
      ${voteButton(match.teamB, codeB, voted, 'teamB')}
    </div>

    <!-- Card Footer -->
    <div class="bg-[#001736] text-white py-3 px-4 flex justify-between items-center text-[10px] uppercase font-bold tracking-wider">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-white/80">Voting Open</span>
      </div>
      <a href="/analytics" class="text-[10px] text-amber-400 hover:underline font-extrabold tracking-widest">Match Centre</a>
    </div>
  `;

  counts[match.id] = {
    teamA: a, teamB: b, teamAName: match.teamA, teamBName: match.teamB,
  };

  return card;
}

/** Aggregate crowd favorite + totals across all fixtures, ignoring TBD slots. */
function updateSummary() {
  const tally = new Map();
  let total = 0;
  for (const c of Object.values(counts)) {
    total += c.teamA + c.teamB;
    if (!isTbd(c.teamAName)) tally.set(c.teamAName, (tally.get(c.teamAName) || 0) + c.teamA);
    if (!isTbd(c.teamBName)) tally.set(c.teamBName, (tally.get(c.teamBName) || 0) + c.teamB);
  }

  let fav = null;
  let favCount = 0;
  for (const [team, n] of tally) {
    if (n > favCount) { fav = team; favCount = n; }
  }

  const votedCount = Object.keys(getVoted()).length;
  summaryEl.querySelector('[data-fav]').textContent =
    fav && favCount > 0 ? `${fav} · ${favCount.toLocaleString()}` : 'No votes yet';
  summaryEl.querySelector('[data-total]').textContent = total.toLocaleString();
  summaryEl.querySelector('[data-mine]').textContent = `${votedCount} / ${matchCount}`;
  summaryEl.classList.remove('hidden');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function castVote(card, team) {
  const matchId = card.dataset.matchId;
  const errEl = card.querySelector('.card-error');
  if (errEl) errEl.textContent = '';

  // Optimistically lock both buttons to stop double-submits.
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));

  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, team }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Vote failed');

    counts[matchId].teamA = data.updatedCounts.teamA_votes;
    counts[matchId].teamB = data.updatedCounts.teamB_votes;
    setVoted(matchId, team);
    
    // Find the original match details to rebuild card with voted status
    const originalMatch = loadedMatches.find(m => m.id === matchId);
    const newCard = renderCard(originalMatch, data.updatedCounts);
    card.replaceWith(newCard);
    
    updateSummary();
  } catch (err) {
    if (errEl) errEl.textContent = err.message + ' — please try again.';
    // Re-enable so the user can retry.
    card.querySelectorAll('button').forEach((b) => {
      const teamRow = b.closest('[data-team]');
      if (teamRow) {
        const teamName = teamRow.querySelector('.font-headline-md, .font-headline-lg').textContent;
        if (!isTbd(teamName)) {
          b.disabled = false;
        }
      }
    });
  }
}

async function load() {
  showLoading();
  try {
    const [matchesRes, resultsRes] = await Promise.all([
      fetch('/api/matches'),
      fetch('/api/results'),
    ]);
    if (!matchesRes.ok || !resultsRes.ok) throw new Error('bad response');

    loadedMatches = await matchesRes.json();
    const results = await resultsRes.json();
    const resultById = Object.fromEntries(results.map((r) => [r.matchId, r]));

    banner(null);
    matchesEl.innerHTML = '';
    matchCount = loadedMatches.length;
    loadedMatches.forEach((m) => matchesEl.appendChild(renderCard(m, resultById[m.id])));
    updateSummary();
  } catch (e) {
    console.error(e);
    matchesEl.innerHTML = '';
    banner('Unable to load fixtures. Check your connection and refresh.', true);
  }
}

matchesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vote-btn]');
  if (!btn || btn.disabled) return;
  const card = btn.closest('[data-match-id]');
  const team = btn.dataset.voteBtn;
  castVote(card, team);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(VOTED_KEY);
  load();
});

load();
