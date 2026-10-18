/* ═══════════════════════════════════════════
   Your's Store — shared.js
   Backend: Supabase REST API (direct, no SDK)
   ═══════════════════════════════════════════ */

const SB_URL = 'https://jrmctduwylpeicjcbmqs.supabase.co';
const SB_KEY = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

/* ── Supabase REST helpers ─────────────────────────────── */

// Session lives in localStorage for a persistent (Google) login, or
// sessionStorage for a password login that should clear when the tab/app
// closes. Check both so either login method's session gets picked up.
function _readSbSession() {
  return localStorage.getItem('sb_session') || sessionStorage.getItem('sb_session');
}

function _sbHeaders(extras = {}) {
  // Use authenticated JWT if available (admin), fall back to anon key (store)
  let token = SB_KEY;
  try {
    const raw = _readSbSession();
    if (raw) {
      const s = JSON.parse(raw);
      if (s.access_token) token = s.access_token;
    }
  } catch {}
  return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + token,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
    ...extras,
  };
}

// GET  /rest/v1/<table>?<query>
async function sbGet(tableAndQuery) {
  let token = SB_KEY;
  try {
    const raw = _readSbSession();
    if (raw) { const s = JSON.parse(raw); if (s.access_token) token = s.access_token; }
  } catch {}
  const res = await fetch(
    `${SB_URL}/rest/v1/${tableAndQuery}`,
    {
      headers: {
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + token,
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
    { method: 'PATCH', headers: _sbHeaders({ 'Prefer': 'return=minimal' }), body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`sbPatch ${res.status} ${txt}`);
  }
  // return=minimal gives 204 No Content — no body to parse
  return true;
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

/* ── Store config (settings table) ────────────────────── */

const _DEFAULT_CONFIG = { storeStatus: 'open', autoCloseEnabled: false, autoCloseTime: '03:00', lastAutoCloseDate: '', forceLogoutAt: 0 };

async function getStoreConfig() {
  try {
    const data = await sbGet('settings?key=eq.store_config&select=value');
    if (data && data.length > 0) {
      return { ..._DEFAULT_CONFIG, ...(data[0].value || {}) };
    }
    // Row doesn't exist yet — create it silently
    try {
      await sbPost('settings', { key: 'store_config', value: _DEFAULT_CONFIG });
    } catch (_) {}
    return { ..._DEFAULT_CONFIG };
  } catch (error) {
    /* suppressed */
    return { ..._DEFAULT_CONFIG };
  }
}

async function setStoreConfig(patch) {
  const currentConfig = await getStoreConfig();
  const newConfig = { ...currentConfig, ...patch };
  try {
    await sbPatch('settings?key=eq.store_config', { value: newConfig });
  } catch (e) {
    try {
      await sbPost('settings', { key: 'store_config', value: newConfig });
    } catch (_) {}
  }
  return newConfig;
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
      id:             String(r.id   ?? '').trim(),
      name:           String(r.name ?? '').trim(),
      price:          parseFloat(r.price)   || 0,
      stock:          parseInt(r.stock, 10) || 0,
      image:          String(r.image ?? '').trim(),
      purchase_price: parseFloat(r.purchase_price) || 0,
      hidden: r.hidden === true || r.hidden === 'true',
      category: String(r.category || 'others').trim(),
    }))
    .filter(p => p.id && p.name);
}

/* ── Utility ───────────────────────────────────────────── */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Masks a UPI VPA for on-screen display — e.g. "9162591726@yesfam"
// becomes "••••••••26@yesfam". The real value is still used underneath
// for the QR code and the Copy button; this only hides it from view.
function maskUPI(id) {
  const s = String(id || '');
  const at = s.indexOf('@');
  if (at < 3) return s;
  const local  = s.slice(0, at);
  const domain = s.slice(at);
  const tail   = local.slice(-2);
  return '•'.repeat(Math.max(local.length - 2, 4)) + tail + domain;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Capture deterrents ────────────────────────────────
   Being upfront about what this actually does: no website can block
   an OS-level screenshot or screen recording — Print Screen, a phone's
   screenshot gesture, or any capture app all happen outside the
   browser's control. This only raises friction for the casual
   right-click-save / copy-paste case. watermarkPage() below is the
   part that actually matters: it can't stop a capture, but it makes
   one traceable back to whoever's account took it. ── */

function enableCaptureDeterrents() {
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    const k = e.key;
    const blocked =
      k === 'PrintScreen' ||
      (e.ctrlKey && ['p','s','u'].includes(k.toLowerCase())) ||
      (e.ctrlKey && e.shiftKey && ['i','c','j'].includes(k.toLowerCase())) ||
      k === 'F12';
    if (blocked) e.preventDefault();
  });
}

// Tiles an extremely faint, full-bleed, repeating watermark of `label`
// (e.g. the signed-in user's email) across the page. Doesn't stop a
// screenshot — the point is that it can't be seen well enough to crop
// or paint over, since it covers 100% of the viewport at a barely-there
// opacity, but it's still there in the pixels: pushing brightness/
// contrast up on a captured image reveals it and identifies whose
// account it came from.
function watermarkPage(label) {
  if (!label || document.getElementById('_wm_overlay')) return;
  const el = document.createElement('div');
  el.id = '_wm_overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:8000;pointer-events:none;overflow:hidden;opacity:.018;mix-blend-mode:difference;';
  const text = esc(label) + '  •  ' + new Date().toLocaleDateString();
  const tile = '<span style="width:160px;display:inline-block;text-align:center">' + text + '</span>';
  el.innerHTML =
    '<div style="position:absolute;top:-20%;left:-20%;width:140%;height:140%;' +
    'display:flex;flex-wrap:wrap;align-content:space-around;transform:rotate(-28deg);' +
    'font-family:sans-serif;font-size:10px;font-weight:600;color:#fff;">' +
    tile.repeat(160) + '</div>';
  document.body.appendChild(el);
}

let _tt;
function toast(msg, dur = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), dur);
}

let _loaderHidden = false;
function hideLoader() {
  if (_loaderHidden) return;
  _loaderHidden = true;
  const el = document.getElementById('page-loader');
  if (!el) return;
  // Stop all animations immediately so they don't keep running under the fade
  el.style.animation = 'none';
  const card = el.querySelector('.animating-card');
  if (card) card.style.animation = 'none';
  el.classList.add('fade-out');
  setTimeout(() => { el.style.display = 'none'; }, 540);
}

// Format Supabase timestamp -> IST time string (HH:MM AM/PM)
// Supabase timestamps may come with or without timezone info.
// Strategy: normalise to UTC epoch, then add IST offset (+5:30), read UTC fields.
function cleanSheetVal(val) {
  if (!val) return '';
  try {
    const ms = _toUTCms(val);
    if (ms === null) return String(val);
    // Shift to IST: UTC + 5h30m = +19800000ms
    const ist = new Date(ms + 19800000);
    const hh  = ist.getUTCHours();
    const min = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12  = (hh % 12) || 12;
    return String(h12).padStart(2, '0') + ':' + min + ' ' + ampm;
  } catch { return String(val); }
}

// Return IST date string "DD/MM/YYYY" from a Supabase timestamp
function istDateStr(val) {
  if (!val) return '';
  try {
    const ms = _toUTCms(val);
    if (ms === null) return String(val);
    const ist = new Date(ms + 19800000);
    return String(ist.getUTCDate()).padStart(2, '0') + '/' +
           String(ist.getUTCMonth() + 1).padStart(2, '0') + '/' +
           ist.getUTCFullYear();
  } catch { return String(val); }
}

// Parse any Supabase timestamp to a UTC epoch ms value.
// Handles: "2026-04-21T10:24:00+00:00", "2026-04-21T10:24:00Z",
//          "2026-04-21T10:24:00.123456+05:30", "2026-04-21T10:24:00" (bare, assumed UTC)
function _toUTCms(val) {
  const s = String(val).trim();
  // Already has timezone info — let the engine parse it (unambiguous)
  if (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  // Bare timestamp with no timezone — treat as UTC by appending Z
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d.getTime();
}

function placeholderSVG() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.2" opacity=".25"><rect x="2" y="7" width="20" height="14" rx="2"/><circle cx="12" cy="14" r="3"/><path d="M2 10h20"/></svg>';
}

/* ── Customer Google-login gate (index.html) ─────────────
   Separate from admin.html's own Google/password auth block —
   this is the "only approved emails can view the store" gate.
   Uses localStorage (persistent), matching _readSbSession's
   convention that a Google session should survive tab/app close. ── */

const _GATE_AUTH_URL = SB_URL + '/auth/v1';

// Kicks off the Supabase Google OAuth redirect flow.
// Marks this browser as one that has signed in before, so a session that
// vanished unexpectedly can be restored silently. Cleared on every deliberate
// or forced sign-out, so logging out (or a ban / "log everyone out") sticks.
function _markReturning(on) {
  document.cookie = 'ys_returning=' + (on ? '1; max-age=31536000' : '; max-age=0') + '; path=/; SameSite=Lax';
}
function _isReturning() { return /(?:^|;\s*)ys_returning=1/.test(document.cookie); }

// A deliberate sign-in always shows Google's account chooser, so logging out
// really means something. Only the automatic restore of a lost session
// (silent = true) skips it.
function startGoogleLogin(silent) {
  const redirectTo = window.location.origin + window.location.pathname;
  window.location.href =
    _GATE_AUTH_URL + '/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo) +
    (silent === true ? '' : '&prompt=select_account');
}

// After Supabase/Google redirect back, the tokens arrive in the URL
// hash (#access_token=...&refresh_token=...). Pull them out, save
// them persistently, and clean the URL so they don't linger.
function _captureGateRedirect() {
  if (!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const access_token  = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    localStorage.setItem('sb_session', JSON.stringify({ access_token, refresh_token, login_at: Date.now() }));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  }
  return false;
}

// A dropped connection must never be mistaken for a rejected login:
// _NET means "couldn't reach the server", null means "server said no".
const _NET = { net: true };

async function _gateFetchUser(token) {
  try {
    const res = await fetch(_GATE_AUTH_URL + '/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token }
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return _NET;
    return await res.json();
  } catch { return _NET; }
}

async function _gateRefreshSession(refresh_token) {
  try {
    const res = await fetch(_GATE_AUTH_URL + '/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) return null;
    if (!res.ok) return _NET;
    return await res.json();
  } catch { return _NET; }
}

// Refresh tokens rotate, so two refreshes at once would invalidate each
// other and log the user out. Share one request between all callers.
let _refreshFlight = null;
function _refreshOnce(refresh_token) {
  if (!_refreshFlight) _refreshFlight = _gateRefreshSession(refresh_token).finally(() => { _refreshFlight = null; });
  return _refreshFlight;
}

function _jwtExpMs(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
  catch { return 0; }
}

// Keeps a persistent (Google) session's access token fresh so a customer who
// stays in the app past the 1-hour token life isn't silently signed out.
async function refreshSessionIfNeeded() {
  let s;
  try { s = JSON.parse(localStorage.getItem('sb_session') || 'null'); } catch { return false; }
  if (!s || !s.access_token || !s.refresh_token) return false;
  if (_jwtExpMs(s.access_token) - Date.now() > 5 * 60 * 1000) return true;
  const r = await _refreshOnce(s.refresh_token);
  if (r && r.access_token) {
    localStorage.setItem('sb_session', JSON.stringify({ ...r, login_at: s.login_at }));
    return true;
  }
  return false;   // offline or rejected: leave the stored session alone
}

// Returns one of:
//   { status: 'approved', email, login_at }  — signed in AND approved
//   { status: 'pending',  email }            — signed in, request filed, awaiting a decision
//   { status: 'banned',   email }            — signed in, but blocked
//   { status: 'offline' }                    — can't reach the server; session is kept
//   { status: 'signed_out' }                 — no valid session
async function getGateStatus(_retried) {
  _captureGateRedirect();

  // The gate only ever writes to localStorage, but read via
  // _readSbSession so an admin's sessionStorage password-session on
  // this same tab isn't mistaken for a customer session (it will
  // simply fail the allowed_emails check below and land on pending).
  const raw = _readSbSession();
  if (!raw) return { status: 'signed_out' };

  let session;
  try { session = JSON.parse(raw); } catch { localStorage.removeItem('sb_session'); return { status: 'signed_out' }; }
  if (!session.access_token) { localStorage.removeItem('sb_session'); return { status: 'signed_out' }; }
  const loginAt = session.login_at || 0;

  // Validate against Supabase's server — cannot be spoofed locally.
  let user = await _gateFetchUser(session.access_token);
  if ((!user || user.net) && session.refresh_token) {
    const refreshed = await _refreshOnce(session.refresh_token);
    if (refreshed && refreshed.net) return { status: 'offline' };
    if (refreshed && refreshed.access_token) {
      session = { ...refreshed, login_at: loginAt }; // a token refresh isn't a new login
      localStorage.setItem('sb_session', JSON.stringify(session));
      user = await _gateFetchUser(session.access_token);
    }
  }
  if (user && user.net) return { status: 'offline' };
  if (!user || !user.email) {
    // Another tab or an in-flight refresh may have rotated the token while we
    // were checking. Use that newer session instead of logging the user out.
    const latest = _readSbSession();
    if (!_retried && latest && latest !== raw) return getGateStatus(true);
    localStorage.removeItem('sb_session');
    return { status: 'signed_out' };
  }

  // A store-wide "log everyone out" resets forceLogoutAt to now() — any
  // session that started before that point is stale, even if the token
  // itself is still technically valid.
  try {
    const cfg = await getStoreConfig();
    if (cfg.forceLogoutAt && cfg.forceLogoutAt > loginAt) {
      _markReturning(false);
      localStorage.removeItem('sb_session');
      return { status: 'signed_out' };
    }
  } catch { /* if we can't check, don't punish the user for a network hiccup */ }

  // The admin account always gets through the store gate, same as the
  // SQL policies' bypass — no need for it to go through the request list.
  if (user.email === 'satyam64136@gmail.com') return { status: 'approved', email: user.email, login_at: loginAt };

  // RLS only lets a signed-in user read their OWN row, so this reflects
  // the server's actual decision, not anything the client could fake.
  try {
    const rows = await sbGet('allowed_emails?email=eq.' + encodeURIComponent(user.email) + '&select=status');
    if (Array.isArray(rows) && rows.length > 0) {
      const s = rows[0].status;
      if (s === 'approved') return { status: 'approved', email: user.email, login_at: loginAt };
      if (s === 'banned')   return { status: 'banned',   email: user.email };
      return { status: 'pending', email: user.email };
    }
    // First time this email has signed in — file a pending request so
    // it shows up in the admin's Access tab without any manual step.
    await sbPost('allowed_emails', { email: user.email, status: 'pending' }).catch(() => {});
  } catch (e) {
    // Any failure to read the list means "couldn't check", never "not approved".
    return { status: 'offline' };
  }

  return { status: 'pending', email: user.email };
}

async function signOutGate() {
  const raw = _readSbSession();
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s.access_token) {
        fetch(_GATE_AUTH_URL + '/logout?scope=local', {
          method: 'POST',
          headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.access_token },
        }).catch(() => {});
      }
    } catch {}
  }
  _markReturning(false);
  localStorage.removeItem('sb_session');
  window.location.reload();
}


/* ═══════════════════════════════════════════════════════
   Auto-update
   GitHub Pages lets browsers reuse a page for up to 10 minutes, so after a
   deploy many devices keep running the old version. Here a page compares the
   copy it loaded (browser cache) with the one on the server. If they differ it
   refreshes its own files and reloads once, with no manual refreshing.
   ═══════════════════════════════════════════════════════ */
const _UPD_FILES = [location.pathname, 'shared.js', 'style.css'];

async function _updSig(url, mode) {
  try {
    const res = await fetch(url, { cache: mode, method: mode === 'no-store' ? 'HEAD' : 'GET' });
    return res.headers.get('etag') || res.headers.get('last-modified') || '';
  } catch { return ''; }
}

async function _hasNewVersion() {
  for (const f of _UPD_FILES) {
    const [cached, live] = await Promise.all([_updSig(f, 'force-cache'), _updSig(f, 'no-store')]);
    if (cached && live && cached !== live) return true;
  }
  return false;
}

async function _applyUpdate() {
  // At most one automatic reload every 2 minutes, so a CDN hiccup can never loop.
  if (Date.now() - Number(sessionStorage.getItem('ys_upd') || 0) < 120000) return;
  sessionStorage.setItem('ys_upd', String(Date.now()));
  try { await Promise.all(_UPD_FILES.map(f => fetch(f, { cache: 'reload' }))); } catch { return; }
  if (typeof toast === 'function') toast('Updating to the latest version…');
  setTimeout(() => location.reload(), 600);
}

let _updChecking = false;
async function checkForUpdate() {
  if (_updChecking || !navigator.onLine) return;
  const pay = document.getElementById('view-payment');
  if (pay && pay.classList.contains('active')) return;              // never interrupt a payment
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;   // never wipe something being typed
  _updChecking = true;
  try { if (await _hasNewVersion()) await _applyUpdate(); } finally { _updChecking = false; }
}

window.addEventListener('load', () => setTimeout(checkForUpdate, 1500));
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setInterval(checkForUpdate, 5 * 60 * 1000);
