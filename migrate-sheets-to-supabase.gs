// ═══════════════════════════════════════════════════════════
//  Satyam's Store — ONE-TIME Migration
//  Google Sheets Products  →  Supabase
//
//  RUN THIS ONCE to import your existing product data.
//  After migration, this script is no longer needed.
//
//  ── WHY THE PREVIOUS VERSION FAILED ──────────────────────
//  The Supabase "id" column is GENERATED ALWAYS AS IDENTITY.
//  Postgres does not allow inserting values into that column
//  at all — not even with upsert. We must NEVER send "id".
//  Supabase auto-assigns the id for every new row.
//
//  ── SETUP (do this before running) ────────────────────────
//  1. Open your Google Spreadsheet
//  2. Go to Extensions → Apps Script
//  3. Paste this entire file into Code.gs (replace everything)
//  4. Check SHEET_NAME below matches your Products tab name
//  5. Check your sheet columns match this layout:
//       Column A: id      (old numeric id — IGNORED, not sent)
//       Column B: name
//       Column C: price   (numeric)
//       Column D: stock   (integer)
//       Column E: image   (URL, can be blank)
//       Row 1 is the header row — skipped automatically
//  6. Click Run → migrateToSupabase
//  7. Read the Execution Log for results
//
//  ── IF YOUR COLUMNS ARE IN A DIFFERENT ORDER ──────────────
//  Edit the column index numbers inside migrateToSupabase().
//  Columns are 0-indexed: A=0, B=1, C=2, D=3, E=4
//
//  ── DEDUPLICATION ─────────────────────────────────────────
//  The script inserts products one by one and skips any
//  product whose name already exists in Supabase.
//  It is safe to re-run — already-migrated products are
//  left untouched.
// ═══════════════════════════════════════════════════════════

var SHEET_NAME = 'Products';  // ← change if your tab name is different
var SB_URL     = 'https://jrmctduwylpeicjcbmqs.supabase.co';
var SB_KEY     = 'sb_publishable_E3W5FNr_zAmej5fLElsvCA_OeDkde6L';

function migrateToSupabase() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('ERROR: Sheet "' + SHEET_NAME + '" not found.');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('Sheet is empty (no data rows). Nothing to migrate.');
    return;
  }

  // ── Step 1: Fetch names that already exist in Supabase ─────
  // So we can skip duplicates without failing
  var existingNames = getExistingProductNames();
  if (existingNames === null) return; // fetch failed, already logged

  // ── Step 2: Build product list from sheet (no "id" field) ──
  var products = [];
  var skipped  = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    // Column mapping — change the index numbers if your sheet
    // has columns in a different order (0=A, 1=B, 2=C …)
    var name  = String(row[1] || '').trim();  // Column B
    var price = parseFloat(row[2]) || 0;      // Column C
    var stock = parseInt(row[3], 10);         // Column D
    var image = String(row[4] || '').trim();  // Column E
    // Column A (row[0]) is the old id — intentionally ignored

    if (!name) { skipped++; continue; }
    if (isNaN(stock) || stock < 0) stock = 0;

    if (existingNames.indexOf(name.toLowerCase()) !== -1) {
      Logger.log('SKIP (already exists): ' + name);
      skipped++;
      continue;
    }

    // Do NOT include "id" — Supabase auto-assigns it
    products.push({ name: name, price: price, stock: stock, image: image });
  }

  Logger.log('Found ' + products.length + ' new products to insert. ' + skipped + ' skipped.');

  if (products.length === 0) {
    Logger.log('Nothing to insert. Migration complete.');
    return;
  }

  // ── Step 3: Insert all new products in one POST ─────────────
  var options = {
    method:  'post',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',  // no upsert — plain insert
    },
    payload:            JSON.stringify(products),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(SB_URL + '/rest/v1/products', options);
  var status   = response.getResponseCode();

  if (status === 200 || status === 201 || status === 204) {
    Logger.log('SUCCESS: ' + products.length + ' products inserted into Supabase.');
    Logger.log('Migration complete. This script can be deleted or kept for reference.');
  } else {
    Logger.log('ERROR: HTTP ' + status);
    Logger.log('Response: ' + response.getContentText());
    Logger.log('Tip: make sure RLS is disabled on the products table in Supabase.');
  }
}

// ── Helper: returns lowercase names already in Supabase ────────
function getExistingProductNames() {
  var options = {
    method:  'get',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
    },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(
    SB_URL + '/rest/v1/products?select=name',
    options
  );

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR fetching existing products: HTTP ' + response.getResponseCode());
    Logger.log(response.getContentText());
    return null;
  }

  var rows = JSON.parse(response.getContentText());
  return rows.map(function(r) { return String(r.name || '').trim().toLowerCase(); });
}
