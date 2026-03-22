/* ═══════════════════════════════════════════
   Satyam's Store — shared.js
   Backend: Supabase REST API (direct, no SDK)
   ═══════════════════════════════════════════ */

const SB_URL = 'https://jrmctduwylpeicjcbmqs.supabase.co';
const SB_KEY = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

/* ── Supabase REST helpers ─────────────────────────────── */

function _sbHeaders(extras = {}) {
  return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
    ...extras,
  };
}

// GET  /rest/v1/<table>?<query>
async function sbGet(tableAndQuery) {
  const res = await fetch(
    `${SB_URL}/rest/v1/${tableAndQuery}`,
    {
      headers: {
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        // Omit Content-Type and Prefer on GETs — only needed for writes
      }
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Supabase auth failed (' + res.status + '). ' +
        'The API key may be wrong. Go to Supabase dashboard → Settings → API ' +
        'and copy the anon/public key (starts with eyJ). ' +
        'Update SB_KEY in shared.js.'
      );
    }
    throw new Error('sbGet ' + res.status + ': ' + txt.slice(0, 200));
  }
  return res.json();
}

// POST /rest/v1/<table>  — insert one row, returns inserted row
async function sbPost(table, body) {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}`,
    { method: 'POST', headers: _sbHeaders(), body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`sbPost ${res.status} ${txt}`);
  }
  return res.json();
}

// PATCH /rest/v1/<table>?<filter>  — update matching rows
async function sbPatch(tableAndFilter, body) {
  const res = await fetch(
    `${SB_URL}/rest/v1/${tableAndFilter}`,
    { method: 'PATCH', headers: _sbHeaders(), body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`sbPatch ${res.status} ${txt}`);
  }
  return res.json();
}

// DELETE /rest/v1/<table>?<filter>
async function sbDelete(tableAndFilter) {
  const res = await fetch(
    `${SB_URL}/rest/v1/${tableAndFilter}`,
    { method: 'DELETE', headers: _sbHeaders({ 'Prefer': 'return=minimal' }) }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`sbDelete ${res.status} ${txt}`);
  }
  return true;
}

/* ── Cache layer ───────────────────────────────────────── */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _cacheKey(label) {
  return 'ss_cache__' + label;
}
function _cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function _cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function _cacheInvalidate(label) {
  try {
    const prefix = 'ss_cache__' + label;
    Object.keys(localStorage).forEach(k => { if (k.startsWith(prefix)) localStorage.removeItem(k); });
  } catch {}
}

/* ── Product helpers ───────────────────────────────────── */

// Supabase products rows -> internal product objects
function parseProducts(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(r => ({
      id:    String(r.id   ?? '').trim(),
      name:  String(r.name ?? '').trim(),
      price: parseFloat(r.price)   || 0,
      stock: parseInt(r.stock, 10) || 0,
      image: String(r.image ?? '').trim(),
    }))
    .filter(p => p.id && p.name);
}

/* ── Utility ───────────────────────────────────────────── */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

let _tt;
function toast(msg, dur = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), dur);
}

function hideLoader() {
  const el = document.getElementById('page-loader');
  if (!el) return;
  el.classList.add('fade-out');
  setTimeout(() => { el.style.display = 'none'; }, 520);
}

// Format Supabase UTC timestamp -> IST date + time string
// Supabase always stores UTC. IST = UTC + 5h 30m.
// We add the offset to the epoch then read UTC fields — zero
// runtime-timezone interference, correct on any device/server.
function cleanSheetVal(val) {
  if (!val) return '';
  try {
    // Normalise: strip sub-seconds and ±HH:MM, force Z so parse is always UTC
    const clean = String(val)
      .replace(/\.\d+/, '')
      .replace(/[+-]\d{2}:\d{2}$/, '')
      .replace(/Z$/, '') + 'Z';
    const utc = new Date(clean);
    if (isNaN(utc.getTime())) return String(val);
    // Add IST offset: +5h 30m = 19800 seconds
    const ist = new Date(utc.getTime() + 19800000);
    const hh   = ist.getUTCHours();
    const min  = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12  = (hh % 12) || 12;
    return String(h12).padStart(2, '0') + ':' + min + ' ' + ampm;
  } catch { return String(val); }
}

// Return IST date string "DD/MM/YYYY" from a Supabase UTC timestamp
function istDateStr(val) {
  if (!val) return '';
  try {
    const clean = String(val)
      .replace(/\.\d+/, '')
      .replace(/[+-]\d{2}:\d{2}$/, '')
      .replace(/Z$/, '') + 'Z';
    const ist = new Date(new Date(clean).getTime() + 19800000);
    return String(ist.getUTCDate()).padStart(2,'0') + '/' +
           String(ist.getUTCMonth() + 1).padStart(2,'0') + '/' +
           ist.getUTCFullYear();
  } catch { return String(val); }
}

function placeholderSVG() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.2" opacity=".25"><rect x="2" y="7" width="20" height="14" rx="2"/><circle cx="12" cy="14" r="3"/><path d="M2 10h20"/></svg>';
}
