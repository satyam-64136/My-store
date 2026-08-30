// Supabase Edge Function: send-order-push
//
// Triggered by a Database Webhook on INSERT into `orders`.
// Looks up every stored push subscription and sends a notification
// to each one. Dead subscriptions (device uninstalled the app, or the
// push service says it's gone) get cleaned up automatically.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:satyam64136@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Supabase Database Webhook payload shape:
    // { type: "INSERT", table: "orders", record: {...}, schema: "public" }
    const order = payload.record;
    if (!order) return new Response("no record in payload", { status: 400 });

    const itemsArr = Array.isArray(order.items) ? order.items : [];
    const itemCount = itemsArr.reduce((a: number, i: any) => a + (parseInt(i.qty, 10) || 0), 0);
    const body = `₹${Number(order.total).toFixed(2)} · ${itemCount} item${itemCount === 1 ? "" : "s"}`;

    const notifPayload = JSON.stringify({
      title: "New order!",
      body,
      orderId: String(order.id),
    });

    // Service-role key bypasses RLS — safe here because this function only
    // ever runs server-side, invoked by Supabase's own webhook system.
    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    const subs = await subsRes.json();

    await Promise.all(
      (subs || []).map(async (sub: any) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        try {
          await webpush.sendNotification(subscription, notifPayload);
        } catch (err: any) {
          // 404/410 = the push service says this subscription is dead
          // (app uninstalled, browser data cleared, etc.) — remove it so
          // we stop wasting a request on it every future order.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
              {
                method: "DELETE",
                headers: {
                  apikey: SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                },
              }
            );
          }
        }
      })
    );

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
