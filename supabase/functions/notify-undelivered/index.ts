// Coolibah Orders email service (deployed in Supabase as "quick-api").
// 1. Customer emails: the items missing from a delivery (lines ticked Not delivered, or delivered short).
//    The Receiver app calls this straight after Mark received; Admins and Managers can resend from the order.
// 2. Supplier emails (action "supplier"): the order form PDFs the Admin app builds, sent to the supplier's
//    active addresses under Emails. Admins and Managers only.
// 3. Order reminders (action "reminders"): shortly before each order cut-off (Administration › Cut-offs), customers
//    who haven't sent an order for that delivery get a reminder. Called every 10 minutes by the Supabase Cron job
//    (migrations/018, 026).
// 4. New-login SMS (action "new-login"): when someone signs up and is waiting to be activated, SMFW gets a text.
//    Called by the database the moment the login is made (migrations/022). Action "test-sms" sends a test text.
// Needs the RESEND_API_KEY secret (resend.com). Optional: FROM_EMAIL, REPLY_TO.
// Texts go through SMS Broadcast (smsbroadcast.com.au) and need the SMSBROADCAST_USERNAME and
// SMSBROADCAST_PASSWORD secrets, or the sms_username / sms_password settings in app_settings (migrations/022);
// SMSBROADCAST_FROM / sms_from (sender name, up to 11 letters/digits) is optional.
// Admins change these settings, and send a test text, under Administration > SMS in the app (migrations/024).
// The mobile number(s) are the sms_to setting in app_settings.
const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RESEND_URL = Deno.env.get('RESEND_URL') || 'https://api.resend.com/emails';
const FROM = Deno.env.get('FROM_EMAIL') || 'Coolibah Salads Sydney <orders@csorders.org>';
const REPLY_TO = Deno.env.get('REPLY_TO') || 'sales@cssydney.com.au';
const SMS_USER = Deno.env.get('SMSBROADCAST_USERNAME') || '';
const SMS_PASS = Deno.env.get('SMSBROADCAST_PASSWORD') || '';
const SMS_FROM = Deno.env.get('SMSBROADCAST_FROM') || '';
const SMS_URL = Deno.env.get('SMSBROADCAST_URL') || 'https://api.smsbroadcast.com.au/api-adv.php';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const orderNo = (n: number) => 'SO-' + String(n).padStart(4, '0');
const fmtDate = (d: string) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) : '';

type Line = { product_name: string; pack_name: string; qty: number; ordered_qty?: number; undelivered?: boolean };
// What the customer should hear about: everything not delivered, and anything delivered short.
export function missingLines(lines: Line[]) {
  return (lines || []).flatMap(l => {
    const ordered = Number(l.ordered_qty ?? l.qty) || 0, got = Number(l.qty) || 0;
    if (l.undelivered || got <= 0) return [{ ...l, ordered, got: 0, short: ordered, note: 'Not delivered' }];
    if (got < ordered) return [{ ...l, ordered, got, short: ordered - got, note: `Short ${ordered - got}` }];
    return [];
  });
}

export function emailFor(o: any, cust: any, missing: ReturnType<typeof missingLines>) {
  const subject = `Order ${orderNo(o.number)}: delivery shortages`;
  const td = 'padding:6px 10px;border-bottom:1px solid #e3e8e3', num = td + ';text-align:right';
  const rows = missing.map(m => `<tr><td style="${td}">${esc(m.product_name)}</td><td style="${td}">${esc(m.pack_name)}</td><td style="${num}">${m.ordered}</td><td style="${num}">${m.got}</td><td style="${num};color:#a5352b;font-weight:bold">${m.short}</td><td style="${td};color:#a5352b">${m.got ? 'Short supplied' : 'Not delivered'}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d241f">
<p>Dear Customer,</p>
<p>Your order <b>${orderNo(o.number)}</b>${o.required_date ? `, required ${esc(fmtDate(o.required_date))},` : ''} has been delivered, but the following ${missing.length === 1 ? 'item was' : 'items were'} short supplied or not delivered:</p>
<table style="border-collapse:collapse;font-size:14px"><thead><tr style="background:#eef3ee"><th style="padding:6px 10px;text-align:left">Product</th><th style="padding:6px 10px;text-align:left">Pack</th><th style="padding:6px 10px;text-align:right">Ordered</th><th style="padding:6px 10px;text-align:right">Supplied</th><th style="padding:6px 10px;text-align:right">Short</th><th style="padding:6px 10px;text-align:left"></th></tr></thead><tbody>${rows}</tbody></table>
<p>If you need these items replaced, just reply to this email or call us on 0417 375 591.</p>
<p>Regards,<br>Coolibah Salads Sydney<br>0417 375 591 · sales@cssydney.com.au</p></div>`;
  const text = `Dear Customer,\n\nYour order ${orderNo(o.number)}${o.required_date ? `, required ${fmtDate(o.required_date)},` : ''} has been delivered, but the following ${missing.length === 1 ? 'item was' : 'items were'} short supplied or not delivered:\n\n` +
    missing.map(m => `- ${m.product_name} (${m.pack_name}): ordered ${m.ordered}, supplied ${m.got}, short ${m.short}${m.got ? '' : ' (not delivered)'}`).join('\n') +
    `\n\nIf you need these items replaced, just reply to this email or call us on 0417 375 591.\n\nRegards,\nCoolibah Salads Sydney\n0417 375 591 · sales@cssydney.com.au\n`;
  return { subject, html, text };
}

// The addresses come from the database (Emails tab), not from the browser.
async function sendToSupplier({ supplier_id, subject, text, files }: { supplier_id: string; subject: string; text: string; files: { name: string; content: string }[] }) {
  const rows = await (await db(`supplier_emails?supplier_id=eq.${encodeURIComponent(supplier_id)}&active=eq.true&select=email,send_as&order=sort`)).json();
  const pick = (k: string) => (Array.isArray(rows) ? rows : []).filter((r: any) => r.send_as === k).map((r: any) => r.email);
  const to = pick('to'), cc = pick('cc'), bcc = pick('bcc');
  if (!to.length && !cc.length && !bcc.length) return reply({ sent: false, reason: 'No addresses are switched on for this supplier under Emails.' });
  if (!RESEND_KEY) return reply({ sent: false, reason: 'Email sending isn’t set up yet (RESEND_API_KEY is missing).' });
  if (!subject || !Array.isArray(files) || !files.length) return reply({ sent: false, reason: 'Nothing to send.' });
  const r = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: to.length ? to : cc.length ? cc : bcc, ...(to.length && cc.length ? { cc } : {}), ...(bcc.length && (to.length || cc.length) ? { bcc } : {}), reply_to: REPLY_TO, subject, text,
      attachments: files.map(f => ({ filename: f.name, content: f.content })) }) });
  if (!r.ok) return reply({ sent: false, reason: `The email service refused the message: ${(await r.text()).slice(0, 200)}` });
  return reply({ sent: true, to, cc, bcc });
}

// ---------- order reminders ----------
// The cut-off rules per product location live in cutoff_rules / cutoff_settings (Administration › Cut-offs, migrations/026).
// The job runs every 10 minutes; each cut-off gets one reminder, sent in the window set there (e.g. 10 minutes before).
// Until 026 is run, the old Organic rules apply: deliveries close 7:30am, the day before (Friday for Sunday and Monday).
const OLD_RULES = [[1, 'all', 3], [2, 'all', 1], [3, 'all', 1], [4, 'all', 1], [5, 'all', 1], [7, 'sunday', 2]]
  .map(([dow, delivers, days_before]) => ({ product_group: 'Organic', dow, delivers, days_before, cutoff_time: '07:30:00' }));
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toMins = (t: string) => +t.split(':')[0] * 60 + +t.split(':')[1];
const fmtTime = (t: string) => { const m = toMins(t), h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
export function sydneyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, dow: new Date(date + 'T12:00:00Z').getUTCDay(), minutes: +p.hour * 60 + +p.minute };
}
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export function reminderEmail(cust: any, delivery: string, hasDraft: boolean, group = 'Organic', time = '07:30') {
  const at = fmtTime(time);
  const day = fmtDate(delivery);
  const subject = `Reminder: order by ${at} today for ${day} delivery`;
  const lead = hasDraft ? `you have an order saved as a draft for ${esc(day)} delivery, but it hasn’t been sent yet` : `we haven’t received your order for ${esc(day)} delivery yet`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d241f">
<p>Dear Customer,</p>
<p>Just a reminder that ${lead}. ${group} orders for that delivery close at <b>${at} today</b>.</p>
<p><a href="https://csorders.org" style="display:inline-block;background:#2f6b3a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${hasDraft ? 'Open and send your order' : 'Place your order'}</a></p>
<p>If you don’t need a delivery that day, please ignore this email.</p>
<p>Regards,<br>Coolibah Salads Sydney<br>0417 375 591 · sales@cssydney.com.au</p></div>`;
  const text = `Dear Customer,\n\nJust a reminder that ${hasDraft ? `you have an order saved as a draft for ${day} delivery, but it hasn't been sent yet` : `we haven't received your order for ${day} delivery yet`}. ${group} orders for that delivery close at ${at} today.\n\n${hasDraft ? 'Open and send your order' : 'Place your order'} at https://csorders.org\n\nIf you don't need a delivery that day, please ignore this email.\n\nRegards,\nCoolibah Salads Sydney\n0417 375 591 · sales@cssydney.com.au\n`;
  return { subject, html, text };
}
// dry: list who would be reminded without sending. force: include every cut-off still to come today (Admin testing).
async function sendReminders({ dry = false, force = false, now }: { dry?: boolean; force?: boolean; now?: string }) {
  const t = sydneyNow(now ? new Date(now) : new Date());
  const rr = await db('cutoff_rules?select=*'), sr = await db('cutoff_settings?select=*');
  const rules: any[] = rr.ok ? await rr.json() : OLD_RULES, settings: any[] = sr.ok ? await sr.json() : [{ product_group: 'Organic', reminder_minutes: 10 }];
  // The cut-offs falling today whose reminder window is now: the delivery is days_before days ahead and on the rule's day.
  const due = rules.filter(r => {
    const mins = settings.find(x => x.product_group === r.product_group)?.reminder_minutes;
    if (!mins || r.delivers === 'none' || r.days_before == null || !r.cutoff_time) return false;
    const dow = new Date(addDays(t.date, r.days_before) + 'T12:00:00Z').getUTCDay() || 7, cut = toMins(r.cutoff_time);
    return dow === r.dow && (force ? t.minutes < cut : t.minutes >= cut - mins && t.minutes < cut);
  });
  if (!due.length) return reply({ skipped: 'No order cut-off is coming up.' });
  const custs: any[] = await (await db(`customers?reminders=eq.true&select=id,name,contact,email,sunday_delivery,product_group`)).json();
  const out: any[] = [];
  for (const d of due) {
    const delivery = addDays(t.date, d.days_before);
    const orders: any[] = await (await db(`orders?required_date=eq.${delivery}&customer_id=not.is.null&select=customer_id,status`)).json();
    const sent = new Set(orders.filter(o => o.status !== 'draft').map(o => o.customer_id)), drafts = new Set(orders.filter(o => o.status === 'draft').map(o => o.customer_id));
    const done = new Set(((await (await db(`reminder_log?delivery_date=eq.${delivery}&select=customer_id`)).json()) as any[]).map(r => r.customer_id));
    for (const c of custs) {
      if (![d.product_group, 'Both'].includes(c.product_group || 'Organic')) continue;
      if (d.delivers === 'sunday' && !c.sunday_delivery) continue;
      if (sent.has(c.id) || done.has(c.id)) continue;
      const to = String(c.email || '').split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      const row: any = { customer: c.name, group: d.product_group, delivery, to: to.join(', '), draft: drafts.has(c.id) };
      if (!to.length) { row.error = 'No email address'; out.push(row); continue; }
      if (dry) { out.push(row); continue; }
      let error = null;
      if (!RESEND_KEY) error = 'RESEND_API_KEY is missing';
      else {
        const { subject, html, text } = reminderEmail(c, delivery, drafts.has(c.id), d.product_group, d.cutoff_time);
        const r = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }) });
        if (!r.ok) error = (await r.text()).slice(0, 200);
      }
      await db('reminder_log', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ customer_id: c.id, delivery_date: delivery, sent_to: to.join(', '), error }) });
      done.add(c.id);
      out.push({ ...row, sent: !error, error });
    }
  }
  return reply({ day: t.date, dry, reminders: out });
}

// SMS Broadcast wants digits only: 0412 345 678 → 0412345678, +61 412 345 678 → 61412345678.
export const smsNumber = (n: string) => n.replace(/\D/g, '');
async function sendSms(text: string) {
  const set: Record<string, string> = Object.fromEntries((await (await db(`app_settings?key=like.sms_*&select=key,value`)).json()).map((r: any) => [r.key, r.value || '']));
  const user = SMS_USER || set.sms_username || '', pass = SMS_PASS || set.sms_password || '';
  const from = (SMS_FROM || set.sms_from || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
  const to = String(set.sms_to || '').split(/[,;]+/).map(n => n.trim()).filter(n => /\d{8,}/.test(n.replace(/\D/g, ''))).map(smsNumber);
  if (!to.length) return { sent: false, reason: 'No mobile number set (sms_to in app_settings).' };
  if (!user || !pass || /^YOUR /.test(user)) return { sent: false, reason: 'Texts aren’t set up yet (no SMS Broadcast username / password).' };
  const form = new URLSearchParams({ username: user, password: pass, to: to.join(','), from, message: text.slice(0, 300), ref: 'csorders', maxsplit: '2' });
  const r = await fetch(SMS_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  // One line back per number: "OK: 61412345678:2942263", "BAD:0412abc:Invalid Number" or a single "ERROR: ...".
  const out = (await r.text()).trim();
  const lines = out.split(/\r?\n/).filter(Boolean);
  const ok = r.ok && lines.length > 0 && lines.every(l => l.startsWith('OK'));
  return ok ? { sent: true, to } : { sent: false, reason: `SMS Broadcast refused the message: ${out.slice(0, 200)}` };
}
async function newLoginSms(id: string) {
  const [p] = await (await db(`profiles?id=eq.${encodeURIComponent(id)}&select=email,full_name,business,approved`)).json();
  if (!p) return reply({ sent: false, reason: 'Login not found.' });
  if (p.approved) return reply({ sent: false, reason: 'Already active.' });
  const who = [p.full_name, p.business].filter(Boolean).join(', ');
  return reply(await sendSms(`Coolibah Orders: new login to activate. ${who ? who + ' ' : ''}(${p.email}). Approve under Logins.`));
}

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // The scheduled reminder job proves itself with the private key stored in app_settings (migrations/018).
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey) {
      const [k] = await (await db(`app_settings?key=eq.cron_key&select=value`)).json();
      if (!k?.value || k.value !== cronKey) return reply({ error: 'Not allowed.' }, 403);
      const job = await req.json().catch(() => ({}));
      if (job.action === 'new-login') return await newLoginSms(String(job.id || ''));
      if (job.action === 'test-sms') return reply(await sendSms('Coolibah Orders: test text. New-login alerts will arrive like this.'));
      return await sendReminders({});
    }
    // Only signed-in Receivers, Managers and Admins may trigger an email.
    const auth = req.headers.get('Authorization') || '';
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
    if (!who.ok) return reply({ error: 'Please sign in again.' }, 401);
    const user = await who.json();
    const [me] = await (await db(`profiles?id=eq.${user.id}&select=role,approved`)).json();
    if (!me?.approved || !['receiver', 'manager', 'admin'].includes(me.role)) return reply({ error: 'Not allowed.' }, 403);

    const body = await req.json();
    if (body.action === 'reminders') {
      if (!['manager', 'admin'].includes(me.role)) return reply({ error: 'Not allowed.' }, 403);
      return await sendReminders({ dry: body.dry !== false, force: !!body.force, now: body.now });
    }
    if (body.action === 'test-sms') {
      if (me.role !== 'admin') return reply({ error: 'Not allowed.' }, 403);
      return reply(await sendSms('Coolibah Orders: test text. New-login alerts will arrive like this.'));
    }
    if (body.action === 'supplier') {
      if (!['manager', 'admin'].includes(me.role)) return reply({ error: 'Not allowed.' }, 403);
      return await sendToSupplier(body);
    }
    const { order_id, resend } = body;
    const [o] = await (await db(`orders?id=eq.${encodeURIComponent(order_id)}&select=id,number,required_date,lines,received_at,customer_notified_at,customer:customers(name,contact,email)`)).json();
    if (!o) return reply({ error: 'Order not found.' }, 404);
    const note = (fields: Record<string, unknown>) => db(`orders?id=eq.${o.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (!o.received_at) return reply({ sent: false, reason: 'This order hasn’t been marked received yet.' });
    const missing = missingLines(o.lines);
    if (!missing.length) return reply({ sent: false, reason: 'Everything on this order was delivered.' });
    if (o.customer_notified_at && !resend) return reply({ sent: false, reason: 'The customer has already been emailed.' });
    const to = String(o.customer?.email || '').split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!to.length) { const reason = o.customer ? 'This customer has no email address. Add one under Customers.' : 'This order has no customer to email.'; await note({ notify_error: reason }); return reply({ sent: false, reason }); }
    if (!RESEND_KEY) { const reason = 'Customer emails aren’t set up yet (RESEND_API_KEY is missing).'; await note({ notify_error: reason }); return reply({ sent: false, reason }); }

    const { subject, html, text } = emailFor(o, o.customer, missing);
    const r = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }) });
    if (!r.ok) { const reason = `The email service refused the message: ${(await r.text()).slice(0, 200)}`; await note({ notify_error: reason }); return reply({ sent: false, reason }); }
    await note({ customer_notified_at: new Date().toISOString(), customer_notified_to: to.join(', '), notify_error: null });
    return reply({ sent: true, to, items: missing.length });
  } catch (e) {
    return reply({ error: String((e as Error)?.message || e) }, 500);
  }
}

Deno.serve(handler);
