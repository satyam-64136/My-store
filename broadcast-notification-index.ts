// Supabase Edge Function: broadcast-notification
//
// Called by the admin panel's "Send to All". Sends a push notification to every
// device in customer_push_subscriptions and removes devices the push service
// says are gone. Admin only.
//
// Deploy:  supabase functions deploy broadcast-notification
// Uses the same VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets as
// send-order-push. Optional secret: ADMIN_EMAIL (defaults to the admin below).

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:satyam64136@gmail.com";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "satyam64136@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Only the admin may broadcast. Ask Supabase Auth who the caller really is.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const user = who.ok ? await who.json() : null;
    if (!user || user.email !== ADMIN_EMAIL) return json({ error: "Admins only" }, 403);

    const { title, message } = await req.json();
    const body = String(message || "").trim().slice(0, 180);
    if (!body) return json({ error: "Message is required" }, 400);

    const payload = JSON.stringify({
      type: "broadcast",
      title: String(title || "").trim().slice(0, 60) || "Store update",
      body,
    });

    const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/customer_push_subscriptions?select=*`, { headers: svc });
    const subs = await subsRes.json();
    if (!Array.isArray(subs)) return json({ error: "Could not load subscribers" }, 500);

    let sent = 0;
    await Promise.all(
      subs.map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent++;
        } catch (err: any) {
          // 404/410: the device uninstalled or revoked permission. Stop sending to it.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/customer_push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
              { method: "DELETE", headers: svc },
            );
          }
        }
      }),
    );

    return json({ sent, total: subs.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
