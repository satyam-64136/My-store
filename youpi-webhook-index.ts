// Supabase Edge Function: youpi-webhook
// Receives YouPI PG's signed SUCCESS webhook and marks the matching order paid.
// Deploy:  supabase functions deploy youpi-webhook --no-verify-jwt
// Secret:  supabase secrets set YOUPI_WEBHOOK_SECRET=<secret from YouPI admin>
// Then set the YouPI webhook URL to  https://<project>.supabase.co/functions/v1/youpi-webhook

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("YOUPI_WEBHOOK_SECRET")!;

const enc = new TextEncoder();

async function sign(raw: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return "sha256=" + [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // HMAC must be computed over the raw bytes, before any JSON parsing.
  const raw = new Uint8Array(await req.arrayBuffer());
  const got = req.headers.get("x-gateway-signature") || "";
  if (!safeEqual(got, await sign(raw))) return new Response("invalid signature", { status: 401 });

  let p: any;
  try { p = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("bad json", { status: 400 }); }
  if (p.event !== "SUCCESS" || !p.orderId) return new Response("ignored", { status: 200 });

  const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const ref = encodeURIComponent(String(p.orderId));

  const found = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_ref=eq.${ref}&select=id,total,paid`, { headers });
  const rows = await found.json();
  const order = rows?.[0];
  if (!order) return new Response("order not found", { status: 404 });
  if (order.paid) return new Response("already paid", { status: 200 }); // webhook retries are safe

  // The amount actually received must cover the order total.
  if (Math.round(Number(order.total) * 100) > Number(p.amountPaise)) {
    return new Response("amount mismatch", { status: 409 });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}&paid=eq.false`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ paid: true, payment_ref: String(p.utr || "") }),
  });
  return new Response(res.ok ? "ok" : "update failed", { status: res.ok ? 200 : 500 });
});
