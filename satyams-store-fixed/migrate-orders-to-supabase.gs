// ═══════════════════════════════════════════════════════════
//  Satyam's Store — ONE-TIME Order Migration
//  Google Sheets (old sales history) → Supabase orders table
//
//  YOUR OLD SHEET STRUCTURE (date-named tabs, e.g. "20/3/2026"):
//    Column A: Date   (e.g. "20/3/2026")
//    Column B: Time   (e.g. "11:30:00 PM" or "23:30:00")
//    Column C: Items  (e.g. "KitKat x2 (₹40), Dairy Milk x1 (₹20)")
//    Column D: Total  (e.g. 60)
//    Row 1 is the header — skipped automatically
//
//  HOW TO RUN:
//  1. Open the Google Spreadsheet that has your old sales data
//  2. Extensions → Apps Script → paste this entire file into Code.gs
//  3. Set DATE_SHEET_NAMES below to list all your date-tab names
//     OR set AUTO_DETECT = true to scan all sheets automatically
//  4. Click Run → migrateOrdersToSupabase
//  5. Check Execution Log for results
//  6. Safe to re-run — duplicates are detected and skipped
// ═══════════════════════════════════════════════════════════

var SB_URL = 'https://jrmctduwylpeicjcbmqs.supabase.co';
var SB_KEY = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

// ── OPTION A: Auto-detect all date-named sheets ──────────────
// Set to true to automatically scan every sheet tab whose name
// looks like a date (contains "/" e.g. "20/3/2026").
// Set to false and fill DATE_SHEET_NAMES manually instead.
var AUTO_DETECT = true;

// ── OPTION B: List sheet tab names manually ──────────────────
// Only used if AUTO_DETECT = false.
// Example: ['20/3/2026', '21/3/2026', '22/3/2026']
var DATE_SHEET_NAMES = [];

// ── Sheet to SKIP (these are not sales date sheets) ──────────
var SKIP_SHEETS = ['Products', 'PendingOrders', 'Orders', 'Sheet1'];

// ─────────────────────────────────────────────────────────────

function migrateOrdersToSupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Decide which sheets to read
  var sheetNames = [];
  if (AUTO_DETECT) {
    var all = ss.getSheets();
    all.forEach(function(sh) {
      var name = sh.getName();
      if (SKIP_SHEETS.indexOf(name) === -1 && name.indexOf('/') !== -1) {
        sheetNames.push(name);
      }
    });
    Logger.log('Auto-detected date sheets: ' + sheetNames.join(', '));
  } else {
    sheetNames = DATE_SHEET_NAMES;
  }

  if (sheetNames.length === 0) {
    Logger.log('No date sheets found. Check AUTO_DETECT or DATE_SHEET_NAMES.');
    return;
  }

  // 2. Fetch all existing orders from Supabase so we can skip duplicates.
  //    We use a fingerprint: rounded_total + ":" + created_at_date
  //    Two orders with the same total on the same date are extremely unlikely
  //    to be duplicates, but we also match on items string for extra safety.
  Logger.log('Fetching existing orders from Supabase for dedup check...');
  var existing = fetchExistingFingerprints();
  if (existing === null) return; // fetch failed, already logged
  Logger.log('Found ' + Object.keys(existing).length + ' existing orders in Supabase.');

  // 3. Read each sheet and collect orders
  var toInsert = [];
  var skipped  = 0;
  var errors   = 0;

  sheetNames.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('WARN: Sheet "' + sheetName + '" not found, skipping.');
      return;
    }

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return; // empty or header only

    for (var i = 1; i < data.length; i++) {
      var row = data[i];

      // Column mapping (0-indexed): A=0 Date, B=1 Time, C=2 Items, D=3 Total
      var dateVal  = String(row[0] || '').trim();
      var timeVal  = String(row[1] || '').trim();
      var itemsVal = String(row[2] || '').trim();
      var totalVal = parseFloat(row[3]) || 0;

      if (!dateVal || !itemsVal) continue; // skip blank rows

      // Build created_at ISO string in UTC from IST date+time
      var createdAt = buildISOFromIST(dateVal, timeVal);
      if (!createdAt) {
        Logger.log('WARN: Could not parse date/time: "' + dateVal + '" / "' + timeVal + '" — skipping row ' + (i+1) + ' in ' + sheetName);
        errors++;
        continue;
      }

      // Parse items string into JSONB array
      var itemsArr = parseItemsString(itemsVal);

      // Build dedup fingerprint
      var fingerprint = buildFingerprint(createdAt, totalVal, itemsVal);
      if (existing[fingerprint]) {
        skipped++;
        continue;
      }

      toInsert.push({
        items:      itemsArr,
        total:      totalVal,
        status:     'approved',   // old sales are completed orders
        created_at: createdAt,
      });

      // Mark as seen so if the same row appears in multiple sheets we don't double-insert
      existing[fingerprint] = true;
    }
  });

  Logger.log('Rows to insert: ' + toInsert.length + '  |  Skipped (already exist): ' + skipped + '  |  Parse errors: ' + errors);

  if (toInsert.length === 0) {
    Logger.log('Nothing to insert. Migration complete.');
    return;
  }

  // 4. Insert in batches of 50 (keeps each request small)
  var BATCH = 50;
  var inserted = 0;
  for (var b = 0; b < toInsert.length; b += BATCH) {
    var batch = toInsert.slice(b, b + BATCH);
    var ok = insertBatch(batch);
    if (ok) {
      inserted += batch.length;
      Logger.log('Inserted batch ' + (Math.floor(b/BATCH)+1) + ' (' + batch.length + ' orders).');
    } else {
      Logger.log('ERROR inserting batch starting at index ' + b + '. Stopping.');
      break;
    }
  }

  Logger.log('DONE. ' + inserted + ' orders migrated to Supabase.');
}

// ── Convert IST date + time strings → UTC ISO string ──────────
// Date examples: "20/3/2026", "20/03/2026", "3/20/2026"
// Time examples: "11:30:00 PM", "23:30:00", "11:30 PM"
function buildISOFromIST(dateStr, timeStr) {
  try {
    // Parse date — handle DD/MM/YYYY or D/M/YYYY
    var dp = dateStr.split('/');
    if (dp.length !== 3) return null;

    var day, month, year;
    // en-IN format is DD/MM/YYYY
    day   = parseInt(dp[0], 10);
    month = parseInt(dp[1], 10);
    year  = parseInt(dp[2], 10);

    // Basic sanity: if month > 12, assume MM/DD/YYYY
    if (month > 12) { var tmp = day; day = month; month = tmp; }
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

    // Parse time
    var hours = 0, minutes = 0, seconds = 0;
    if (timeStr) {
      var upper = timeStr.toUpperCase().trim();
      var isPM  = upper.indexOf('PM') !== -1;
      var isAM  = upper.indexOf('AM') !== -1;
      var timePart = upper.replace('AM','').replace('PM','').trim();
      var tp = timePart.split(':');
      hours   = parseInt(tp[0], 10) || 0;
      minutes = parseInt(tp[1], 10) || 0;
      seconds = parseInt(tp[2], 10) || 0;
      if (isPM && hours !== 12) hours += 12;
      if (isAM && hours === 12) hours  = 0;
    }

    // Build as IST moment then convert to UTC
    // IST = UTC + 5h30m, so UTC = IST - 5h30m
    var IST_MS = 19800000; // 5.5 * 60 * 60 * 1000
    var istMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);
    var utcMs = istMs - IST_MS;
    return new Date(utcMs).toISOString();
  } catch(e) {
    return null;
  }
}

// ── Parse "KitKat x2 (₹40), Dairy Milk x1 (₹20)" → array ─────
function parseItemsString(str) {
  if (!str) return [];
  // Each item matches: "Name x<qty> (<currency><price>)"
  var result = [];
  // Split on ", " but be careful of commas inside names
  // Strategy: split on the pattern ", Anything x<number>"
  var parts = str.split(/,\s*(?=[^,]+\s+x\d)/);
  parts.forEach(function(part) {
    part = part.trim();
    if (!part) return;
    // Match: "Name x2 (₹40)" or "Name x2 (Rs.40)"
    var m = part.match(/^(.+?)\s+x(\d+)\s*[\(\[](.*?)[\)\]]$/);
    if (m) {
      var name = m[1].trim();
      var qty  = parseInt(m[2], 10) || 1;
      // Sub may contain ₹, Rs., etc.
      var sub  = parseFloat(m[3].replace(/[^\d.]/g, '')) || 0;
      result.push({ name: name, qty: qty, sub: sub });
    } else {
      // Can't parse structure — store as single item with full string as name
      var total = parseFloat(part.replace(/[^\d.]/g, '')) || 0;
      result.push({ name: part, qty: 1, sub: total });
    }
  });
  return result.length ? result : [{ name: str, qty: 1, sub: 0 }];
}

// ── Dedup fingerprint ─────────────────────────────────────────
function buildFingerprint(createdAt, total, itemsStr) {
  // Use date portion of ISO + total + first 30 chars of items
  var datePart = createdAt ? createdAt.substring(0, 10) : '';
  return datePart + '|' + total + '|' + itemsStr.substring(0, 30);
}

// ── Fetch existing order fingerprints from Supabase ───────────
function fetchExistingFingerprints() {
  var url = SB_URL + '/rest/v1/orders?select=created_at,total,items&order=id.asc';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('ERROR fetching existing orders: HTTP ' + res.getResponseCode());
    Logger.log(res.getContentText());
    return null;
  }
  var rows = JSON.parse(res.getContentText());
  var map  = {};
  rows.forEach(function(r) {
    var itemsStr = '';
    if (Array.isArray(r.items)) {
      itemsStr = r.items.map(function(i){ return i.name + ' x' + i.qty + ' (Rs.' + i.sub + ')'; }).join(', ');
    } else if (typeof r.items === 'string') {
      itemsStr = r.items;
    }
    var fp = buildFingerprint(r.created_at, parseFloat(r.total) || 0, itemsStr);
    map[fp] = true;
  });
  return map;
}

// ── Insert a batch of orders into Supabase ────────────────────
function insertBatch(orders) {
  var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/orders', {
    method:  'post',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    payload:            JSON.stringify(orders),
    muteHttpExceptions: true,
  });
  var status = res.getResponseCode();
  if (status === 200 || status === 201 || status === 204) return true;
  Logger.log('Batch insert failed: HTTP ' + status + ' — ' + res.getContentText());
  return false;
}
