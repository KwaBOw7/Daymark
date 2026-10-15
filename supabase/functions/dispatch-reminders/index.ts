// Run on a schedule (once per minute). Requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, PUSH_CRON_SECRET and the Supabase environment injected by Supabase.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('PUSH_CRON_SECRET');
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
webpush.setVapidDetails(subject, publicKey || '', privateKey || '');
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!cronSecret || request.headers.get('x-daymark-cron-secret') !== cronSecret) return new Response('Unauthorized', { status: 401 });
  if (!publicKey || !privateKey) return Response.json({ error: 'VAPID keys are not configured.' }, { status: 503 });
  const { data: due, error } = await db.rpc('claim_due_reminders', { p_limit: 25 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0, failed = 0;
  for (const reminder of due || []) {
    const { data: subscriptions, error: lookupError } = await db.from('push_subscriptions').select('id,endpoint,subscription').eq('user_id', reminder.user_id);
    if (lookupError) { failed++; await db.from('reminder_queue').update({ attempts: reminder.attempts + 1, claimed_until: null, last_error: lookupError.message }).eq('id', reminder.id); continue; }
    let delivered = false; let lastError = 'No active push subscription is registered for this account.';
    for (const sub of subscriptions || []) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({ title: reminder.title, body: reminder.body, url: '/', tag: `daymark-${reminder.dedupe_key}` }), { TTL: 3600 });
        delivered = true;
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        lastError = e.message || 'Web Push delivery failed';
        if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
    const result = await db.from('reminder_queue').update({ delivered_at: delivered ? new Date().toISOString() : null, attempts: reminder.attempts + 1, claimed_until: null, last_error: delivered ? null : lastError }).eq('id', reminder.id);
    if (result.error || !delivered) failed++; else sent++;
    // Claims are atomic across overlapping Cron invocations; failed rows retry after their lease is released, up to five attempts.
  }
  return Response.json({ processed: (due || []).length, sent, failed });
});
