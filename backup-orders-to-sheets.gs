// ═══════════════════════════════════════════════════════════
//  Satyam's Store — Orders Backup & Automation
//  Supabase → Google Sheets & Daily Auto-Close
// ═══════════════════════════════════════════════════════════

var ORDERS_SHEET = 'Orders';
var SB_URL       = 'https://jrmctduwylpeicjcbmqs.supabase.co';
// IMPORTANT: Use a SERVICE_ROLE KEY here for admin actions, not a public key.
// Go to Supabase -> Settings -> API -> Project API keys -> service_role (secret)
var SB_KEY       = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L'; // <--- REPLACE THIS

// ===========================================================
//  1. Backup New Approved Orders to Google Sheet
// ===========================================================
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
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR fetching orders: HTTP ' + response.getResponseCode() + ' — ' + response.getContentText());
    return;
  }

  var orders = JSON.parse(response.getContentText());
  if (!orders || orders.length === 0) {
    Logger.log('No new approved orders since id=' + lastSyncId + '.');
    return;
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(ORDERS_SHEET);
    sheet.appendRow(['id', 'items', 'total', 'status', 'created_at']);
    sheet.setFrozenRows(1);
  }
  sheet.getRange('E:E').setNumberFormat('@'); // Treat date string as text

  var newMaxId = lastSyncId;
  orders.forEach(function(order) {
    var itemsStr = (order.items || []).map(function(i) { return i.name + ' x' + i.qty; }).join(', ');
    sheet.appendRow([order.id, itemsStr, parseFloat(order.total) || 0, order.status, _utcToIST(order.created_at)]);
    if (order.id > newMaxId) newMaxId = order.id;
  });

  props.setProperty('last_synced_order_id', String(newMaxId));
  Logger.log('Appended ' + orders.length + ' orders. Last synced id is now ' + newMaxId + '.');
}

function _utcToIST(utcStr) {
  if (!utcStr) return '';
  try {
    var d = new Date(utcStr.replace(/\.\d+/, '').replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '') + 'Z');
    return Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm');
  } catch (e) {
    return utcStr;
  }
}

// ===========================================================
//  2. Daily Auto-Close Logic (runs via time trigger)
// ===========================================================
function autoCloseStoreDaily() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { // Wait max 30s for lock
    Logger.log('autoCloseStoreDaily skipped: lock busy.');
    return;
  }
  
  try {
    var now = new Date();
    var nowHHMM = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm');
    var todayStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');

    var getRes = UrlFetchApp.fetch(SB_URL + '/rest/v1/settings?key=eq.store_config&select=value', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      muteHttpExceptions: true
    });

    if (getRes.getResponseCode() !== 200) {
      Logger.log('Auto-close failed: Could not fetch settings. HTTP ' + getRes.getResponseCode());
      return;
    }

    var rows = JSON.parse(getRes.getContentText());
    if (!rows || !rows[0] || !rows[0].value) {
        Logger.log('Auto-close failed: store_config not found in settings.');
        return;
    }
    
    var config = rows[0].value;
    
    // Check if automation should run
    if (config.autoCloseEnabled !== true || config.storeStatus !== 'open' || !config.autoCloseTime) {
      Logger.log('Auto-close skipped: Conditions not met (enabled: ' + config.autoCloseEnabled + ', status: ' + config.storeStatus + ').');
      return;
    }

    // Check if it's time to trigger and if it hasn't already run today
    if (nowHHMM === config.autoCloseTime && config.lastAutoCloseDate !== todayStr) {
      Logger.log('Auto-closing store for ' + todayStr + ' at ' + nowHHMM);
      
      var newConfig = {
        ...config,
        storeStatus: 'closed',
        lastAutoCloseDate: todayStr
      };

      var patchRes = UrlFetchApp.fetch(SB_URL + '/rest/v1/settings?key=eq.store_config', {
        method: 'PATCH',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        payload: JSON.stringify({ value: newConfig }),
        muteHttpExceptions: true,
      });

      if (patchRes.getResponseCode() !== 204) {
        Logger.log('Auto-close PATCH failed: HTTP ' + patchRes.getResponseCode() + ' ' + patchRes.getContentText());
      } else {
        Logger.log('SUCCESS: Store auto-closed via script.');
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Utility to run from editor to reset the backup sync state
function resetOrderSync() {
  PropertiesService.getScriptProperties().deleteProperty('last_synced_order_id');
  Logger.log('Order sync reset. Next run will start from order ID 0.');
}