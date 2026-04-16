// ═══════════════════════════════════════════════════════════
//  Satyam's Store — Shared Utility Functions
//  Used by both index.html and admin.html
// ═══════════════════════════════════════════════════════════

const SB_URL = 'https://jrmctduwylpeicjcbmqs.supabase.co';
// ⚠️  If you see auth errors, regenerate your anon key in Supabase Dashboard →
//     Project Settings → API, and paste the new key here.
const SB_KEY = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

/* ── Supabase Helpers ────────────────────────────────── */
async function sbRequest(path, method = 'GET', body = null) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
  };
  // Needed for POST/PATCH to return the upserted row(s) instead of empty 201/204
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=representation';
  }
  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  };

  let res;
  try {
    res = await fetch(`${SB_URL}/rest/v1/${path}`, options);
  } catch (networkErr) {
    const err = new Error('Network error — check your internet connection and try again.');
    err.type = 'network';
    throw err;
  }

  if (!res.ok) {
    let errorText = '';
    try { errorText = await res.text(); } catch(_) {}
    let msg, type;
    if (res.status === 401 || res.status === 403) {
      msg = 'API key error — open Supabase Dashboard → Project Settings → API and paste a fresh anon key into shared.js.';
      type = 'auth';
    } else if (res.status === 404) {
      msg = 'Table not found — make sure the Supabase table exists and RLS allows reads.';
      type = 'notfound';
    } else if (res.status >= 500) {
      msg = 'Supabase server error — try again in a moment.';
      type = 'server';
    } else {
      msg = `Request failed (${res.status})${errorText ? ': ' + errorText.slice(0, 120) : ''}.`;
      type = 'unknown';
    }
    const err = new Error(msg);
    err.type = type;
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null; // No content for PATCH/DELETE
  return res.json();
}

const sbGet = (path) => sbRequest(path, 'GET');
const sbPost = (path, body) => sbRequest(path, 'POST', body);
const sbPatch = (path, body) => sbRequest(path, 'PATCH', body);
const sbDelete = (path) => sbRequest(path, 'DELETE');

const _DEFAULT_CONFIG = { storeStatus: 'open', autoCloseEnabled: false, autoCloseTime: '03:00', lastAutoCloseDate: '' };

async function getStoreConfig() {
  try {
    const data = await sbGet('settings?key=eq.store_config&select=value');
    if (data && data.length > 0) {
      // Merge with defaults so any missing keys never cause undefined errors
      return { ..._DEFAULT_CONFIG, ...(data[0].value || {}) };
    }
    // Row doesn't exist yet — create it silently so future reads/writes work
    try {
      await sbRequest('settings', 'POST', { key: 'store_config', value: _DEFAULT_CONFIG });
    } catch (_) { /* ignore duplicate / permission errors */ }
    return { ..._DEFAULT_CONFIG };
  } catch (error) {
    console.error("Failed to get store config:", error);
    // Return safe open default — don't block the UI with a toast on first load
    return { ..._DEFAULT_CONFIG };
  }
}

async function setStoreConfig(patch) {
  const currentConfig = await getStoreConfig();
  const newConfig = { ...currentConfig, ...patch };
  // Use PATCH with upsert header so it works whether the row exists or not
  try {
    await sbRequest(
      'settings?key=eq.store_config',
      'PATCH',
      { value: newConfig }
    );
  } catch (e) {
    // Fallback: insert if PATCH fails (row truly missing)
    try {
      await sbRequest('settings', 'POST', { key: 'store_config', value: newConfig });
    } catch (_) {}
  }
  return newConfig;
}


/* ── Caching Helpers ─────────────────────────────────── */
const _cacheKey = (k) => `ss_cache_${k}`;
const _cacheGet = (key) => {
  const item = localStorage.getItem(key);
  if (!item) return null;
  try {
    const { timestamp, data } = JSON.parse(item);
    if (Date.now() - timestamp > 3 * 60 * 1000) { // 3 min cache
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch { return null; }
};
const _cacheSet = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
};
const _cacheInvalidate = (keyPrefix) => {
  try {
    const fullKey = _cacheKey(keyPrefix);
    localStorage.removeItem(fullKey);
  } catch {}
};

/* ── UI & Utility Helpers ────────────────────────────── */
let toastTimeout;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 2200);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => {
      loader.style.display = 'none';
    }, 500);
  }
}

function placeholderSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-3.086-3.086a2 2 0 0 0-2.828 0L6 22"/><path d="m15.5 6-3-3a2 2 0 0 0-2.828 0L2 11.5"/><path d="m14 17 5.3-5.3a2 2 0 0 0 0-2.828L12 1.5"/><path d="m2 2 5.07-5.07"/><path d="m22 22-5.07 5.07"/></svg>`;
}

function parseProducts(rows) {
  return (rows || []).map(p => ({
    id: String(p.id),
    name: p.name || 'Unnamed Product',
    price: parseFloat(p.price) || 0,
    stock: parseInt(p.stock, 10) || 0,
    image: p.image || ''
  }));
}

function cleanSheetVal(val) {
  if (!val) return '';
  try {
    // Attempt to parse as ISO string first for accuracy
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val); // Fallback for non-standard formats
    const hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  } catch (e) {
    return String(val);
  }
}

function istDateStr(val) {
    if (!val) return '';
    try {
        const d = new Date(val);
        if (isNaN(d.getTime())) return '';
        // Manually format to dd/mm/yyyy to avoid locale issues
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    } catch {
        return '';
    }
}