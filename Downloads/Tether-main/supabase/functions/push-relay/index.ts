import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_MAILTO = Deno.env.get('VAPID_MAILTO') || 'mailto:satyam64136@gmail.com';

webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if(req.method !== 'POST'){
    return new Response('ok', { status: 200 });
  }

  try {
    const payload = await req.json();
    console.log('Webhook received:', JSON.stringify(payload).slice(0, 200));

    const msg = payload.record;
    if(!msg) return new Response('no record', { status: 200 });
    if(payload.type !== 'INSERT') return new Response('not insert', { status: 200 });
    if(msg.deleted) return new Response('deleted', { status: 200 });

    const recipient = msg.sender === 'Satyam' ? 'Snks' : 'Satyam';
    console.log('Sender:', msg.sender, '→ Notifying:', recipient);

    const { data: row, error: fetchErr } = await sb
      .from('push_subscriptions')
      .select('subscription')
      .eq('username', recipient)
      .maybeSingle();

    if(fetchErr){ console.error('DB fetch error:', fetchErr); return new Response('db error', { status: 200 }); }
    if(!row?.subscription){ console.log('No subscription for', recipient); return new Response('no subscription', { status: 200 }); }

    let pushSub = row.subscription;
    if(typeof pushSub === 'string') pushSub = JSON.parse(pushSub);
    if(typeof pushSub === 'string') pushSub = JSON.parse(pushSub);

    let notifPayload: string;

    // ── RING MESSAGE ──
    if(msg.content === '[imy-ring]'){
      console.log('Ring push → ', recipient);
      notifPayload = JSON.stringify({
        type: 'ring',
        from: msg.sender,
        url: '/Tether/?ring=1&from=' + encodeURIComponent(msg.sender)
      });
    } else {
      // ── NORMAL MESSAGE ──
      const isVideo = /\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)/i.test(msg.image_url || '');
      const body = msg.doc_name ? `📎 ${msg.doc_name}`
                 : isVideo ? '🎥 sent a video'
                 : msg.image_url ? '📷 sent a photo'
                 : msg.content || '…';
      notifPayload = JSON.stringify({
        title: msg.sender,
        body,
        url: '/Tether/'
      });
    }

    console.log('Sending push to endpoint:', pushSub?.endpoint?.slice(0,50));
    try{
      await webpush.sendNotification(pushSub, notifPayload);
      console.log('Push sent successfully to', recipient);
    }catch(pushErr){
      console.error('webpush error:', pushErr?.statusCode, pushErr?.body, pushErr?.message);
      return new Response('push error', { status: 200 });
    }

    return new Response('sent', { status: 200 });

  } catch(err) {
    console.error('push-relay error:', err?.message || err);
    return new Response('error', { status: 200 });
  }
});
