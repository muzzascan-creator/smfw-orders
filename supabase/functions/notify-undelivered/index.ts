// Coolibah Orders email service (deployed in Supabase as "quick-api").
// 1. Customer emails: the items missing from a delivery (lines ticked Not delivered, or delivered short).
//    The Receiver app calls this straight after Mark received; Admins and Managers can resend from the order.
// 2. Supplier emails (action "supplier"): the order form PDFs the Admin app builds, sent to the supplier's
//    active addresses under Administration › Emails. Admins and Managers only.
// 3. Order reminders (action "reminders"): shortly before each order cut-off (Administration › Cut-offs), customers
//    who haven't sent an order for that delivery get a reminder. Called every 10 minutes by the Supabase Cron job
//    (migrations/018, 026).
// 4. New-login SMS (action "new-login"): when someone signs up and is waiting to be activated, SMFW gets a text,
//    straight away, one text per login. Called by the database the moment the login is made (migrations/022).
//    Action "test-sms" sends a test text.
// Needs the RESEND_API_KEY secret (resend.com). Optional: FROM_EMAIL, REPLY_TO.
// Texts go through SMS Broadcast (smsbroadcast.com.au). The username, password, sender and mobile number(s) are set
// under Administration › SMS in the app (app_settings sms_*, migrations/022 and 024). The SMSBROADCAST_USERNAME /
// _PASSWORD / _FROM secrets are only used where a setting is empty.
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
// A database call that must work: a failure stops the request with the database's own message (500).
async function dbOk(path: string, init: RequestInit = {}) {
  const r = await db(path, init);
  const body = await r.text();
  if (!r.ok) throw new Error(`Database: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}
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

export function emailFor(o: any, missing: ReturnType<typeof missingLines>) {
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

// The addresses come from the database (Administration › Emails), not from the browser.
async function sendToSupplier({ supplier_id, subject, text, files }: { supplier_id: string; subject: string; text: string; files: { name: string; content: string }[] }) {
  const rows: any[] = await dbOk(`supplier_emails?supplier_id=eq.${encodeURIComponent(supplier_id)}&active=eq.true&select=email,send_as&order=sort`);
  const pick = (k: string) => rows.filter(r => r.send_as === k).map(r => r.email);
  const to = pick('to'), cc = pick('cc'), bcc = pick('bcc');
  if (!to.length && !cc.length && !bcc.length) return reply({ sent: false, reason: 'No addresses are switched on for this supplier under Administration › Emails.' });
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
// The job runs every 10 minutes; each cut-off gets one reminder per customer and location (reminder_log, migrations/027),
// sent in the window set there (e.g. 10 minutes before). A cut-off just after midnight is reminded the evening before.
const toMins = (t: string) => +t.split(':')[0] * 60 + +t.split(':')[1];
const fmtTime = (t: string) => { const m = toMins(t), h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
export function sydneyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isoDow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay() || 7;
export function reminderEmail(delivery: string, hasDraft: boolean, group = 'Organic', time = '07:30', when = 'today') {
  const at = fmtTime(time);
  const day = fmtDate(delivery);
  const subject = `Reminder: order by ${at} ${when} for ${day} delivery`;
  const lead = hasDraft ? `you have an order saved as a draft for ${esc(day)} delivery, but it hasn’t been sent yet` : `we haven’t received your order for ${esc(day)} delivery yet`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d241f">
<p>Dear Customer,</p>
<p>Just a reminder that ${lead}. ${group} orders for that delivery close at <b>${at} ${when}</b>.</p>
<p><a href="https://csorders.org" style="display:inline-block;background:#2f6b3a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${hasDraft ? 'Open and send your order' : 'Place your order'}</a></p>
<p>If you don’t need a delivery that day, please ignore this email.</p>
<p>Regards,<br>Coolibah Salads Sydney<br>0417 375 591 · sales@cssydney.com.au</p></div>`;
  const text = `Dear Customer,\n\nJust a reminder that ${hasDraft ? `you have an order saved as a draft for ${day} delivery, but it hasn't been sent yet` : `we haven't received your order for ${day} delivery yet`}. ${group} orders for that delivery close at ${at} ${when}.\n\n${hasDraft ? 'Open and send your order' : 'Place your order'} at https://csorders.org\n\nIf you don't need a delivery that day, please ignore this email.\n\nRegards,\nCoolibah Salads Sydney\n0417 375 591 · sales@cssydney.com.au\n`;
  return { subject, html, text };
}
// dry: list who would be reminded without sending. force: every cut-off still to come today, without logging it,
// so the real reminder still goes later (Admin testing).
async function sendReminders({ dry = false, force = false, now }: { dry?: boolean; force?: boolean; now?: string }) {
  const t = sydneyNow(now ? new Date(now) : new Date());
  const rules: any[] = await dbOk('cutoff_rules?select=*'), settings: any[] = await dbOk('cutoff_settings?select=*');
  // Cut-offs today (day 0) or just after midnight (day 1) whose reminder window is now.
  const due = rules.flatMap(r => {
    const mins = settings.find(x => x.product_group === r.product_group)?.reminder_minutes;
    if (!mins || r.delivers === 'none' || r.days_before == null || !r.cutoff_time) return [];
    return [0, 1].flatMap(day => {
      const delivery = addDays(t.date, day + r.days_before), cut = day * 1440 + toMins(r.cutoff_time);
      if (isoDow(delivery) !== r.dow) return [];
      const now = force ? day === 0 && t.minutes < cut : t.minutes >= cut - mins && t.minutes < cut;
      return now ? [{ ...r, delivery, when: day ? 'tomorrow' : 'today' }] : [];
    });
  });
  if (!due.length) return reply({ skipped: 'No order cut-off is coming up.' });
  const custs: any[] = await dbOk(`customers?reminders=eq.true&select=id,name,email,sunday_delivery,product_group`);
  const groupOf = new Map(((await dbOk('products?select=id,product_group')) as any[]).map(p => [p.id, p.product_group || 'Organic']));
  const out: any[] = [];
  for (const d of due) {
    const g = d.product_group;
    // An order counts for a location when its products are from there (an empty order counts for both).
    const orders: any[] = (await dbOk(`orders?required_date=eq.${d.delivery}&customer_id=not.is.null&select=customer_id,status,lines`))
      .filter((o: any) => { const gs = (o.lines || []).map((l: any) => groupOf.get(l.product_id)).filter(Boolean); return !gs.length || gs.includes(g); });
    const sent = new Set(orders.filter(o => o.status !== 'draft').map(o => o.customer_id)), drafts = new Set(orders.filter(o => o.status === 'draft').map(o => o.customer_id));
    const done = new Set(((await dbOk(`reminder_log?delivery_date=eq.${d.delivery}&product_group=eq.${g}&select=customer_id`)) as any[]).map(r => r.customer_id));
    for (const c of custs) {
      if (![g, 'Both'].includes(c.product_group || 'Organic')) continue;
      if (d.delivers === 'sunday' && !c.sunday_delivery) continue;
      if (sent.has(c.id) || done.has(c.id)) continue;
      const to = String(c.email || '').split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      const row: any = { customer: c.name, group: g, delivery: d.delivery, to: to.join(', '), draft: drafts.has(c.id) };
      let error = to.length ? null : 'No email address';
      if (dry) { out.push(error ? { ...row, error } : row); continue; }
      if (!error && !RESEND_KEY) error = 'RESEND_API_KEY is missing';
      if (!error) {
        const { subject, html, text } = reminderEmail(d.delivery, drafts.has(c.id), g, d.cutoff_time, d.when);
        const r = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }) });
        if (!r.ok) error = (await r.text()).slice(0, 200);
      }
      // Logged once, even when it couldn't go (no address), so it isn't retried every 10 minutes.
      if (!force) await dbOk('reminder_log', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ customer_id: c.id, delivery_date: d.delivery, product_group: g, sent_to: to.join(', '), error }) });
      done.add(c.id);
      out.push({ ...row, sent: !error, error });
    }
  }
  return reply({ day: t.date, dry, reminders: out });
}

// SMS Broadcast wants digits only: 0412 345 678 → 0412345678, +61 412 345 678 → 61412345678.
export const smsNumber = (n: string) => n.replace(/\D/g, '');
async function sendSms(text: string) {
  const set: Record<string, string> = Object.fromEntries(((await dbOk(`app_settings?key=like.sms_*&select=key,value`)) as any[]).map(r => [r.key, r.value || '']));
  // The settings saved under Administration › SMS win; the secrets only fill gaps.
  const user = set.sms_username || SMS_USER, pass = set.sms_password || SMS_PASS;
  const from = (set.sms_from || SMS_FROM).replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
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
// One text for every new login, sent straight away; the text says how many are waiting.
async function newLoginSms(id: string) {
  const [p] = await dbOk(`profiles?id=eq.${encodeURIComponent(id)}&select=email,full_name,business,approved`);
  if (!p) return reply({ sent: false, reason: 'Login not found.' });
  if (p.approved) return reply({ sent: false, reason: 'Already active.' });
  const waiting = ((await dbOk('profiles?approved=eq.false&select=id')) as any[]).length;
  const who = [p.full_name, p.business].filter(Boolean).join(', ');
  return reply(await sendSms(`Coolibah Orders: new login to activate. ${who ? who + ' ' : ''}(${p.email}).${waiting > 1 ? ` ${waiting} logins are waiting.` : ''} Approve under Administration › Logins.`));
}

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // The scheduled reminder job proves itself with the private key stored in app_settings (migrations/018).
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey) {
      const [k] = await dbOk(`app_settings?key=eq.cron_key&select=value`);
      if (!k?.value || k.value !== cronKey) return reply({ error: 'Not allowed.' }, 403);
      const job = await req.json().catch(() => ({}));
      if (job.action === 'ping') return reply({ ok: true }); // setup check (supabase/checks)
      if (job.action === 'new-login') return await newLoginSms(String(job.id || ''));
      if (job.action === 'test-sms') return reply(await sendSms('Coolibah Orders: test text. New-login alerts will arrive like this.'));
      if (job.action === 'reminders') return await sendReminders({});
      return reply({ error: 'Unknown action.' }, 400);
    }
    // Only signed-in Receivers, Managers and Admins may trigger an email.
    const auth = req.headers.get('Authorization') || '';
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
    if (!who.ok) return reply({ error: 'Please sign in again.' }, 401);
    const user = await who.json();
    const [me] = await dbOk(`profiles?id=eq.${user.id}&select=role,approved`);
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
    if (!order_id) return reply({ error: 'Unknown action.' }, 400);
    if (resend && me.role === 'receiver') return reply({ error: 'Not allowed.' }, 403);
    const [o] = await dbOk(`orders?id=eq.${encodeURIComponent(order_id)}&select=id,number,required_date,lines,received_at,customer_notified_at,customer:customers(name,email)`);
    if (!o) return reply({ error: 'Order not found.' }, 404);
    const note = (fields: Record<string, unknown>) => dbOk(`orders?id=eq.${o.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields) });
    if (!o.received_at) return reply({ sent: false, reason: 'This order hasn’t been marked received yet.' });
    const missing = missingLines(o.lines);
    if (!missing.length) return reply({ sent: false, reason: 'Everything on this order was delivered.' });
    if (o.customer_notified_at && !resend) return reply({ sent: false, reason: 'The customer has already been emailed.' });
    const to = String(o.customer?.email || '').split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!to.length) { const reason = o.customer ? 'This customer has no email address. Add one under Customers.' : 'This order has no customer to email.'; await note({ notify_error: reason }); return reply({ sent: false, reason }); }
    if (!RESEND_KEY) { const reason = 'Customer emails aren’t set up yet (RESEND_API_KEY is missing).'; await note({ notify_error: reason }); return reply({ sent: false, reason }); }

    const { subject, html, text } = emailFor(o, missing);
    const r = await fetch(RESEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }) });
    if (!r.ok) { const reason = `The email service refused the message: ${(await r.text()).slice(0, 200)}`; await note({ notify_error: reason }); return reply({ sent: false, reason }); }
    // The email has gone; if recording that fails, say so rather than risk emailing the customer twice.
    try { await note({ customer_notified_at: new Date().toISOString(), customer_notified_to: to.join(', '), notify_error: null }); }
    catch (e) { return reply({ sent: true, to, items: missing.length, warning: `Sent, but not recorded on the order: ${(e as Error).message}` }); }
    return reply({ sent: true, to, items: missing.length });
  } catch (e) {
    return reply({ error: String((e as Error)?.message || e) }, 500);
  }
}

Deno.serve(handler);
