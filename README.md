# Satyam's Store — POS Web App

A lightweight, mobile-first point-of-sale web app for a small store. Built with vanilla HTML, CSS, and JavaScript. Uses Google Sheets as the database and Google Apps Script as the backend API. No frameworks, no build tools, no server required.

---

## Project Overview

Customers browse products, add items to a cart, and complete payment via UPI. Orders are saved as pending and must be approved by an admin before stock is deducted and the sale is recorded. The admin panel handles product management, stock control, order approval or rejection, and sales history — all from the same interface.

---

## File Structure

```
index.html              — Store (product grid) + Payment page (merged, view-toggled)
admin.html              — Admin panel + Sales history (merged, tab-switched)
style.css               — Full design system: layout, glassmorphism, animations, tokens
shared.js               — API helpers, toast, loader, utility functions
apps-script-backend.js  — Google Apps Script backend (paste into Code.gs and deploy)
```

The project was deliberately reduced from four HTML files to two. `index.html` uses a JS view toggle between the store and payment views. `admin.html` uses a tab switcher between Products & Orders and Sales History.

---

## Features

### Store
- Product grid loaded from Google Sheets
- Add/remove items from cart with quantity controls
- Stock-aware: blocks adding beyond available stock with a toast message
- Out-of-stock products are visually dimmed and labelled
- Cart summary (item count + total) visible in the fixed bottom bar at all times
- Proceed to payment button disabled until at least one item is in the cart

### Payment
- Order summary with itemised breakdown and total
- UPI payment via QR code (dynamically generated per-order amount)
- UPI ID displayed with a copy button
- Save QR button downloads the image directly to the device (no new tab)
- Confirm Order submits the order as pending — no stock is deducted at this point
- Success overlay confirms placement, then returns to the store

### Admin Panel
- Password-protected login (session-persisted)
- Two tabs: **Products & Orders** and **Sales History**
- Add new products (name, price, stock, image URL, barcode)
- Delete products with a confirmation modal
- Inline stock +/− controls per product row, mobile-friendly
- Stock stats summary (total products, out of stock, low stock ≤5, in stock)
- Pending orders list with Approve and Reject buttons per order
- Sales history filterable by date (last 30 days), with count, revenue, and average order stats

---

## UI/UX Highlights

- **Glassmorphism** on the navbar, bottom bar, product cards, modals, and payment cards — `backdrop-filter: blur()` with semi-transparent backgrounds
- **Fixed navbar** (`position: fixed; top: 0; z-index: 9999`) — always visible, never scrolls away
- **Fixed bottom bar** (`position: fixed; bottom: 0; z-index: 9999`) — always visible, never scrolls away
- **Content offset** — `padding-top` and `padding-bottom` on content containers prevent overlap with fixed bars
- **Smooth native scrolling** via `scroll-behavior: smooth` on `html`; no JS scroll libraries
- **Premium fonts** — Outfit (headings), DM Sans (body), JetBrains Mono (prices and numbers)
- **Subtle gradient background** — two faint radial gradients fixed to the viewport for depth
- **Claymorphism proceed button** — layered `box-shadow` gives a tactile, pressable feel
- **Card animations** — staggered `cardIn` on product grid load; `viewIn` fade on view/tab switches
- **Toast notifications** — fixed at `top: 72px` (just below the navbar), always visible regardless of scroll position, drops in from above

### Stock Status Colours
- Green dot — in stock
- Red dot — out of stock
- No amber/yellow used for stock states

---

## How It Works

### Data Flow

```
Google Sheets  ←→  Apps Script Web App  ←→  shared.js (fetch)  ←→  index.html / admin.html
```

- `gasGet(action, params)` — HTTP GET to the Apps Script URL, returns parsed JSON
- `gasPost(payload)` — HTTP POST with `mode: 'no-cors'` (fire-and-forget; response is opaque)

### View Switching (index.html)

`switchView('store' | 'payment')` toggles `.view.active` between the two views, hides/shows the correct nav, and controls bottom bar visibility. The bottom bar is outside both view containers so it is not affected by `display: none` on view switching.

### Tab Switching (admin.html)

`switchTab('admin' | 'sales')` swaps `.tab-panel.active`. Sales data is loaded lazily on first open of the Sales tab.

---

## Order Flow

```
Customer adds items → Proceeds to payment → Scans QR / copies UPI ID
→ Confirms order → Order saved to PendingOrders sheet (status: "pending") → Stock unchanged

Admin opens panel → Sees pending orders
→ Approve: records sale, deducts stock, marks "approved"
→ Reject: marks "rejected", no stock change, no sale recorded
```

Stock is only deducted on admin approval, never on customer order submission.

---

## Admin Panel — Functionality Detail

| Action | Behaviour |
|---|---|
| Login | Password checked client-side; session stored in `sessionStorage` |
| Add product | Appends a row to the Products sheet with a timestamp-based ID |
| Delete product | Removes the row from the Products sheet after confirmation |
| Adjust stock (+ / −) | Optimistic UI update, then `updateStock` POST to Apps Script |
| Approve order | Records sale in a date-named sheet, deducts stock, marks order "approved" |
| Reject order | Removes from local map immediately, marks order "rejected" in sheet — no stock or sale impact |
| Sales history | Reads from date-named sheets; filterable across the last 30 days |

---

## Google Apps Script — Backend Actions

| Action | Method | Description |
|---|---|---|
| `getProducts` | GET | Returns all rows from the Products sheet |
| `getPendingOrders` | GET | Returns rows from PendingOrders where status = "pending" |
| `getSalesByDate` | GET | Returns rows from the sheet named by the given date |
| `addProduct` | POST | Appends a new product row |
| `deleteProduct` | POST | Deletes a product row by ID |
| `pendingOrder` | POST | Saves a new order as pending (no stock change) |
| `approveOrder` | POST | Records sale, deducts stock, marks order approved |
| `rejectOrder` | POST | Marks order as rejected only |
| `updateStock` | POST | Sets stock value for a product by ID |

### Sheet Structure

**Products**
`ID | Name | Price | Stock | Image | Barcode`

**PendingOrders**
`OrderID | Date | Time | Items | Total | Products (JSON) | Status`

**Sales (date-named, e.g. "20/6/2025")**
`Date | Time | Items | Total`

### Setup

1. Open a Google Spreadsheet
2. Go to **Extensions → Apps Script**
3. Paste the contents of `apps-script-backend.js` into `Code.gs`
4. Run `setupSheets()` once to create the required sheets
5. Deploy as a **Web App** (execute as: Me, access: Anyone)
6. Copy the deployment URL into `shared.js` as `API_URL`

---

## Stock Management

- Stock is displayed on each product card with a coloured status dot
- Adding items beyond available stock shows a toast: *"Can't add more — out of stock"*
- Reaching the exact stock limit shows: *"Can't add more, stock limit reached"*
- Admin can adjust stock directly from the product table using + and − buttons
- Stock updates are optimistic (UI updates immediately), then synced to the sheet
- Stock can be set to zero; the out-of-stock state reflects immediately

---

## Payment — QR Download

The Save QR button uses `fetch()` to retrieve the QR image as a Blob, creates an object URL, and triggers a download anchor programmatically. This forces a direct file download and prevents the browser from opening the image in a new tab.

---

## Technical Notes

- `position: fixed` is used for both the navbar and bottom bar — not `sticky`
- No `transform` is applied to `<body>` — transforms on an ancestor break `position: fixed` by creating a new containing block
- No `overflow: hidden` on `html` or `body` — this was the primary cause of broken scroll on iOS
- `html { height: 100% }` is intentionally absent — constraining html height prevents document scroll
- POST requests use `mode: 'no-cors'` — responses are opaque and cannot be read; writes are fire-and-forget
- `sessionStorage` is used for cart persistence across the store/payment view toggle
- Context menu is disabled on the store page to prevent accidental image save on mobile
- The loader animation colours are preserved exactly as originally provided

---

## Known Constraints

- POST responses are always opaque (`no-cors`) — write failures are silent unless a subsequent GET reveals the change did not persist
- Google Apps Script has execution quotas; heavy concurrent use may hit rate limits
- The Apps Script deployment URL is hardcoded in `shared.js` — updating it requires a code change
- Sales history sheets are named by locale date string (`en-IN` format); date filtering depends on consistent locale between the client and the server
- No authentication on the customer-facing store — the admin password is the only access control
- The QR code is generated by a third-party service (`api.qrserver.com`); offline or unreachable network will show a spinner
