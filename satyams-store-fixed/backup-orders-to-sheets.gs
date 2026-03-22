// ═══════════════════════════════════════════════════════════
//  Satyam's Store — Orders Backup
//  Supabase Orders  →  Google Sheets (append-only, one-way)
// ═══════════════════════════════════════════════════════════

var ORDERS_SHEET = 'Orders';
var SB_URL       = 'https://jrmctduwylpeicjcbmqs.supabase.co';
var SB_KEY       = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

function backupOrdersToSheets() {
  var props      = PropertiesService.getScriptProperties();
  var lastSyncId = parseInt(props.getProperty('last_synced_order_id') || '0', 10);

  var url = SB_URL + '/rest/v1/orders'
    + '?status=eq.approved'
    + '&id=gt.' + lastSyncId
    + '&order=id.asc'
    + '&select=id,items,total,status,created_at';

  var options = {
    method:  'get',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
    },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var status   = response.getResponseCode();

  if (status !== 200) {
    Logger.log('ERROR fetching orders: HTTP ' + status + ' — ' + response.getContentText());
    return;
  }

  var orders = JSON.parse(response.getContentText());

  if (!orders || orders.length === 0) {
    Logger.log('No new approved orders since id=' + lastSyncId + '. Nothing to append.');
    return;
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ORDERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ORDERS_SHEET);
    sheet.appendRow(['id', 'items', 'total', 'status', 'created_at']);
    sheet.setFrozenRows(1);
    Logger.log('Created "' + ORDERS_SHEET + '" sheet with headers.');
  }

  // Force column E to plain text so Sheets never auto-parses our date string
  sheet.getRange('E:E').setNumberFormat('@');

  var newMaxId = lastSyncId;
  var appended = 0;

  orders.forEach(function(order) {
    var orderId   = order.id;
    var total     = parseFloat(order.total) || 0;
    var statusVal = order.status || 'approved';

    // ── THE FIX: convert UTC → IST before writing ──────────────
    // Root cause: Supabase stores UTC. Orders placed between
    // 12:00 AM–5:29 AM IST have a UTC date of the previous day.
    // Writing the raw UTC string causes Sheets to show the wrong date.
    // Solution: convert to IST (UTC+5:30) using manual arithmetic on
    // UTC fields — zero runtime-timezone interference.
    var createdAt = utcStringToIST(order.created_at);

    var itemsArr = Array.isArray(order.items) ? order.items : [];
    var itemsStr = itemsArr
      .map(function(i) { return i.name + ' x' + i.qty + ' (Rs.' + i.sub + ')'; })
      .join(', ');

    sheet.appendRow([orderId, itemsStr, total, statusVal, createdAt]);
    appended++;
    if (orderId > newMaxId) newMaxId = orderId;
  });

  props.setProperty('last_synced_order_id', String(newMaxId));
  Logger.log('Appended ' + appended + ' orders. Last synced id is now ' + newMaxId + '.');
}

// ── Convert UTC ISO string → IST date-time string ────────────────
// Uses only UTC methods after adding +5:30 offset — no runtime
// timezone involvement at any step. Guaranteed correct regardless
// of Apps Script project timezone setting.
//
// Input:  "2026-03-22T19:30:00+00:00"  (UTC, stored by Supabase)
// Output: "23/03/2026 01:00 AM"        (IST, correct for user)
function utcStringToIST(utcStr) {
  if (!utcStr) return '';

  // Normalise to unambiguous UTC: strip sub-seconds and ±HH:MM offset, add Z
  var clean = utcStr
    .replace(/\.\d+/, '')           // remove milliseconds
    .replace(/[+-]\d{2}:\d{2}$/, '') // remove +00:00 / +05:30 etc.
    .replace(/Z$/, '');              // remove existing Z if present
  var d = new Date(clean + 'Z');    // parse as explicit UTC

  if (isNaN(d.getTime())) {
    Logger.log('WARN: could not parse timestamp: ' + utcStr);
    return utcStr;
  }

  // Add IST offset: +5 hours 30 minutes = 19800 seconds = 19800000 ms
  var ist = new Date(d.getTime() + 19800000);

  // Read date components using UTC accessors (on the already-shifted time)
  var dd   = pad(ist.getUTCDate());
  var mo   = pad(ist.getUTCMonth() + 1);
  var yyyy = ist.getUTCFullYear();
  var hh   = ist.getUTCHours();
  var min  = pad(ist.getUTCMinutes());
  var ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;

  return dd + '/' + mo + '/' + yyyy + ' ' + pad(hh) + ':' + min + ' ' + ampm;
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

function resetAndRebuild() {
  PropertiesService.getScriptProperties().deleteProperty('last_synced_order_id');
  Logger.log('Reset complete. Run backupOrdersToSheets() to re-download all approved orders.');
}
