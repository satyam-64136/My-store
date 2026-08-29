// ═══════════════════════════════════════════════════════
//  Satyam's Store — Google Apps Script Backend
//  Paste into Code.gs → Run setupSheets() → Deploy as Web App
// ═══════════════════════════════════════════════════════

var PRODUCTS_SHEET = "Products";
var PENDING_SHEET  = "PendingOrders";

// ── GET ─────────────────────────────────────────────────
function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "getProducts") {
    var sheet = ss.getSheetByName(PRODUCTS_SHEET);
    if (!sheet) return jsonOut([]);
    var values = sheet.getDataRange().getValues();
    values.shift();
    return jsonOut(values.filter(function(r){ return r[0] !== "" && r[1] !== ""; }));
  }

  if (action === "getPendingOrders") {
    var sheet = ss.getSheetByName(PENDING_SHEET);
    if (!sheet) return jsonOut([]);
    var values = sheet.getDataRange().getDisplayValues();
    values.shift();
    // Only return rows with status = "pending"
    var pending = values.filter(function(r){ return r[6] === "pending"; });
    return jsonOut(pending);
  }

  if (action === "getSales") {
    var today = new Date().toLocaleDateString("en-IN");
    var sheet = ss.getSheetByName(today);
    if (!sheet) return jsonOut([]);
    var values = sheet.getDataRange().getDisplayValues();
    values.shift();
    return jsonOut(values);
  }

  if (action === "getSalesByDate") {
    var date = e.parameter.date || new Date().toLocaleDateString("en-IN");
    var sheet = ss.getSheetByName(date);
    if (!sheet) return jsonOut([]);
    var values = sheet.getDataRange().getDisplayValues();
    values.shift();
    return jsonOut(values);
  }

  return jsonOut({ error: "Unknown action: " + action });
}

// ── POST ────────────────────────────────────────────────
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {};
  try { data = JSON.parse(e.postData.contents); }
  catch(err) { return okOut("Bad JSON"); }

  var action = data.action;

  // ── addProduct ──
  if (action === "addProduct") {
    var sheet = ss.getSheetByName(PRODUCTS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(PRODUCTS_SHEET);
      sheet.appendRow(["ID","Name","Price","Stock","Image","Barcode"]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([Date.now(), data.name||"", parseFloat(data.price)||0, parseInt(data.stock,10)||0, data.image||"", data.barcode||""]);
    return okOut("Product added");
  }

  // ── deleteProduct ──
  if (action === "deleteProduct") {
    var sheet = ss.getSheetByName(PRODUCTS_SHEET);
    if (!sheet) return okOut("Not found");
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) { sheet.deleteRow(i+1); return okOut("Deleted"); }
    }
    return okOut("ID not found");
  }

  // ── pendingOrder — save without touching stock ──
  if (action === "pendingOrder") {
    var sheet = ss.getSheetByName(PENDING_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(PENDING_SHEET);
      sheet.appendRow(["OrderID","Date","Time","Items","Total","Products","Status"]);
      sheet.setFrozenRows(1);
    }
    var orderId = "ORD-" + Date.now();
    var productsJson = JSON.stringify(data.products || []);
    sheet.appendRow([orderId, data.date||"", data.time||"", data.items||"", data.total||"", productsJson, "pending"]);
    return okOut("Order saved: " + orderId);
  }

  // ── approveOrder — record sale + deduct stock + mark approved ──
  if (action === "approveOrder") {
    var orderId  = data.orderId || "";
    var date     = data.date    || "";
    var time     = data.time    || "";
    var items    = data.items   || "";
    var total    = data.total   || "";
    var products = data.products || [];

    // 1. Record sale in date-named sheet
    var salesSheet = ss.getSheetByName(date);
    if (!salesSheet) {
      salesSheet = ss.insertSheet(date);
      salesSheet.appendRow(["Date","Time","Items","Total"]);
      salesSheet.setFrozenRows(1);
    }
    salesSheet.appendRow([date, time, items, total]);

    // 2. Deduct stock
    if (products.length > 0) {
      var prodSheet = ss.getSheetByName(PRODUCTS_SHEET);
      if (prodSheet) {
        var rows = prodSheet.getDataRange().getValues();
        products.forEach(function(p) {
          for (var i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === String(p.id)) {
              var newStock = Math.max(0, (parseInt(rows[i][3],10)||0) - (parseInt(p.qty,10)||0));
              prodSheet.getRange(i+1, 4).setValue(newStock);
              break;
            }
          }
        });
      }
    }

    // 3. Mark order as approved in PendingOrders sheet
    var pendingSheet = ss.getSheetByName(PENDING_SHEET);
    if (pendingSheet && orderId) {
      var pRows = pendingSheet.getDataRange().getValues();
      for (var i = 1; i < pRows.length; i++) {
        if (String(pRows[i][0]) === String(orderId)) {
          pendingSheet.getRange(i+1, 7).setValue("approved");
          break;
        }
      }
    }

    return okOut("Order approved");
  }

  // ── rejectOrder — mark as rejected, no stock change, no sale recorded ──
  if (action === "rejectOrder") {
    var sheet = ss.getSheetByName(PENDING_SHEET);
    if (!sheet) return okOut("Sheet not found");
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.orderId)) {
        sheet.getRange(i + 1, 7).setValue("rejected");
        return okOut("Order rejected");
      }
    }
    return okOut("ID not found");
  }

  // ── updateStock — update stock value for a product ──
  if (action === "updateStock") {
    var sheet = ss.getSheetByName(PRODUCTS_SHEET);
    if (!sheet) return okOut("Products sheet not found");
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        var newStock = Math.max(0, parseInt(data.stock, 10) || 0);
        sheet.getRange(i + 1, 4).setValue(newStock);
        return okOut("Stock updated");
      }
    }
    return okOut("ID not found");
  }

  // ── recordSale (legacy direct sale, kept for compatibility) ──
  if (action === "recordSale") {
    var date  = data.date  || "";
    var time  = data.time  || "";
    var items = data.items || "";
    var total = data.total || "";
    var products = data.products || [];
    var salesSheet = ss.getSheetByName(date);
    if (!salesSheet) {
      salesSheet = ss.insertSheet(date);
      salesSheet.appendRow(["Date","Time","Items","Total"]);
      salesSheet.setFrozenRows(1);
    }
    salesSheet.appendRow([date, time, items, total]);
    if (products.length > 0) {
      var prodSheet = ss.getSheetByName(PRODUCTS_SHEET);
      if (prodSheet) {
        var rows = prodSheet.getDataRange().getValues();
        products.forEach(function(p) {
          for (var i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === String(p.id)) {
              var newStock = Math.max(0, (parseInt(rows[i][3],10)||0) - (parseInt(p.qty,10)||0));
              prodSheet.getRange(i+1, 4).setValue(newStock);
              break;
            }
          }
        });
      }
    }
    return okOut("Sale recorded");
  }

  return okOut("Unknown action: " + action);
}

// ── Helpers ─────────────────────────────────────────────
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function okOut(msg) {
  return ContentService.createTextOutput(msg||"OK").setMimeType(ContentService.MimeType.TEXT);
}

// ── Run ONCE before first deploy ─────────────────────────
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(PRODUCTS_SHEET)) {
    var p = ss.insertSheet(PRODUCTS_SHEET);
    p.appendRow(["ID","Name","Price","Stock","Image","Barcode"]);
    p.setFrozenRows(1);
  }
  if (!ss.getSheetByName(PENDING_SHEET)) {
    var o = ss.insertSheet(PENDING_SHEET);
    o.appendRow(["OrderID","Date","Time","Items","Total","Products","Status"]);
    o.setFrozenRows(1);
  }
  Logger.log("Setup complete!");
}
