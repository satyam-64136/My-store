<div align="center">

<img src="icon.png" width="120" height="120" style="border-radius:28px" alt="Tether"/>

# Tether

**A private, two-person messaging app — built entirely from scratch**

[![Live](https://img.shields.io/badge/live-satyam--64136.github.io%2FTether-b86070?style=flat-square&logo=github)](https://satyam-64136.github.io/Tether/)
[![PWA](https://img.shields.io/badge/PWA-installable-5e9af0?style=flat-square)](https://satyam-64136.github.io/Tether/)
[![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Supabase-6ebd8a?style=flat-square)]()
[![Zero deps](https://img.shields.io/badge/frontend%20deps-zero-c4a468?style=flat-square)]()

</div>

---

## What is this?

**Tether** is a real-time private messaging PWA built for exactly two people. No accounts. No app store. No third-party SDKs in the frontend. Just a single HTML file, a Supabase backend, and a service worker — delivering a native app experience entirely through the browser.

Open the link, tap "Add to Home Screen", and it installs as a full-screen app with true Web Push notifications, voice messages, video sharing, link previews, and realtime sync — indistinguishable from a native app.

> Built solo as a personal project. Every feature was designed, engineered, and debugged from scratch.


---

## Features

### Messaging
- **Real-time chat** via Supabase Realtime — zero polling, instant delivery
- **Image & video sharing** — send photos and videos, tap to view fullscreen
- **Voice messages** — hold mic button to record, waveform visualizer, tap to play/stop
- **Link previews** — auto-detects URLs, fetches OG title + image via proxy
- **Swipe to reply** — right swipe on any bubble, reply bar mirrors WhatsApp UX
- **Swipe for options** — left swipe opens action menu for that message
- **Edit messages** — long-press → Edit, amber edit bar, updates in Supabase with "edited" label
- **Emoji reactions** — WhatsApp-style reaction pill with 5 recent emojis + "+" to open native emoji keyboard; reactions toggle on/off, yours highlighted in accent color
- **Soft delete** — shows "this message was deleted" rather than removing the bubble
- **Copy message** — one tap from context menu
- **Multiline input** — Enter adds a newline, send only via the send button

### UX
- **Read receipts** — ✓ sent → ✓✓ delivered → gold ✓✓ seen
- **Typing indicator** — live, disappears after 2 seconds of inactivity
- **Online / Last seen** — updates every 30s, stale-detection after 45s (survives phone kill/crash)
- **Long-press multi-select** — hold any bubble to enter select mode, bulk delete, only your own messages
- **Scroll pagination** — loads last 25 messages on boot, fetches older pages as you scroll up without losing position
- **Scroll-to-bottom button** — floating pill appears when scrolled more than 300px from bottom
- **10 themes** — Dusty Rose (default), Midnight, Soft Violet, Rose Pink, Navy Blue, Classic Dark, Sage Green, Aurora, Soft Lavender, Warm Peach — synced across both devices in real time
- **Custom wallpaper** — upload once, syncs to both phones via Supabase storage automatically
- **Install prompt** — smart install button in menu with native Chrome install dialog; iOS manual instructions shown on Safari

### Notifications
- **True Web Push** — uses VAPID + `PushManager` API; notifications arrive even when the app is fully closed and the browser is not running, via Supabase Edge Function as the push relay
- **No duplicate notifications** — all notifications route through the SW only; `new Notification()` fallback removed; SW checks `visibilityState` before firing
- **No stale notifications** — watermark timestamp only ever moves forward; SW skips messages sent before the user's last active timestamp
- **SW background polling** — 25s fallback polling as a safety net on top of Web Push

### Technical
- **Device-locked identity** — `localStorage` binding, no login, no passwords, one-time setup
- **Auto-updates** — SW network-first strategy detects new GitHub Pages deploys silently; neither user ever manually refreshes
- **Reconnect without flicker** — on Realtime channel drop, fetches only missed messages (`catchupMsgs`) — no full re-render, no flash
- **Keyboard-aware layout** — `visualViewport` resize listener repositions header, messages, and input when the soft keyboard opens; header is `position:fixed` and never disappears
- **Theme-aware status bar** — `<meta theme-color>` + `apple-mobile-web-app-status-bar-style` updated dynamically on every theme switch
- **True fullscreen** — `viewport-fit=cover` + `black-translucent` on iOS; `position:fixed` body prevents browser chrome leaking
- **Performance-optimised** — GPU compositing (`will-change: transform`) on animated elements; `backdrop-filter` stripped on ≤360px screens; `prefers-reduced-motion` respected; scroll area uses `-webkit-overflow-scrolling: touch`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS — zero frameworks, zero npm, one HTML file |
| Database | Supabase (Postgres + Realtime) |
| Storage | Supabase Storage (images, voice, video, wallpaper) |
| Push relay | Supabase Edge Function (Deno) |
| Hosting | GitHub Pages |
| Notifications | Web Push API (VAPID) + SW fallback polling |
| Font | Geist by Vercel |
| Design | Liquidmorphism — frosted glass, radial gradient meshes, 10 themes |

**Frontend bundle size: ~0 KB** (no build step, no bundler, no framework)

---

## Architecture

```
Browser (PWA)
│
├── index.html            # Entire app — 2,900+ lines, zero dependencies
│   ├── CSS               # 10 themes via CSS custom properties, liquidmorphism
│   ├── Layout engine     # visualViewport listener, all elements position:fixed
│   └── Supabase JS       # Loaded from CDN at runtime
│
├── sw.js                 # Service Worker
│   ├── Network-first caching (always fresh code, auto-update)
│   ├── Web Push handler (receives from Edge Function via VAPID)
│   ├── SHOW_NOTIF handler (page → SW when tab is hidden)
│   └── visibilityState guard (no duplicate notifications)
│
└── manifest.json         # PWA manifest — standalone, custom icon, scoped to /Tether/
```

```
Supabase (Backend)
│
├── messages          id, sender, content, image_url, reply_to,
│                     seen, reactions, deleted, voice, video,
│                     edited, created_at
├── presence          username, last_seen, online
├── settings          key/value — theme, wallpaper URL
└── push_subscriptions  username, subscription (JSON), updated_at
```

```
Notification flow
│
├── Tab hidden, message arrives via Realtime
│   └── page → postMessage SHOW_NOTIF → SW → showNotification()
│
└── App fully closed, message inserted in DB
    └── Supabase DB webhook → Edge Function → Web Push API → SW push event → showNotification()
```

---

## How It Works

**No traditional auth.** On first open, each device picks an identity (Satyam / Snks) and locks to it via `localStorage`. No passwords, no OAuth, no session management. Two devices, two people, done.

**Realtime without polling.** Supabase Realtime streams Postgres changes over WebSocket. New messages appear instantly on both devices with zero interval polling in the foreground.

**True Web Push.** When a message is inserted, a Supabase Edge Function fires, looks up the recipient's push subscription from the `push_subscriptions` table, and sends a VAPID-signed Web Push payload. The browser's push service delivers it to the device even when Chrome isn't running — same mechanism used by native apps.

**Keyboard-aware layout.** Every element in the chat (`header`, `messages`, `reply bar`, `input row`) is `position:fixed`. A `visualViewport` resize listener recalculates `top`/`bottom` pixel values on every keyboard open/close, so the layout never breaks on Android or iOS.

**Updates silently.** The service worker uses network-first fetch. Every GitHub Pages deploy is picked up automatically. When a new SW version installs it sends `SKIP_WAITING` and silently reloads — neither user ever has to refresh.

**Pagination without flicker.** Boot loads the last 25 messages. Scrolling to the top triggers `loadOlderMsgs()` which fetches the previous page, snapshots `scrollHeight` before prepending DOM nodes, then restores `scrollTop + delta` so the viewport doesn't jump.

**Reaction toggle.** `{emoji: count}` structure in Supabase is unchanged. Each device tracks which emojis it has reacted with in `localStorage` per message. Tapping an emoji you already reacted with decrements the count and removes your entry — otherwise increments.

---

## Setup

### 1. Supabase tables

```sql
create table messages (
  id uuid default gen_random_uuid() primary key,
  sender text not null,
  content text,
  image_url text,
  reply_to uuid references messages(id),
  seen boolean default false,
  reactions jsonb default '{}',
  deleted boolean default false,
  voice boolean default false,
  video boolean default false,
  edited boolean default false,
  created_at timestamptz default now()
);
alter publication supabase_realtime add table messages;

create table presence (
  username text primary key,
  last_seen timestamptz default now(),
  online boolean default false
);
alter publication supabase_realtime add table presence;

create table settings (key text primary key, value text);
alter publication supabase_realtime add table settings;

create table push_subscriptions (
  username text primary key,
  subscription jsonb not null,
  updated_at timestamptz default now()
);

insert into storage.buckets (id, name, public) values ('images', 'images', true);

create policy "all" on messages for all using (true) with check (true);
create policy "all" on presence for all using (true) with check (true);
create policy "all" on settings for all using (true) with check (true);
create policy "all" on push_subscriptions for all using (true) with check (true);
create policy "storage" on storage.objects for all
  using (bucket_id='images') with check (bucket_id='images');
```

### 2. Generate VAPID keys

```bash
node generate-vapid.js
```

Paste the public key into `index.html`:
```js
const VAPID_PUBLIC_KEY = 'your-public-key-here';
```

Add the private key and Supabase service role key to your Edge Function environment.

### 3. Deploy Edge Function

```bash
supabase functions deploy push-notify
```

Set up a Database Webhook in Supabase: `messages` table → `INSERT` event → Edge Function URL.

### 4. Configure index.html

```js
const SU = 'your-supabase-project-url';
const SK = 'your-supabase-anon-key';
```

### 5. Deploy to GitHub Pages

Push to GitHub with Pages enabled. Update `manifest.json` and `sw.js` with your repo name:
```json
"start_url": "/your-repo/",
"scope": "/your-repo/"
```

---

## Install as App

**Android (Chrome)** — Open in Chrome → tap ⋮ → Add to Home Screen → Install  
Or use the Install button inside the app menu.

**iOS (Safari)** — Open in Safari → tap Share ⎙ → Add to Home Screen → Add

Launches fullscreen, no browser bar, separate from the browser, with its own app icon.

---

## Project Stats

| Metric | Value |
|---|---|
| Total files | 3 + 1 Edge Function (`index.html`, `sw.js`, `manifest.json`, `push-notify/index.ts`) |
| Frontend lines of code | ~2,900 |
| JS functions | 90+ |
| Frontend dependencies | **0** |
| Build step | **None** |
| Framework | **None** |

---

## What I Learned

Building this without any framework forced me to implement from scratch: realtime state sync, DOM reconciliation without a virtual DOM, service worker lifecycle and caching strategies, Web Push with VAPID key generation and subscription management, PWA install APIs and manifest configuration, audio recording with `MediaRecorder` and canvas waveform rendering, video handling, CSS custom property theming across 10 themes, mobile touch gesture handling (swipe directions, long-press, multi-select), `visualViewport` keyboard-aware layout, scroll pagination without position jump, and background push notifications via both SW polling and Edge Function relay.

The constraint of "one HTML file, no dependencies" turned out to be a feature — the app loads instantly, updates silently, and runs on any device with a browser.

---

<div align="center">

Built by [Satyam](https://github.com/satyam-64136) &nbsp;·&nbsp; BTech CS @ DIT University, Dehradun

</div>
