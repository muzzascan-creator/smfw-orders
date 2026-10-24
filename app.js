// Coolibah Orders: one page app for SMFW staff (Admins, Managers, Receivers) and customers.
// Data and logins live in Supabase; access rules in supabase/schema.sql decide what each person can see.

const cfg = window.SMFW_CONFIG || {};
// Arriving from an email link (confirm account / reset password) counts as signing in on this device.
let claimDevice = /access_token|type=recovery/.test(location.hash) || new URLSearchParams(location.search).has('code');
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const S = { customers: [], suppliers: [], products: [], orders: [], profiles: [], emails: [], links: [], sections: [] };
const GROUPS = ['Organic', 'Conventional'];
const groupOf = p => p.product_group || 'Organic';
// Each customer orders Organic, Conventional or Both (migrations/013, 023); customers saved before 013 are Organic.
const custGroup = c => c?.product_group || 'Organic';
// A 'Both' customer orders from either location, one location per order.
const custAllows = (c, g) => custGroup(c) === 'Both' || custGroup(c) === g;
const custDefault = c => custGroup(c) === 'Both' ? 'Organic' : custGroup(c);
// An order's group comes from its products: Organic unless every line is Conventional.
const orderGroups = o => [...new Set((o.lines || []).map(l => prodOf(l.product_id)).filter(Boolean).map(groupOf))];
const orderGroup = o => { const g = orderGroups(o); return g.length === 1 ? g[0] : 'Organic'; };
let session = null, profile = null, view = null, draft = null, listFilter = 'pending', search = '', authMode = 'signin', authMsg = '', ordersChannel = null;
let groupFilter = 'all';
const picked = new Set(); // orders ticked on the Orders tab for emailing
const upPicked = new Set(); // orders ticked on the Orders tab for an upload CSV

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Dates are Sydney dates, wherever the browser is.
const today = () => sydNow().date;
// Latest allowed date required: a year ahead. Also stops the date box accepting a 5- or 6-digit year.
const latestReq = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const tomorrow = () => shiftDate(today(), 1);
// Order cut-offs, per product location (Sydney time). Set under Administration › Cut-offs (migrations/026); the database
// holds customers to the same rules (orders_guard, migrations/027).
function sydNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}
const shiftDate = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // dow 1 = Monday ... 7 = Sunday
const cutRules = g => (S.cutRules || []).filter(r => r.product_group === g).sort((a, b) => a.dow - b.dow);
const isoDow = d => new Date(d + 'T12:00:00Z').getUTCDay() || 7;
const toMins = t => +String(t || '0:0').split(':')[0] * 60 + +String(t || '0:0').split(':')[1];
const fmtTime = t => { const m = toMins(t), h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
const andList = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1);
// Why a customer can't send an order of location g for date d right now, or '' when they can.
function orderProblem(g, d, cust) {
  const r = cutRules(g).find(x => x.dow === isoDow(d)); if (!r) return '';
  if (r.delivers === 'none' || (r.delivers === 'sunday' && !cust?.sunday_delivery)) return `We don’t deliver ${g} orders on ${DAYS[r.dow - 1]}s. Please choose another day, or call us on 0417 375 591.`;
  if (r.days_before == null) return '';
  const cut = shiftDate(d, -r.days_before), now = sydNow();
  if (now.date > cut || (now.date === cut && now.minutes >= toMins(r.cutoff_time))) return `Orders for ${fmtDate(d)} delivery closed at ${fmtTime(r.cutoff_time)} on ${fmtDate(cut)}. Please choose a later delivery day, or call us on 0417 375 591.`;
  return '';
}
// Orders are for tomorrow or later, or for today when today's delivery for that location closes the same day.
function earliestReq(g, cust) {
  const now = sydNow(), r = cutRules(g).find(x => x.dow === isoDow(now.date));
  return r && r.days_before === 0 && now.minutes < toMins(r.cutoff_time) && (r.delivers === 'all' || (r.delivers === 'sunday' && cust?.sunday_delivery)) ? now.date : tomorrow();
}
// The rules in words, for the customer's order form.
// Customers' Conventional order form shows one fixed cut-off line instead of a line per delivery day.
const CONV_CUTOFF_TEXT = 'Conventional Order time Cut Off Mon - Fri 7:30am, Sat 5:00am';
const custHint = (g, cust) => g === 'Conventional' ? CONV_CUTOFF_TEXT : orderHint(g, cust);
function orderHint(g, cust) {
  const rs = cutRules(g).filter(r => r.delivers === 'all' || (r.delivers === 'sunday' && cust?.sunday_delivery));
  const closes = rs.filter(r => r.days_before != null).map(r => `${fmtTime(r.cutoff_time)} ${r.days_before ? DAYS[(r.dow - 1 - r.days_before + 7) % 7] : 'the same day'} for ${DAYS[r.dow - 1]}`);
  const off = cutRules(g).filter(r => !rs.includes(r)).map(r => DAYS[r.dow - 1]);
  return [closes.length && `${g} orders close ${andList(closes)} delivery.`, off.length && `No ${g} deliveries on ${andList(off)}.`].filter(Boolean).join(' ');
}
const fmtDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return new Date(+y, m - 1, +dd).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = t => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const bySort = (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || byName(a, b);
const orderNo = n => n == null ? '' : 'SO-' + String(n).padStart(4, '0');
// Admins and Managers share the office dashboard; only Admins see Suppliers and Administration (migrations/012).
const isAdmin = () => ['admin', 'manager'].includes(profile?.role) && profile?.approved;
const isManager = () => profile?.role === 'manager' && profile?.approved;
const ADMIN_ONLY = ['suppliers', 'emails', 'users', 'sms', 'cutoffs', 'settings', 'recv'];
// The Administration tab holds Emails, Logins, SMS and Cut-offs; it opens on whichever was used last.
const ADMIN_TABS = [['customers', 'Customers'], ['products', 'Products'], ['suppliers', 'Suppliers'], ['emails', 'Emails'], ['users', 'Logins'], ['sms', 'SMS'], ['cutoffs', 'Cut-offs'], ['pomatch', 'PO Matching'], ['settings', 'Settings']];
// The top bar's height, so sticky bits (the Administration switch) sit just under it.
new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', $('#top').offsetHeight + 'px')).observe(document.getElementById('top'));
let adminTab = 'customers';
// Managers see only the Administration sub tabs open to them (Customers and Products).
const adminTabs = () => ADMIN_TABS.filter(([t]) => !isManager() || !ADMIN_ONLY.includes(t));
// Receivers see every order read-only (migrations/010).
const isReceiver = () => profile?.role === 'receiver' && profile?.approved;
// SMFW can enter a Conventional order for its own supply, with no customer; every other order needs one.
const needsCustomer = d => !(isAdmin() && d.group === 'Conventional');
// Lookups by id use an index that is rebuilt whenever the list is reloaded, so long lists stay quick.
const custIdx = (() => { let list, m; return () => { if (list !== S.customers) { list = S.customers; m = new Map(list.map(c => [c.id, c])); } return m; }; })();
const prodIdx = (() => { let list, m; return () => { if (list !== S.products) { list = S.products; m = new Map(list.map(p => [p.id, p])); } return m; }; })();
const custOf = id => custIdx().get(id);
const prodOf = id => prodIdx().get(id);
const packIdx = (() => { let list, m; return () => { if (list !== S.products) { list = S.products; m = new Map(list.flatMap(p => (p.product_packs || []).map(k => [k.id, { p, k }]))); } return m; }; })();
const packOf = id => packIdx().get(id) || null;
const STATUS = { draft: 'Draft', submitted: 'Sent', complete: 'Complete' };
// Customers see a transmitted (complete) order as Accepted.
const statusText = st => st === 'complete' && profile && !isAdmin() && !isReceiver() ? 'Accepted' : STATUS[st] || st;

// Messages are errors unless marked ok: errors show red in the middle of the screen and stay a little longer.
function toast(msg, ok) {
  document.querySelectorAll('.toast.err').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = ok ? 'toast' : 'toast err'; t.setAttribute('role', ok ? 'status' : 'alert'); t.textContent = msg;
  if (!ok) t.onclick = () => t.remove();
  (document.querySelector('dialog[open]') || document.body).append(t); // inside an open dialog so it isn't hidden behind it
  setTimeout(() => t.remove(), ok ? 2800 : 4500);
}
function friendly(err) {
  if (!err) return 'Something went wrong.';
  const m = err.message || String(err);
  if (err.code === '23505') {
    if (/sid/i.test(m)) return 'That SID is already used by another pack type.';
    if (/ref/i.test(m)) return 'That Ref is already used by another pack type.';
    if (/cid/i.test(m)) return 'That CID is already used by another customer.';
    if (/product_id, name|product_packs_product_id_name/i.test(m)) return 'A pack type is listed twice on this product.';
    return 'That value is already in use.';
  }
  if (err.code === '23503') return 'This is still used elsewhere, so it can’t be deleted.';
  if (err.code === '42501' || /row-level security/i.test(m)) return 'You don’t have permission to do that.';
  return m;
}
async function run(promise, okMsg) { const { data, error } = await promise; if (error) { toast(friendly(error)); return null; } if (okMsg) toast(okMsg, true); return data ?? true; }

// ---------- data ----------
async function loadAll() {
  const prods = sb.from('products').select('id,supplier_id,code,name,section,sort,active,product_group,product_packs(*)');
  const orders = reloadOrders();
  // Cut-off rules: receivers don't need them. If they can't be fetched, the last ones fetched stay in use.
  const cuts = isReceiver() ? [] : [sb.from('cutoff_rules').select('*'), sb.from('cutoff_settings').select('*')];
  let base, cr, cs;
  if (isReceiver()) {
    const [c, s, p, o] = base = await Promise.all([sb.from('customers').select('id,cid,name,phone'), sb.from('suppliers').select('*'), prods, orders]);
    S.customers = c.data || []; S.suppliers = s.data || []; S.products = p.data || [];
  } else if (isAdmin()) {
    let c, s, p, o, u, m, sec, lk, bc, st;
    [c, s, p, o, u, m, sec, lk, bc, st, cr, cs] = await Promise.all([sb.from('customers').select('*'), sb.from('suppliers').select('*'), prods, orders, sb.from('profiles').select('*').order('created_at'), sb.from('supplier_emails').select('*').order('sort'), sb.from('product_sections').select('name'), sb.from('profile_customers').select('*'), (batchAll ? sb.from('batch_codes').select('*') : sb.from('batch_codes').select('*').gte('entered_at', shiftDate(today(), -90))).order('entered_at', { ascending: false }), sb.from('staff_settings').select('key,value'), ...cuts]);
    base = [c, s, p, o, u, m, sec, lk];
    S.customers = c.data || []; S.suppliers = s.data || []; S.products = p.data || []; S.profiles = u.data || [];
    S.emails = m.data || []; S.sections = (sec.data || []).map(r => r.name); S.links = lk.data || []; S.batches = bc.data || []; // batch codes: empty until 030 is run
    S.settings = Object.fromEntries((st.data || []).map(r => [r.key, r.value])); // empty until 031 is run
  } else {
    let c, p, o;
    [c, p, o, cr, cs] = await Promise.all([sb.from('customers').select('id,cid,name,product_group,sunday_delivery'), prods.eq('active', true), orders, ...cuts]);
    base = [c, p, o];
    S.customers = c.data || []; S.suppliers = []; S.products = p.data || [];
    await loadFavs();
  }
  const bad = [...base, cr, cs].find(r => r?.error);
  if (bad) toast(friendly(bad.error));
  if (cr && !cr.error) S.cutRules = cr.data; if (cs && !cs.error) S.cutSettings = cs.data;
  S.products.forEach(p => (p.product_packs || []).sort((a, b) => a.sort - b.sort));
}
// Orders come down in pages of 1,000, the most Supabase sends at once, so none go missing however many there are.
// After the first load only orders changed since the last fetch are sent (the database stamps updated_at on every
// change), which keeps open screens light. A quick count catches deleted orders and then everything is fetched again.
// Only the newest request's answer is kept, so a slow older one can't put back out-of-date orders.
// Screens load only the orders still in play: every order not yet finished, plus everything touched or required in
// the last 2 weeks (2 months for a customer's own orders). Older finished orders are fetched on request (Search older
// orders / Show older orders) and kept in `older` until the next sign-in.
let ordersSeq = 0, ordersMark = 0, noDirect = false, batchAll = false, olderMine = false;
const ORDER_PAGE = 1000;
const older = new Map();
const recentDays = () => isAdmin() || isReceiver() ? 14 : 60;
const recentFrom = () => shiftDate(today(), -recentDays());
function inPlay(q) {
  const d = recentFrom();
  // Not finished: not Complete, no CSV yet, or (for orders that aren't direct) not yet emailed or received.
  return q.or(noDirect ? `status.neq.complete,csv_at.is.null,emailed_at.is.null,received_at.is.null,updated_at.gte.${d},required_date.gte.${d}`
    : `status.neq.complete,csv_at.is.null,and(direct.is.false,or(emailed_at.is.null,received_at.is.null)),updated_at.gte.${d},required_date.gte.${d}`);
}
async function fetchOrders(since) {
  const out = new Map();
  for (let from = 0; ; from += ORDER_PAGE) {
    let q = sb.from('orders').select('*').order('number').range(from, from + ORDER_PAGE - 1); // oldest first, so new orders don't shift the pages
    q = since ? q.gte('updated_at', since) : inPlay(q);
    const { data, error } = await q;
    if (error && !noDirect && /direct/.test(error.message || '')) { noDirect = true; return fetchOrders(since); } // before migration 032
    if (error) return { error };
    data.forEach(o => out.set(o.id, o));
    if (data.length < ORDER_PAGE) return { data: [...out.values()] };
  }
}
// Older orders asked for by a search: added to what's shown, without disturbing the in-play list.
function addOlder(rows) { let n = 0; rows.forEach(o => { if (!S.orders.some(x => x.id === o.id)) { older.set(o.id, o); n++; } }); S.orders = [...S.orders, ...[...older.values()].filter(o => !S.orders.some(x => x.id === o.id))].sort((a, b) => b.number - a.number); return n; }
async function reloadOrders(full = false) {
  const n = ++ordersSeq;
  const since = !full && ordersMark && S.orders.length ? new Date(ordersMark - 60000).toISOString() : null; // a minute's overlap for slow saves
  const r = await fetchOrders(since);
  if (r.error || n !== ordersSeq) return r;
  let os = r.data;
  os.forEach(o => older.delete(o.id)); // an old order changed today is in play again
  if (since) {
    const m = new Map(S.orders.map(o => [o.id, o])); os.forEach(o => m.set(o.id, o)); os = [...m.values()];
    const { count, error } = await inPlay(sb.from('orders').select('id', { count: 'exact', head: true }));
    if (error || n !== ordersSeq) return { error };
    if (count !== os.filter(o => !older.has(o.id)).length) return reloadOrders(true); // deleted, or a day has passed
  } else os = [...os, ...older.values()];
  S.orders = os.sort((a, b) => b.number - a.number);
  ordersMark = Math.max(0, ...S.orders.map(o => Date.parse(o.updated_at) || 0));
  return {};
}

function listenForOrders() {
  if (ordersChannel) sb.removeChannel(ordersChannel);
  // A burst of changes (e.g. many orders marked emailed at once) is reloaded once, a moment after the last one.
  let timer = null;
  ordersChannel = sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
    const before = payload.old, after = payload.new;
    if (isAdmin() && after?.status === 'submitted' && before?.status !== 'submitted' && after.source === 'customer')
      toast(`New order ${orderNo(after.number)} from ${custOf(after.customer_id)?.name || 'a customer'}`, true);
    if (isAdmin() && after?.direct && !before?.direct) toast(`New Conventional order ${orderNo(after.number)} from ${custOf(after.customer_id)?.name || 'a customer'} (Received tab)`, true);
    clearTimeout(timer);
    timer = setTimeout(async () => { await reloadOrders(); if (canRedraw()) render(); else updateNavBadge(); autoCsv2(); }, 300);
  }).subscribe();
}

// ---------- boot & auth ----------
async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) toast(friendly(error));
  profile = data;
}
async function start() {
  if (!cfg.supabaseUrl || cfg.supabaseUrl.includes('YOUR-PROJECT')) { $('#app').innerHTML = '<div class="card empty">This site isn’t connected to its database yet. Fill in <b>config.js</b> with your Supabase project URL and anon key.</div>'; return; }
  const { data } = await sb.auth.getSession();
  session = data.session;
  // Supabase asks that this callback not await its own calls, so the real work runs on the next tick.
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'PASSWORD_RECOVERY') { session = s; authMode = 'newpass'; setTimeout(renderAuth, 0); return; }
    if (['TOKEN_REFRESHED', 'USER_UPDATED'].includes(event) || (event === 'SIGNED_IN' && profile && session?.user?.id === s?.user?.id)) { session = s; return; }
    session = s; setTimeout(enter, 0);
  });
  await enter();
}
// ---------- one device per login (migrations/025) ----------
// Each browser keeps its own id. Signing in claims the login for this browser; any other browser
// still signed in with it finds out on its next check and signs itself out.
function deviceId() {
  let id = null; try { id = localStorage.getItem('smfw-device'); } catch (e) {}
  if (!id) { id = crypto.randomUUID(); try { localStorage.setItem('smfw-device', id); } catch (e) {} }
  return id;
}
let deviceTimer = null;
async function stillMyDevice() {
  if (!session) return false;
  const claim = claimDevice;
  const { data, error } = await sb.rpc('check_device', { device: deviceId(), claim });
  if (error) return true; // try again at the next check; a claim stays pending until it gets through
  claimDevice = false;
  if (data !== false) return true;
  clearInterval(deviceTimer); deviceTimer = null;
  authMode = 'signin'; authMsg = '!You were signed out because this login was used on another device.';
  await sb.auth.signOut({ scope: 'local' }); // local only: the other device stays signed in
  return false;
}
// Coming back to a screen (a tablet waking, a PC unlocked) catches up straight away: changed orders after a short
// break, everything after 5 minutes or more. Live updates sent while the device slept are otherwise lost.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!profile) return;
  stillMyDevice(); refreshInBackground(Date.now() - hiddenAt > 5 * 60000); checkVersion();
});
addEventListener('online', () => { if (profile) { refreshInBackground(); checkVersion(); } });
// A screen left open for days picks up a new version of the app by itself (checked every 5 minutes), reloading only
// when nothing is being typed, edited, ticked or saved.
const APP_V = (document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=([^&]+)/) || [])[1];
let versionAt = 0, newVersion = false;
async function checkVersion() {
  if (!APP_V) return;
  if (!newVersion && Date.now() - versionAt > 5 * 60000) {
    versionAt = Date.now();
    try { const v = ((await (await fetch(location.pathname + '?check=' + Date.now(), { cache: 'no-store' })).text()).match(/app\.js\?v=([^"'&]+)/) || [])[1]; newVersion = !!v && v !== APP_V; } catch (e) {}
  }
  if (newVersion && canRedraw() && view !== 'recvorder' && !saving && !auto2Busy && !picked.size && !upPicked.size) location.reload();
}
async function enter() {
  if (!session) {
    // Nothing from the last person carries over to whoever signs in next on this device.
    if ($('#dlg').open) $('#dlg').close();
    Object.assign(S, { customers: [], suppliers: [], products: [], orders: [], profiles: [], emails: [], links: [], sections: [], cutRules: [], cutSettings: [], favs: [], batches: [], settings: {} });
    draft = null; receipt = null; ordersMark = 0; S.poMatch = null; older.clear(); noDirect = false; batchAll = false; olderMine = false; search = ''; custSearch = ''; userSearch = ''; listFilter = 'pending'; groupFilter = 'all'; adminTab = 'customers'; picked.clear(); upPicked.clear();
    clearInterval(deviceTimer); deviceTimer = null; clearInterval(autoRefresh); autoRefresh = null; profile = null; view = null; smsCfg = null; $('#top').hidden = true; if (ordersChannel) { sb.removeChannel(ordersChannel); ordersChannel = null; } renderAuth(); return; }
  if (authMode === 'newpass') return renderAuth();
  if (!(await stillMyDevice())) return;
  authMsg = '';
  clearInterval(deviceTimer); deviceTimer = setInterval(() => { if (!document.hidden) stillMyDevice(); }, 30000);
  await loadProfile();
  if (!profile || !profile.approved || (!isAdmin() && !isReceiver() && !profile.customer_id)) { $('#top').hidden = true; return renderPending(); }
  $('#top').hidden = false;
  document.body.classList.toggle('staff', isAdmin()); // Admin / Manager lists use tight rows (styles.css)
  $('#contact').hidden = isAdmin() || isReceiver(); // customers see who to call or email
  $('#whoami').textContent = (profile.full_name || profile.email) + (isManager() ? ' · Manager' : isAdmin() ? ' · Admin' : isReceiver() ? ' · Receiver' : '');
  await loadAll();
  if (isAdmin()) { await loadCsvDir(1); await loadCsvDir(2); autoCsv2(); }
  listenForOrders();
  // Admin dashboards and receiver tablets refresh themselves every 30 seconds (skipped while the tab is hidden; no
  // redraw mid-edit): changed orders each time, everything else every 5 minutes.
  let ticks = 0;
  clearInterval(autoRefresh); autoRefresh = setInterval(() => { if (document.hidden || !profile) return; if (isAdmin() || isReceiver()) refreshInBackground(++ticks % 10 === 0); checkVersion(); }, 30000);
  if (!view) view = homeView();
  render();
}
$('#signout').addEventListener('click', () => sb.auth.signOut());

// An Australian mobile number written as 04XX XXX XXX, or '' if it isn't one (also takes +61 4.. and 61 4..).
function auMobile(v) {
  let d = String(v || '').replace(/[\s().-]/g, '').replace(/^\+?61(?=4)/, '0');
  return /^04\d{8}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : '';
}
function renderAuth() {
  const app = $('#app');
  const msg = authMsg ? `<p class="${authMsg.startsWith('!') ? 'err' : 'ok'}">${esc(authMsg.replace(/^!/, ''))}</p>` : '';
  const forms = {
    signin: `<h1>Sign in</h1><p class="sub">Place and track your orders with SMFW.</p>${msg}
      <form id="af" class="grid"><label class="f">Email<input id="a-email" type="email" autocomplete="email" required></label>
      <label class="f">Password<input id="a-pass" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Sign in</button></form>
      <div class="links"><button class="link" data-mode="signup">Create an account</button><button class="link" data-mode="forgot">Forgot password?</button></div>`,
    signup: `<h1>Create an account</h1><p class="sub">Once SMFW links your account to your business, you can start ordering.</p>${msg}
      <form id="af" class="grid"><label class="f">Your name<input id="a-name" autocomplete="name" required></label>
      <label class="f">Business name<input id="a-biz" autocomplete="organization" required></label>
      <label class="f">Mobile number<input id="a-mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="04XX XXX XXX" required><span class="muted" style="font-size:12px;font-weight:400">We’ll text you when your account is ready.</span></label>
      <label class="f">Email<input id="a-email" type="email" autocomplete="email" required></label>
      <label class="f">Password (at least 8 characters)<input id="a-pass" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="primary" type="submit">Create account</button></form>
      <div class="links"><button class="link" data-mode="signin">I already have an account</button></div>`,
    forgot: `<h1>Reset your password</h1><p class="sub">We’ll email you a link to set a new one.</p>${msg}
      <form id="af" class="grid"><label class="f">Email<input id="a-email" type="email" autocomplete="email" required></label>
      <button class="primary" type="submit">Send reset link</button></form>
      <div class="links"><button class="link" data-mode="signin">Back to sign in</button></div>`,
    newpass: `<h1>Set a new password</h1>${msg}
      <form id="af" class="grid"><label class="f">New password (at least 8 characters)<input id="a-pass" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="primary" type="submit">Save password</button></form>`,
  };
  app.innerHTML = `<div class="auth card"><img class="authlogo" src="logo.png?v=2" alt="Coolibah Salads Sydney">${forms[authMode]}</div>`;
  app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { authMode = b.dataset.mode; authMsg = ''; renderAuth(); });
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const email = $('#a-email')?.value.trim(), password = $('#a-pass')?.value;
    let error;
    claimDevice = true;
    if (authMode === 'signin') ({ error } = await sb.auth.signInWithPassword({ email, password }));
    else if (authMode === 'signup') {
      const mobile = auMobile($('#a-mobile').value);
      if (!mobile) { const m = $('#a-mobile'); m.setCustomValidity('Please enter a valid Australian mobile number, like 0412 345 678.'); m.oninput = () => m.setCustomValidity(''); m.reportValidity(); btn.disabled = false; claimDevice = false; return; }
      const r = await sb.auth.signUp({ email, password, options: { data: { full_name: $('#a-name').value.trim(), business: $('#a-biz').value.trim(), mobile }, emailRedirectTo: location.origin + location.pathname } });
      error = r.error;
      if (!error && !r.data.session) { authMode = 'signin'; authMsg = 'Account created. Check your email to confirm it, then sign in.'; return renderAuth(); }
    } else if (authMode === 'forgot') {
      ({ error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      if (!error) { authMsg = 'If that email has an account, a reset link is on its way.'; return renderAuth(); }
    } else if (authMode === 'newpass') {
      ({ error } = await sb.auth.updateUser({ password }));
      if (!error) { authMode = 'signin'; authMsg = ''; toast('Password saved', true); return enter(); }
    }
    btn.disabled = false;
    if (error) { authMsg = ''; renderAuth(); toast(error.message === 'Invalid login credentials' ? 'That email and password don’t match an account.' : error.message); }
  };
}
function renderPending() {
  $('#app').innerHTML = `<div class="auth card"><img class="authlogo" src="logo.png?v=2" alt="Coolibah Salads Sydney"><h1>Almost there</h1>
    <p>Thanks${profile?.full_name ? ', ' + esc(profile.full_name) : ''}. Your account is waiting for SMFW to link it to your business. You’ll be able to order as soon as that’s done.</p>
    <p class="muted">Signed in as ${esc(session.user.email)}</p>
    <div class="row"><button id="recheck" class="primary">Check again</button><button id="so2">Sign out</button></div></div>`;
  $('#recheck').onclick = () => enter();
  $('#so2').onclick = () => sb.auth.signOut();
}

// ---------- navigation ----------
const homeView = () => isAdmin() ? 'inbox' : isReceiver() ? 'recv' : 'mine';
function navItems() {
  if (isReceiver()) return [['recv', 'Orders']];
  return isAdmin()
    ? [['inbox', 'Inbox'], ['orders', 'Orders'], ['entry', 'New order'], ['batch', 'Batch Code'], ['recv', 'Receiver'], ['admin', 'Administration']].filter(([v]) => !isManager() || !ADMIN_ONLY.includes(v))
    : [['mine', 'My orders'], ['entry', 'New order']];
}
function inboxCount() { return S.orders.filter(o => o.status === 'submitted').length; }
function updateNavBadge() { const b = document.querySelector('#nav [data-v=inbox] .badge'); const n = inboxCount(); if (b) { b.textContent = n; b.hidden = !n; } }
function go(v, fresh = true) { if (v === 'admin') v = adminTabs().some(([t]) => t === adminTab) ? adminTab : adminTabs()[0][0]; if (ADMIN_TABS.some(([t]) => t === v)) adminTab = v; view = v; if (v === 'entry' && fresh) draft = blankOrder(); render(); window.scrollTo(0, 0); }
// A tab press shows the page straight away from what is already loaded, then fetches fresh data in the background
// (new sign-ups, other people's edits) and redraws only if something changed and you aren't mid-edit.
let refreshing = null, autoRefresh = null;
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; go(b.dataset.v); refreshInBackground(); });
// Redraw after new data only where it can't wipe something being typed or chosen: never on screens with unsaved
// settings (New order, Emails, SMS, Cut-offs), nor while a dialog is open or a box has the cursor.
const canRedraw = () => !['entry', 'emails', 'sms', 'cutoffs'].includes(view) && !document.querySelector('dialog[open]') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
// all = false fetches only changed orders (the 30-second timer); a tab press or a long time away fetches everything.
function refreshInBackground(all = true) {
  if (refreshing) return refreshing;
  const v = view, snap = () => JSON.stringify([S.customers, S.suppliers, S.products, S.orders, S.profiles, S.emails, S.sections, S.links]);
  const before = snap();
  return refreshing = (all ? loadAll() : reloadOrders()).then(() => {
    autoCsv2();
    if (view === v && canRedraw() && snap() !== before) render(); else updateNavBadge();
  }).finally(() => { refreshing = null; });
}

// Frozen column headings sit just under a frozen title row (.pagehead), so they need its height.
function setPageHeadHeight() { const st = document.documentElement.style; st.setProperty('--ph', ($('.pagehead')?.offsetHeight || 0) + 'px'); st.setProperty('--ab', ($('.adminbar')?.offsetHeight || 0) + 'px'); }
addEventListener('resize', () => setPageHeadHeight());
function render() {
  const nav = $('#nav');
  // A customer looking at an order they can't change uses Close to leave it; the tabs wait until then.
  const locked = !isAdmin() && !isReceiver() && view === 'entry' && !!draft?.id && !canEditDraft();
  nav.innerHTML = navItems().map(([v, label]) => `<button data-v="${v}" ${locked ? 'disabled title="Press Close to leave this order"' : ''} aria-current="${(v === view || v === 'recv' && view === 'recvorder' || v === 'admin' && adminTabs().some(([t]) => t === view)) && !(v === 'entry' && draft?.id) ? 'page' : 'false'}">${label}${v === 'inbox' ? `<span class="badge" ${inboxCount() ? '' : 'hidden'}>${inboxCount()}</span>` : ''}</button>`).join('');
  const views = { pomatch: viewPoMatch, recv: viewRecv, recvorder: viewRecvOrder, inbox: viewInbox, orders: viewOrders, mine: viewMine, entry: viewEntry, customers: viewCustomers, products: viewProducts, batch: viewBatch, suppliers: viewSuppliers, emails: viewEmails, users: viewUsers, sms: viewSms, cutoffs: viewCutoffs, settings: viewSettings };
  const allowed = isManager() ? Object.keys(views).filter(v => !ADMIN_ONLY.includes(v) && !v.startsWith('recv')) : isAdmin() ? null : isReceiver() ? ['recv', 'recvorder'] : ['mine', 'entry'];
  // The Receiver screens are for Receivers, and for an Admin through the Receiver tab (not Managers).
  if (!views[view] || ['recv', 'recvorder'].includes(view) && !isReceiver() && !(isAdmin() && !isManager()) || (allowed && !allowed.includes(view))) view = homeView();
  if (view === 'entry' && !draft) draft = blankOrder();
  const keep = view === 'recvorder' ? $('.recvscroll')?.scrollTop : 0; // ticking a line re-draws the screen; stay where you were
  const sub = adminTabs().some(([t]) => t === view) ? `<div class="adminbar"><div class="grpswitch" role="tablist" aria-label="Administration">${adminTabs().map(([t, l]) => `<button type="button" role="tab" aria-selected="${t === view}" class="${t === view ? 'on' : ''}" onclick="go('${t}');refreshInBackground()">${l}</button>`).join('')}</div></div>` : '';
  $('#app').innerHTML = sub + views[view]();
  if (view === 'entry') wireEntry();
  if (view === 'orders') wireOrderSearch();
  setPageHeadHeight();
  if (view === 'pomatch' && !S.poMatch) loadPoMatch();
  if (view === 'cutoffs') document.querySelectorAll('.cuttbl [name=delivers]').forEach(cutRowState);
  if (view === 'recvorder') { wireRecvOrder(); if (keep) $('.recvscroll').scrollTop = keep; }
  if (view === 'recv') { const i = $('#osearch'); if (i) i.oninput = () => { search = i.value; render(); const j = $('#osearch'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; }
}

// ---------- order lists ----------
function orderRow(o, opts = {}) {
  const c = custOf(o.customer_id);
  return `<tr class="rowlink${opts.later ? ' later' : ''}" onclick="openOrder('${o.id}')">
    <td class="mono c-no">${esc(orderNo(o.number))}${orderGroup(o) === 'Conventional' ? ' <span class="pill grp-conventional">Conventional</span>' : ''}${o.special_order && isAdmin() ? ' <span class="pill spo">Special Order</span>' : ''}</td>
    ${opts.customer === false ? '' : `<td class="c-cust">${c ? esc(c.name) : o.customer_id ? 'Unknown customer' : '<span class="muted">No customer</span>'}</td>`}
    <td class="c-date">${o.required_date ? `<span class="c-lbl">Required </span>${esc(fmtDate(o.required_date))}` : '<span class="c-lbl muted">No date yet</span>'}</td>
    ${opts.sent ? `<td>${esc(fmtWhen(o.submitted_at))}</td>` : ''}
    ${opts.source ? `<td>${o.source === 'customer' ? 'Customer' : 'SMFW'}</td>` : ''}
    <td class="num lines">${(o.lines || []).filter(l => !l.undelivered).length}</td>
    <td class="c-st">${opts.pick ? `<div class="stgrid"><span class="pill ${esc(o.status)}">${esc(statusText(o.status))}</span><span>${o.emailed_at ? `<span class="pill emailed" title="Emailed ${esc(fmtWhen(o.emailed_at))}">Emailed</span>` : ''}</span><span>${receivedPill(o)}</span><span>${o.csv_at ? `<span class="pill emailed" title="CSV created ${esc(fmtWhen(o.csv_at))}">CSV</span>` : ''}</span></div>`
      : `<span class="pill ${esc(o.status)}">${esc(statusText(o.status))}</span>`}</td>
    ${opts.acts ? `<td class="num acts c-acts" onclick="event.stopPropagation()"><button class="ghost" onclick="openOrder('${o.id}')">View</button><button class="ghost" onclick="printOrder('${o.id}', this)">Print<span class="long"> Order</span></button></td>`
      : `<td class="num openc"><button class="ghost" onclick="event.stopPropagation();openOrder('${o.id}')">Open</button></td>`}
    ${opts.pick ? `<td class="pick" onclick="event.stopPropagation()"><input type="checkbox" data-up="${o.id}" aria-label="Select ${esc(orderNo(o.number))} for an upload CSV" ${noUpload(o) ? `disabled title="${nothingDelivered(o) ? 'Nothing was delivered, so no CSV can be created' : 'Required date has passed'}"` : upPicked.has(o.id) ? 'checked' : ''}></td>` : ''}
    ${opts.pick ? `<td class="pick" onclick="event.stopPropagation()"><input type="checkbox" data-pick="${o.id}" aria-label="Select ${esc(orderNo(o.number))} for emailing" ${pastDone(o) ? `disabled title="${o.direct ? 'Not emailed: CSV only' : 'Required date has passed'}"` : picked.has(o.id) ? 'checked' : ''}></td>` : ''}</tr>`;
}
// Receiver: completed orders not yet received.
function viewRecv() {
  let os = S.orders.filter(o => o.status === 'complete' && !o.received_at && !o.direct); // direct orders never go to the Receiver
  const q = search.trim().toLowerCase();
  if (q) os = os.filter(o => [orderNo(o.number), custOf(o.customer_id)?.name, custOf(o.customer_id)?.cid].join(' ').toLowerCase().includes(q));
  const gr = o => orderGroup(o) === 'Conventional' ? 0 : 1;
  os = [...os].sort((x, y) => (x.required_date || '9999').localeCompare(y.required_date || '9999') || gr(x) - gr(y) || x.number - y.number); // earliest required date on top, Conventional before Organic
  return `<h1>Orders</h1><p class="sub">Orders waiting to be received. Open an order to correct quantities or flag lines that didn’t arrive, save it, then press Mark received.</p>
    <div class="row" style="margin-bottom:12px"><input class="search" id="osearch" placeholder="Search order no., customer or CID" value="${esc(search)}"></div>
    ${os.length ? `<div class="tablewrap"><table class="recvlist"><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>Ticked</th><th class="acts"></th></tr></thead><tbody>${os.map(o => {
      const c = custOf(o.customer_id);
      return `<tr><td class="mono">${esc(orderNo(o.number))}${orderGroup(o) === 'Conventional' ? ' <span class="pill grp-conventional">Conventional</span>' : ''}</td>
        <td class="rcust">${c ? esc(c.name) : '<span class="muted">No customer</span>'}</td>
        <td>${(o.required_date || '') > today() ? `<strong class="rlater">${esc(fmtDate(o.required_date))}</strong>` : esc(fmtDate(o.required_date))}</td><td><span class="${tickedCount(o) < (o.lines || []).length ? 'ndtxt' : 'okgreen'}">${tickedCount(o)}/${(o.lines || []).length}</span></td>
        <td class="num acts recvacts"><button class="ghost ropen" onclick="openReceipt('${o.id}')">Open</button><button class="ghost rmark" onclick="markReceived('${o.id}', this)">Mark received</button></td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="card empty">${S.orders.some(o => o.status === 'complete' && !o.received_at && !o.direct) ? 'No orders match this search.' : 'Nothing waiting. Every order has been received.'}</div>`}`;
}
// Receiver: one order's lines, with the quantity that arrived and a Not delivered tick for each.
let receipt = null;
function openReceipt(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  receipt = { id, lines: (o.lines || []).map(l => ({ ...l, ordered: l.ordered_qty ?? l.qty, qty: l.qty, undelivered: !!l.undelivered, received: !!l.received && !l.undelivered, batch: l.batch_code || '' })) };
  go('recvorder', false);
}
// Conventional orders for No customer need a batch code on each Batch Code product that arrived.
const needsBatch = o => !!o && !o.customer_id && (o.lines || []).length > 0 && orderGroup(o) === 'Conventional';
const batchLine = (o, l) => needsBatch(o) && !!packOf(l.pack_id)?.k?.batch_code;
function viewRecvOrder() {
  const o = S.orders.find(x => x.id === receipt?.id); if (!o) { view = 'recv'; return viewRecv(); }
  const c = custOf(o.customer_id), sup = l => S.suppliers.find(s => s.id === prodOf(l.product_id)?.supplier_id)?.name || 'Other';
  const bySup = {}; receipt.lines.forEach((l, i) => (bySup[sup(l)] ||= []).push([l, i]));
  // Everything down to the column headings stays put; only the product lines scroll (see sizeRecvScroll).
  return `<div class="row spread recvhead"><div><h1>Order ${esc(orderNo(o.number))}</h1><div class="recvcust">${c ? esc(c.name) : '<span class="muted">No customer</span>'}</div><p class="sub">${o.required_date ? 'Needed ' + esc(fmtDate(o.required_date)) + '. ' : ''}Tick Received for each line that arrived, changing the quantity if a different amount came, or tick Not delivered.</p></div>
      <div class="row"><button onclick="receipt=null;go('recv',false)">Back</button><button class="primary" onclick="saveReceipt(this)">Save</button></div></div>
    <div class="recvscroll">${Object.entries(bySup).map(([sn, ls]) => `<h2 class="recvsup">${esc(sn)}</h2><div class="recvtbl"><table><thead><tr><th>Product</th><th>Pack</th><th class="num">Ordered</th><th class="rqh">Qty received</th><th class="pick">Received</th><th class="pick">Not delivered</th></tr></thead><tbody>
      ${ls.map(([l, i]) => `<tr${l.undelivered ? ' class="nd"' : ''}><td class="rprod">${esc(l.product_name)}${batchLine(o, l) && !l.undelivered ? `<label class="rbatch${l.received && !l.undelivered && !l.batch.trim() ? ' need' : ''}"><span>Batch code</span><input data-bc="${i}" inputmode="numeric" enterkeyhint="done" value="${esc(l.batch)}" ${l.received && !l.undelivered ? '' : 'disabled'} placeholder="${l.received && !l.undelivered ? 'Required' : 'Tick Received first'}" autocomplete="off" aria-label="${esc(l.product_name)} batch code"></label>` : ''}</td><td>${esc(l.pack_name)}</td><td class="num rord">${esc(l.ordered)}</td>
        <td class="rqc"><input class="rq" inputmode="numeric" enterkeyhint="done" data-i="${i}" value="${esc(l.qty)}" ${l.undelivered ? 'disabled' : ''} aria-label="${esc(l.product_name)} received"></td>
        <td class="pick"><input type="checkbox" data-rc="${i}" ${l.received ? 'checked' : ''} aria-label="${esc(l.product_name)} received"></td>
        <td class="pick"><input type="checkbox" data-nd="${i}" ${l.undelivered ? 'checked' : ''} aria-label="${esc(l.product_name)} not delivered"></td></tr>`).join('')}
    </tbody></table></div>`).join('')}</div>`;
}
// The line list fills the rest of the window so the top of the screen stays frozen while it scrolls.
function sizeRecvScroll() { const el = $('.recvscroll'); if (el) el.style.maxHeight = Math.max(240, innerHeight - el.getBoundingClientRect().top - 12) + 'px'; }
addEventListener('resize', sizeRecvScroll);
function wireRecvOrder() {
  sizeRecvScroll();
  document.querySelectorAll('input.rq').forEach(inp => inp.oninput = () => { const v = inp.value.replace(/[^\d]/g, ''); if (v !== inp.value) inp.value = v; receipt.lines[inp.dataset.i].qty = v === '' ? 0 : +v; });
  // Return closes the number pad; tapping a received quantity selects it so typing replaces it.
  document.querySelectorAll('input.rq, input[data-bc]').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } }));
  document.querySelectorAll('input.rq').forEach(inp => { inp.onfocus = () => setTimeout(() => inp.select(), 0); inp.onmouseup = e => e.preventDefault(); });
  document.querySelectorAll('input[data-bc]').forEach(inp => inp.oninput = () => { receipt.lines[inp.dataset.bc].batch = inp.value; inp.parentElement.classList.toggle('need', !inp.value.trim()); });
  document.querySelectorAll('input[data-nd]').forEach(cb => cb.onchange = () => { const l = receipt.lines[cb.dataset.nd]; l.undelivered = cb.checked; if (cb.checked) l.received = false; render(); });
  document.querySelectorAll('input[data-rc]').forEach(cb => cb.onchange = () => { const l = receipt.lines[cb.dataset.rc]; l.received = cb.checked; if (cb.checked) l.undelivered = false; render(); });
}
async function saveReceipt(btn) {
  const o = S.orders.find(x => x.id === receipt.id);
  const gap = receipt.lines.findIndex(l => batchLine(o, l) && l.received && !l.undelivered && !l.batch.trim());
  if (gap >= 0) { const inp = $(`input[data-bc="${gap}"]`); inp?.focus(); inp?.scrollIntoView({ block: 'center' }); return toast(`Enter the batch code for ${receipt.lines[gap].product_name} before saving.`); }
  btn.disabled = true;
  const items = receipt.lines.map(l => ({ pack_id: l.pack_id, qty: l.qty, undelivered: l.undelivered || !(l.qty > 0), received: l.received && !l.undelivered && l.qty > 0, batch: l.batch.trim() }));
  const { error } = await sb.rpc('save_receipt', { order_id: receipt.id, items });
  btn.disabled = false;
  if (error) return toast(friendly(error));
  await reloadOrders(); receipt = null; toast('Saved. Press Mark received when you’re done with this order.', true); go('recv', false);
}
// Every line must be ticked Received or Not delivered (and saved) before the order can be marked received.
const tickedCount = o => (o.lines || []).filter(l => l.received || l.undelivered).length;
function markReceived(id, btn) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const left = (o.lines || []).length - tickedCount(o);
  if (left) return toast(`Open the order and tick Received or Not delivered on ${left === 1 ? 'the last line' : `the ${left} remaining lines`}, then Save.`);
  setReceived(id, btn);
}
const receivedPill = o => o.received_at ? ` <span class="pill emailed" title="Received ${esc(fmtWhen(o.received_at))}${o.received_by ? ' by ' + esc(o.received_by) : ''}">Received</span>` : '';
async function setReceived(id, btn) {
  btn.disabled = true;
  const { error } = await sb.rpc('set_received', { order_id: id, received: true });
  btn.disabled = false;
  if (error) return toast(friendly(error));
  let msg = 'Marked as received';
  // Missing items: the customer is emailed straight away. If that can't happen, SMFW sees it on the order and can resend.
  const o = S.orders.find(x => x.id === id);
  if (o?.customer_id && missingOf(o).length) { const r = await notifyCustomer(id); if (r.sent) msg += `. ${custOf(o.customer_id)?.name || 'The customer'} has been emailed about the shortages`; }
  await reloadOrders(); render(); toast(msg, true);
}
function viewInbox() {
  const os = S.orders.filter(o => o.status === 'submitted').sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
  return `<div class="row spread"><div><h1>Inbox</h1><p class="sub">Orders customers have sent that still need processing. Open one to check it and mark it complete.</p></div><button onclick="$('#pofile').click()">Import purchase order</button><input type="file" id="pofile" accept="application/pdf,.pdf" hidden onchange="importPo(this)"></div>
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>Sent</th><th>From</th><th class="num lines">Lines</th><th>Status</th><th class="openc"></th></tr></thead><tbody>${os.map(o => orderRow(o, { sent: true, source: true })).join('')}</tbody></table></div>`
      : `<div class="card empty">No orders waiting. New customer orders appear here as soon as they’re sent.</div>`}`;
}
// ---------- import a buyer's purchase order (PDF) ----------
// Some buyers send one PDF listing several stores side by side: product descriptions down the left, a quantity column
// per store, then Total. The app reads the text with PDF.js, splits it into one order per store (and per product
// location), and asks once which customer each store column is and which product/pack each description is
// (remembered in po_stores / po_items, migration 034). Conventional orders go straight to the Received tab.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let po = null;
const poKey = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((res, rej) => { const sc = Object.assign(document.createElement('script'), { src: PDFJS + 'pdf.min.js' });
    sc.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(pdfjsLib); }; sc.onerror = () => rej(new Error('PDF reader could not load')); document.head.append(sc); });
}
// Reads the PDF's text positions into { cols: [{label, hint}], lines: [{desc, qty: {col: n}}], date }.
async function readPo(file) {
  const lib = await loadPdfJs(), doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const cols = [], lines = [], hints = {}; let date = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items.filter(i => i.str.trim())
      .map(i => ({ t: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, c: i.transform[4] + i.width / 2 }));
    items.forEach(i => { const m = i.t.match(/customer\s+(.+?)\s+(\d{3,})\b/i); if (m) hints[poKey(m[2])] = m[1].trim(); const d = i.t.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/); if (d && !date) date = d[1]; });
    const head = items.find(i => /^description$/i.test(i.t)); if (!head) continue;
    // Column headings: everything level with "Description" (a little above or below it) and to its right.
    const hs = items.filter(i => i !== head && i.x > head.x + head.w && Math.abs(i.y - head.y) <= 20).sort((a, b) => b.y - a.y);
    const pcols = [];
    hs.forEach(i => { const col = pcols.find(c => Math.abs(c.c - i.c) < 18); if (col) col.parts.push(i.t); else pcols.push({ c: i.c, parts: [i.t] }); });
    pcols.sort((a, b) => a.c - b.c).forEach(c => { c.label = c.parts.join(' '); c.total = /^total$/i.test(c.label); if (!c.total && !cols.some(x => x.label === c.label)) cols.push({ label: c.label }); });
    if (!pcols.length) continue;
    const left = Math.min(...pcols.map(c => c.c)) - 30, top = Math.min(...hs.map(i => i.y)) - 4;
    const rows = new Map();
    items.filter(i => i.y < top && !/^page \d+/i.test(i.t)).forEach(i => { const y = [...rows.keys()].find(k => Math.abs(k - i.y) < 4) ?? i.y; (rows.get(y) || rows.set(y, []).get(y)).push(i); });
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
      const desc = its.filter(i => i.c < left).sort((a, b) => a.x - b.x).map(i => i.t).join(' ').trim();
      if (!desc) return;
      const qty = {};
      its.filter(i => i.c >= left && /^\d+(\.\d+)?$/.test(i.t)).forEach(i => {
        const col = pcols.reduce((b, c) => Math.abs(c.c - i.c) < Math.abs(b.c - i.c) ? c : b);
        if (!col.total && Math.abs(col.c - i.c) < 30) qty[col.label] = (qty[col.label] || 0) + Number(i.t);
      });
      if (Object.keys(qty).length) lines.push({ desc, qty });
    });
  }
  cols.forEach(c => { c.hint = hints[poKey(c.label.match(/\d{3,}/)?.[0])] || ''; c.lines = lines.filter(l => l.qty[c.label] > 0).length; });
  return { cols: cols.filter(c => c.lines), lines, date };
}
async function importPo(input) {
  const file = input.files[0]; input.value = ''; if (!file) return;
  let r; try { r = await readPo(file); } catch (e) { return toast('That PDF couldn’t be read: ' + e.message); }
  if (!r.cols.length || !r.lines.length) return toast('No store columns or product lines were found in that PDF. It needs a Description column with a quantity column per store.');
  const [st, it] = await Promise.all([sb.from('po_stores').select('*'), sb.from('po_items').select('*')]);
  if (st.error || it.error) return toast(friendly(st.error || it.error));
  // A match saved with no customer / product means "Don't import" / "Skip".
  const stores = Object.fromEntries(st.data.map(x => [x.label, x.customer_id || 'skip'])), packs = Object.fromEntries(it.data.map(x => [x.description, x.pack_id || 'skip']));
  po = { ...r, no: file.name.match(/\d{4,}/)?.[0] || '', file: file.name };
  const custOpts = sel => `<option value="">Choose the customer</option><option value="skip" ${sel === 'skip' ? 'selected' : ''}>Don’t import this store</option>${S.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${esc(c.cid)})</option>`).join('')}`;
  // Products hidden from order forms can still be imported, as long as the pack is Available.
  const packList = S.products.slice().sort(byName).flatMap(p => (p.product_packs || []).filter(k => k.available).map(k => ({ id: k.id, t: `${p.name} · ${k.name} (${groupOf(p)}${p.active === false ? ', hidden from order forms' : ''})` })));
  const packOpts = sel => `<option value="">Choose the product</option><option value="skip" ${sel === 'skip' ? 'selected' : ''}>Skip this line</option>${packList.map(k => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${esc(k.t)}</option>`).join('')}`;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form class="grid" id="poform"><h2>Purchase order${po.no ? ' ' + esc(po.no) : ''}</h2>
    <p class="muted" style="margin:0">${esc(po.file)}${po.date ? ' · dated ' + esc(po.date) : ''}. One order is made for each store below.</p>
    <label class="f" style="max-width:220px">Date required<input type="date" id="po-date" required min="${today()}"></label>
    <h3 style="margin:6px 0 0">Stores</h3>
    <div class="tablewrap"><table><thead><tr><th>Store on the PO</th><th class="num">Lines</th><th>Customer</th></tr></thead><tbody>
      ${po.cols.map((c, i) => `<tr${stores[poKey(c.label)] === 'skip' || custOf(stores[poKey(c.label)]) ? ' class="pomatched" hidden' : ''}><td><b>${esc(c.label)}</b>${c.hint ? `<div class="muted" style="font-size:12px">${esc(c.hint)}</div>` : ''}</td><td class="num">${c.lines}</td><td><select data-store="${i}" style="width:100%">${custOpts(stores[poKey(c.label)] === 'skip' || custOf(stores[poKey(c.label)]) ? stores[poKey(c.label)] : '')}</select></td></tr>`).join('')}
    </tbody></table></div>
    <h3 style="margin:6px 0 0">Products</h3>
    <div class="tablewrap"><table><thead><tr><th>Product on the PO</th>${po.cols.map(c => `<th class="num">${esc(c.label)}</th>`).join('')}<th>Our product</th></tr></thead><tbody>
      ${po.lines.map((l, i) => `<tr${packs[poKey(l.desc)] === 'skip' || packOf(packs[poKey(l.desc)]) ? ' class="pomatched" hidden' : ''}><td>${esc(l.desc)}</td>${po.cols.map(c => `<td class="num">${l.qty[c.label] || ''}</td>`).join('')}<td style="min-width:300px"><select data-item="${i}" style="width:100%">${packOpts(packs[poKey(l.desc)] === 'skip' || packOf(packs[poKey(l.desc)]) ? packs[poKey(l.desc)] : '')}</select></td></tr>`).join('')}
    </tbody></table></div>
    ${(() => { const n = po.cols.filter(c => stores[poKey(c.label)] === 'skip' || custOf(stores[poKey(c.label)])).length + po.lines.filter(l => packs[poKey(l.desc)] === 'skip' || packOf(packs[poKey(l.desc)])).length;
      return n ? `<p class="muted" style="margin:0">${n} store${n > 1 ? 's and products are' : ' or product is'} already matched and hidden above. <button type="button" class="link" onclick="document.querySelectorAll('#poform tr.pomatched').forEach(r => r.hidden = false);this.parentElement.remove()">Show them</button> · Change matches any time in Administration › PO Matching.</p>` : ''; })()}
    <p class="banner" style="margin:0">These orders go straight to the Received tab. Create their CSV there with Create upload CSV. Any Organic products become a separate order in the Inbox.</p>
    <div class="row" style="justify-content:flex-end"><button type="button" onclick="document.getElementById('dlg').close()">Cancel</button><button type="submit" class="primary" id="pogo">Create orders</button></div></form>`;
  dlg.querySelector('#poform').onsubmit = e => { e.preventDefault(); createPoOrders(e.submitter); };
  dlg.classList.add('wide'); dlg.addEventListener('close', () => dlg.classList.remove('wide'), { once: true });
  dlg.showModal();
}
async function createPoOrders(btn) {
  const date = $('#po-date').value;
  if (!date) return toast('Choose the date required first.');
  const cust = po.cols.map((c, i) => $(`select[data-store="${i}"]`).value), pk = po.lines.map((l, i) => $(`select[data-item="${i}"]`).value);
  const ci = cust.indexOf(''); if (ci >= 0) return toast(`Choose the customer for ${po.cols[ci].label}, or Don’t import this store.`);
  const pi = pk.indexOf(''); if (pi >= 0) return toast(`Choose our product for “${po.lines[pi].desc}”, or Skip this line.`);
  const special = po.no ? `PO ${po.no}` : `PO ${po.file}`;
  const rows = [];
  po.cols.forEach((c, i) => {
    if (cust[i] === 'skip') return;
    const byGroup = {};
    po.lines.forEach((l, j) => {
      const q = l.qty[c.label]; if (!q || pk[j] === 'skip') return;
      const f = packOf(pk[j]); if (!f) return;
      const ls = (byGroup[groupOf(f.p)] ||= []), had = ls.find(x => x.pack_id === f.k.id);
      if (had) had.qty += q; else ls.push({ pack_id: f.k.id, product_id: f.p.id, sid: f.k.sid, code: f.p.code || '', product_name: f.p.name, pack_name: f.k.name, outer: outerOf(f.k), qty: q });
    });
    // An order holds one product location, so a store with both gets an Organic and a Conventional order. Conventional
    // orders follow the Received tab rules (direct: no Inbox, no Receiver, CSV created by hand into the Condition 2 folder); Organic
    // ones go to the Inbox as usual.
    Object.entries(byGroup).forEach(([g, lines]) => rows.push({ customer_id: cust[i], order_date: today(), required_date: date, special, source: 'admin', lines,
      status: g === 'Conventional' ? 'complete' : 'submitted', direct: g === 'Conventional' }));
  });
  if (!rows.length) return toast('Nothing to import: every store or line is skipped.');
  const dup = rows.filter(r => S.orders.some(o => o.special === special && o.customer_id === r.customer_id));
  if (dup.length && !confirm(`${special} has already been imported for ${[...new Set(dup.map(r => custOf(r.customer_id)?.name))].join(', ')}. Import it again?`)) return;
  btn.disabled = true;
  const { error } = await sb.from('orders').insert(rows);
  if (error) { btn.disabled = false; return toast(friendly(error)); }
  // Remember the matches for next time.
  await Promise.all([
    sb.from('po_stores').upsert(po.cols.map((c, i) => ({ label: poKey(c.label), customer_id: cust[i] === 'skip' ? null : cust[i], updated_at: new Date().toISOString() }))),
    sb.from('po_items').upsert(po.lines.map((l, j) => ({ description: poKey(l.desc), pack_id: pk[j] === 'skip' ? null : pk[j], updated_at: new Date().toISOString() })))]);
  $('#dlg').close(); po = null; S.poMatch = null;
  const nd = rows.filter(r => r.direct).length, ni = rows.length - nd;
  await reloadOrders(); if (nd) { listFilter = 'received'; go('orders', false); } else go('inbox', false);
  toast(`${special}: ${[nd && `${nd} order${nd > 1 ? 's' : ''} on the Received tab`, ni && `${ni} Organic order${ni > 1 ? 's' : ''} in the Inbox`].filter(Boolean).join(' and ')}`, true);
  autoCsv2();
}
// Administration › PO Matching: the remembered store and product matches used by Import purchase order.
async function loadPoMatch() {
  const [st, it] = await Promise.all([sb.from('po_stores').select('*').order('label'), sb.from('po_items').select('*').order('description')]);
  if (st.error || it.error) { S.poMatch = { error: friendly(st.error || it.error) }; } else S.poMatch = { stores: st.data, items: it.data };
  if (view === 'pomatch') render();
}
function viewPoMatch() {
  const m = S.poMatch;
  const head = `<h1>PO Matching</h1><p class="sub">How Import purchase order reads a buyer’s PDF: which customer each store column is, and which of our products each of their product lines is. Changes save straight away and apply to the next import.</p>`;
  if (!m) return head + '<div class="card empty">Loading…</div>';
  if (m.error) return head + `<div class="card empty">${esc(m.error)} (needs migration 034).</div>`;
  const custOpts = sel => `<option value="" ${sel ? '' : 'selected'}>Don’t import this store</option>${S.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${esc(c.cid)})</option>`).join('')}`;
  const packList = S.products.slice().sort(byName).flatMap(p => (p.product_packs || []).map(k => ({ id: k.id, t: `${p.name} · ${k.name} (${groupOf(p)}${p.active === false ? ', hidden from order forms' : ''}${k.available ? '' : ', not available'})` })));
  const packOpts = sel => `<option value="" ${sel ? '' : 'selected'}>Skip this line</option>${packList.map(k => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${esc(k.t)}</option>`).join('')}`;
  return head + `<h2 style="margin-top:8px">Stores (${m.stores.length})</h2>
    ${m.stores.length ? `<div class="tablewrap"><table><thead><tr><th>Store on the PO</th><th>Customer</th><th></th></tr></thead><tbody>${m.stores.map((r, i) => `<tr><td class="mono">${esc(r.label)}</td><td><select style="width:100%" onchange="savePoMatch('stores',${i},this.value)">${custOpts(r.customer_id)}</select></td><td class="num"><button class="ghost" onclick="delPoMatch('stores',${i})">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No stores matched yet. They’re added the first time you import a PO.</div>'}
    <h2 style="margin-top:16px">Products (${m.items.length})</h2>
    ${m.items.length ? `<div class="tablewrap"><table><thead><tr><th>Product on the PO</th><th>Our product</th><th></th></tr></thead><tbody>${m.items.map((r, i) => `<tr><td>${esc(r.description)}</td><td style="min-width:320px"><select style="width:100%" onchange="savePoMatch('items',${i},this.value)">${packOpts(r.pack_id)}</select></td><td class="num"><button class="ghost" onclick="delPoMatch('items',${i})">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No products matched yet. They’re added the first time you import a PO.</div>'}
    <p class="muted" style="margin-top:10px">Remove a match to be asked again on the next import.</p>`;
}
const PO_T = { stores: ['po_stores', 'label', 'customer_id'], items: ['po_items', 'description', 'pack_id'] };
async function savePoMatch(kind, i, val) {
  const [t, key, col] = PO_T[kind], r = S.poMatch[kind][i];
  const { error } = await sb.from(t).update({ [col]: val || null, updated_at: new Date().toISOString() }).eq(key, r[key]);
  if (error) return toast(friendly(error));
  r[col] = val || null; toast('Match saved', true);
}
async function delPoMatch(kind, i) {
  const [t, key] = PO_T[kind];
  const { error } = await sb.from(t).delete().eq(key, S.poMatch[kind][i][key]);
  if (error) return toast(friendly(error));
  S.poMatch[kind].splice(i, 1); render(); toast('Match removed', true);
}
const finished = o => o.status === 'complete' && !!o.emailed_at && !!o.received_at && !!o.csv_at;
// Rule: a Complete-tab order whose required date has passed can't be emailed or uploaded again.
const pastDate = o => !!o.required_date && o.required_date < today();
const pastDone = o => o.direct || (finished(o) && pastDate(o)); // Email column: direct orders are never emailed
const nothingDelivered = o => (o.lines || []).length > 0 && o.lines.every(l => l.undelivered); // Receiver flagged every line Not delivered
const noUpload = o => nothingDelivered(o) || (o.direct ? !!o.csv_at && pastDate(o) : finished(o) && pastDate(o)); // Upload column: direct orders get their CSV here (Condition 2 folder)
function viewOrders() {
  // Pending holds every transmitted order until it is Complete, Emailed, Received and has its CSV; then it moves to Complete.
  // Orders still in the Inbox (sent by a customer, not yet transmitted) stay out of Pending.
  // Pending holds every order (Sent ones included) until it is Complete, Emailed, Received and has its CSV; then it
  // moves to Complete. Received holds the Conventional orders customers send (they skip the Inbox); they stay there,
  // showing CSV once someone has created it with Create upload CSV.
  // Direct orders sit on Received until they are Complete with their CSV saved, then move to Complete.
  const inTab = (o, f) => o.direct ? f === (o.status === 'complete' && o.csv_at ? 'complete' : 'received') : f === 'pending' ? !finished(o) : f === 'complete' ? finished(o) : f !== 'received' && o.status === f;
  dropPastDone();
  let os = S.orders.filter(o => inTab(o, listFilter));
  const q = search.trim().toLowerCase();
  if (q) os = os.filter(o => [orderNo(o.number), custOf(o.customer_id)?.name, custOf(o.customer_id)?.cid].join(' ').toLowerCase().includes(q));
  if (listFilter === 'pending' || listFilter === 'received') os = [...os].sort((x, y) => (x.required_date || '9999').localeCompare(y.required_date || '9999') || x.number - y.number); // earliest required date on top
  const isLater = o => listFilter === 'pending' && (o.required_date || '') > tomorrow(), bulk = os.filter(o => !isLater(o)); // shaded rows aren't group-selected
  const count = f => S.orders.filter(o => inTab(o, f)).length;
  return `<div class="pagehead ordhead"><div class="row spread"><div><h1>Orders</h1><p class="sub">Every order, whether a customer sent it or you entered it.</p></div><button class="primary" onclick="go('entry')">New order</button></div>
    <div class="row" style="margin-bottom:12px">
      ${['pending', 'draft', 'received', 'complete'].map(f => `<button class="${listFilter === f ? 'primary' : ''}" onclick="listFilter='${f}';render()">${f === 'pending' ? 'Pending' : f === 'draft' ? 'Drafts' : f === 'received' ? 'Received' : 'Complete'} (${count(f)})</button>`).join('')}
      <input class="search" id="osearch" placeholder="Search order no., customer or CID" value="${esc(search)}">
    </div>
        <div class="pickbar row spread"><span id="pickcount">${pickText()}</span><div class="row"><button id="pickclear" ${picked.size || upPicked.size ? '' : 'hidden'} onclick="picked.clear();upPicked.clear();render()">Clear</button>${autoSwitch()}<button class="primary" id="pickup" ${upPicked.size ? '' : 'disabled'} onclick="uploadCsvs()">Create upload CSV</button><button class="primary" id="pickmail" ${picked.size ? '' : 'disabled'} onclick="emailPicked()">Email selected</button></div></div></div>
    ${auto2Banner()}
    ${os.length ? `<div class="tablewrap stickyhead"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>From</th><th class="num lines">Lines</th><th><div class="stgrid"><span>Status</span><span>Emailed</span><span>Received</span><span>CSV</span></div></th><th class="openc"></th><th class="pick"><span class="picklbl">Upload</span><input type="checkbox" id="upall" aria-label="Select all orders shown for upload" ${bulk.some(o => !noUpload(o)) && bulk.every(o => noUpload(o) || upPicked.has(o.id)) ? 'checked' : ''} ${bulk.every(noUpload) ? 'disabled' : ''}></th><th class="pick"><span class="picklbl">Email</span><input type="checkbox" id="pickall" aria-label="Select all orders shown for emailing" ${bulk.some(o => !pastDone(o)) && bulk.every(o => pastDone(o) || picked.has(o.id)) ? 'checked' : ''} ${bulk.every(pastDone) ? 'disabled' : ''}></th></tr></thead><tbody>${os.map(o => orderRow(o, { source: true, pick: true, later: isLater(o) })).join('')}</tbody></table></div>`
      : `<div class="card empty">${S.orders.length ? 'No orders match this filter.' : 'No orders yet.'}</div>`}
    <p class="muted" style="margin-top:10px">Showing unfinished orders and the last ${recentDays()} days. ${q ? `<button class="link" onclick="searchOlder(this)">Search older orders for “${esc(search.trim())}”</button>` : 'Type an order number, customer or CID in the search box to look further back.'}</p>`;
}
// The list holds unfinished orders and the last 2 weeks; this looks further back in the database.
async function searchOlder(btn) {
  const q = search.trim(), ql = q.toLowerCase(); if (!q) return;
  const num = +(q.match(/^(?:so-?)?0*(\d+)$/i)?.[1] || 0);
  const ids = S.customers.filter(c => (c.name || '').toLowerCase().includes(ql) || String(c.cid) === q).map(c => c.id);
  if (!num && !ids.length) return toast('No order number, customer or CID matches that search.');
  btn.disabled = true;
  let r = sb.from('orders').select('*').order('number', { ascending: false }).limit(500);
  r = num && ids.length ? r.or(`number.eq.${num},customer_id.in.(${ids.join(',')})`) : num ? r.eq('number', num) : r.in('customer_id', ids);
  const { data, error } = await r;
  btn.disabled = false;
  if (error) return toast(friendly(error));
  const n = addOlder(data); render();
  toast(n ? `${n} older order${n > 1 ? 's' : ''} added. Older finished orders are on the Complete tab.` : 'No older orders found for that search.', n > 0);
}
// My orders: the last 2 months, and the rest on request.
async function showOlderMine(btn) {
  btn.disabled = true;
  const { data, error } = await sb.from('orders').select('*').order('number', { ascending: false }).limit(1000);
  btn.disabled = false;
  if (error) return toast(friendly(error));
  addOlder(data); olderMine = true; render();
}
function wireOrderSearch() {
  const i = $('#osearch'); if (!i) return; i.oninput = () => { search = i.value; render(); const j = $('#osearch'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); };
  // Two tick columns: Upload (CSV) and Email, each with its own select-all box.
  const sync = () => { $('#pickcount').textContent = pickText(); $('#pickmail').disabled = !picked.size; $('#pickup').disabled = !upPicked.size; $('#pickclear').hidden = !picked.size && !upPicked.size; };
  [['pick', picked, 'pickall'], ['up', upPicked, 'upall']].forEach(([key, set, allId]) => {
    // Select-all skips shaded (later) rows; those are ticked by hand. Unticking select-all clears every box.
    const boxes = [...document.querySelectorAll(`input[data-${key}]:not(:disabled)`)], bulk = boxes.filter(b => !b.closest('tr.later')), all = $('#' + allId);
    const syncAll = () => { if (all) all.checked = bulk.length && bulk.every(b => b.checked); sync(); };
    boxes.forEach(b => b.onchange = () => { b.checked ? set.add(b.dataset[key]) : set.delete(b.dataset[key]); syncAll(); });
    if (all) all.onchange = () => { (all.checked ? bulk : boxes).forEach(b => { b.checked = all.checked; all.checked ? set.add(b.dataset[key]) : set.delete(b.dataset[key]); }); sync(); };
  });
}
const pickText = () => picked.size || upPicked.size ? [upPicked.size && `${upPicked.size} for upload`, picked.size && `${picked.size} to email`].filter(Boolean).join(' · ') : 'Tick orders on the right to create an upload CSV or email them to the supplier.';
// On a phone or tablet (iPhone, iPad or Android), suggest adding the site to the home screen so it opens like an app.
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
// Chrome on Android can install the app with one tap; it offers this through beforeinstallprompt.
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (view === 'mine' && canRedraw()) render(); });
addEventListener('appinstalled', () => { installPrompt = null; $('#hometip')?.remove(); });
async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt(); const { outcome } = await installPrompt.userChoice; installPrompt = null;
  if (outcome === 'accepted') $('#hometip')?.remove(); else render();
}
function homeTip() {
  let hidden = false; try { hidden = localStorage.getItem('smfw-hometip') === 'off'; } catch (e) {}
  if (hidden || isStandalone() || !(isIos() || isAndroid())) return '';
  const steps = isIos()
    ? `<ol><li>Tap <b>Share</b> <span class="ht-share" aria-hidden="true">⬆︎</span> in Safari</li><li>Tap <b>Add to Home Screen</b></li></ol>`
    : installPrompt
      ? `<button class="ht-install" onclick="installApp()">Add to Home Screen</button>`
      : `<ol><li>Tap the menu <span class="ht-share" aria-hidden="true">⋮</span> at the top right of Chrome</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b></li></ol>`;
  const hide = `try{localStorage.setItem('smfw-hometip','off')}catch(e){};document.getElementById('hometip').remove()`;
  return `<div class="hometip" id="hometip" role="note"><div class="ht-icon" aria-hidden="true">📱</div><div class="ht-body">
    <b class="ht-title">Put Coolibah Orders on your Home Screen</b>
    ${steps}
    <span class="ht-sub">It then opens like an app, straight to your orders.</span></div>
    <button class="ht-x" aria-label="Hide this tip" onclick="${hide}">✕</button></div>`;
}
function viewMine() {
  const os = S.orders, many = S.customers.length > 1;
  const me = custOf(curCust());
  const head = many
    ? `<label class="f custpicker">Ordering for<select id="mycust" onchange="pickCust(this.value)">${myCusts().map(c => `<option value="${c.id}" ${c.id === me?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`
    : me?.name ? `<p class="custname">${esc(me.name)}</p>` : '';
  return `${homeTip()}<div class="row spread"><div>${head}<h1>My orders</h1></div><button class="primary" onclick="go('entry')">New order</button></div>
    ${os.length ? `<div class="tablewrap mine"><table><thead><tr><th>Order</th>${many ? '<th>Customer</th>' : ''}<th>Required</th><th class="num lines">Lines</th><th>Status</th><th class="acts"></th></tr></thead><tbody>${os.map(o => orderRow(o, { customer: many, acts: true })).join('')}</tbody></table></div>`
      : `<div class="card empty">You haven’t placed any orders ${olderMine ? 'yet' : 'in the last 2 months'}. Press <b>New order</b> to start one.</div>`}
    ${olderMine ? '' : `<p class="muted" style="margin-top:10px">Showing the last 2 months. <button class="link" onclick="showOlderMine(this)">Show older orders</button></p>`}`;
}
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  draft = { id, number: o.number, direct: !!o.direct, customer_id: o.customer_id, order_date: o.order_date, required_date: o.required_date || '', special: o.special || '', special_order: !!o.special_order, status: o.status, source: o.source, submitted_at: o.submitted_at, updated_at: o.updated_at, qty: {} };
  (o.lines || []).forEach(l => { if (l.pack_id) draft.qty[l.pack_id] = l.qty; });
  // Keep what a Receiver recorded (ordered_qty, undelivered) when an admin re-saves the order.
  draft.receipt = Object.fromEntries((o.lines || []).filter(l => l.pack_id && (l.ordered_qty != null || l.undelivered || l.received)).map(l => [l.pack_id, { ordered_qty: l.ordered_qty, undelivered: !!l.undelivered, received: !!l.received }]));
  draft.missing = (o.lines || []).filter(l => !packOf(l.pack_id));
  // An order's location comes from its products; one with none it can find takes its customer's location
  // (SMFW's own orders with no customer are Conventional).
  const c = custOf(o.customer_id);
  draft.group = !isAdmin() && custGroup(c) !== 'Both' ? custGroup(c) : orderGroups(o).length ? orderGroup(o) : o.customer_id ? custDefault(c) : 'Conventional';
  go('entry', false);
}

// ---------- customers a login orders for ----------
// A customer login can order for several businesses (migrations/017); the app only receives the customers it may order for.
const myCusts = () => S.customers.slice().sort(byName);
function curCust() {
  let id = null; try { id = localStorage.getItem('smfw-cust'); } catch (e) {}
  return S.customers.some(c => c.id === id) ? id : S.customers.some(c => c.id === profile?.customer_id) ? profile.customer_id : myCusts()[0]?.id || profile?.customer_id;
}
function pickCust(id) {
  if (draft && !draft.id && view === 'entry') {
    const g = custAllows(custOf(id), draft.group) ? draft.group : custDefault(custOf(id));
    if (g !== draft.group && Object.values(draft.qty).some(q => q > 0) && !confirm(`${custOf(id)?.name} orders ${g} products, so the quantities entered so far will be cleared. Continue?`)) return render();
    if (g !== draft.group) draft.qty = {};
    draft.customer_id = id; draft.group = g;
  }
  try { localStorage.setItem('smfw-cust', id); } catch (e) {}
  render();
}
// Logins linked to a customer: their main customer or a linked one.
const loginCustIds = u => [...new Set([u.customer_id, ...(S.links || []).filter(l => l.profile_id === u.id).map(l => l.customer_id)].filter(Boolean))];

// ---------- order entry ----------
function blankOrder() { return { id: null, number: null, customer_id: isAdmin() ? '' : curCust(), order_date: today(), required_date: '', special: '', special_order: false, status: 'draft', source: isAdmin() ? 'admin' : 'customer', qty: {}, missing: [], group: isAdmin() ? 'Organic' : custDefault(custOf(curCust())) }; }
const outerOf = k => Number(k.outer_multiple) || 1;
// A product hidden from order forms still shows on an order that already has it (e.g. one made by Import purchase order).
const shownOnForm = p => p.active !== false || (p.product_packs || []).some(k => +draft?.qty?.[k.id] > 0);
function sectionsFor(products) {
  const secs = [], idx = {};
  products.filter(shownOnForm).sort(bySort).forEach(p => {
    const name = p.section || 'Other';
    if (!(name in idx)) { idx[name] = secs.length; secs.push({ name, packs: [], products: [] }); }
    const s = secs[idx[name]]; s.products.push(p);
    (p.product_packs || []).forEach(k => { if (!s.packs.includes(k.name)) s.packs.push(k.name); });
  });
  return secs;
}
function gridHtml(secs, dis) {
  return secs.map(sec => `<div class="sec"><table><thead><tr><th colspan="2"><span class="sectitle">${esc(sec.name)}</span></th>${sec.packs.map(pk => `<th class="packh">${esc(pk)}</th>`).join('')}</tr></thead><tbody>
    ${sec.products.map(p => `<tr><td class="code">${esc(p.code)}</td><td>${esc(p.name)}</td>${sec.packs.map(pk => {
      const k = (p.product_packs || []).find(x => x.name === pk);
      if (!k || !k.available) return `<td class="na"${k ? ` title="${esc(pk)} is not available for ${esc(p.name)}"` : ''}></td>`;
      const q = draft.qty[k.id];
      return `<td class="q"><input inputmode="numeric" ${dis} aria-label="${esc(p.name)}, ${esc(pk)}" title="SID ${esc(k.sid)}" data-k="${k.id}" data-pk="${esc(pk)}" value="${esc(q || '')}" class="${q ? 'has' : ''}"></td>`;
    }).join('')}</tr>`).join('')}
  </tbody></table></div>`).join('');
}
// Flat view: one list per pack type, holding only the products available in that pack.
function flatHtml(products, dis) {
  // Pack types follow the order form's column order.
  const packs = [], rows = {};
  sectionsFor(products).forEach(sec => sec.packs.forEach(pk => { if (!(pk in rows)) { packs.push(pk); rows[pk] = []; } }));
  products.filter(shownOnForm).sort(bySort).forEach(p => (p.product_packs || []).filter(k => k.available).forEach(k => rows[k.name]?.push({ p, k })));
  packs.splice(0, packs.length, ...packs.filter(pk => rows[pk].length));
  return `<div class="flat">${packs.map(pk => `<div class="sec flatsec"><table><colgroup><col style="width:52px"><col><col style="width:90px"></colgroup><thead><tr><th colspan="2"><span class="sectitle">${esc(pk)}</span> <span class="muted" style="font-weight:400">${rows[pk].length} products</span></th><th class="packh">Qty</th></tr></thead><tbody>
    ${rows[pk].map(({ p, k }) => { const q = draft.qty[k.id]; return `<tr><td class="code">${esc(p.code)}</td><td>${esc(p.name)}</td><td class="q"><input inputmode="numeric" ${dis} aria-label="${esc(p.name)}, ${esc(pk)}" title="SID ${esc(k.sid)}" data-k="${k.id}" value="${esc(q || '')}" class="${q ? 'has' : ''}"></td></tr>`; }).join('')}
  </tbody></table></div>`).join('')}</div>`;
}
// What was ordered, one line per product and pack, in the order form's order. Short or undelivered lines are marked.
function orderedHtml(d) {
  const o = S.orders.find(x => x.id === d.id), pos = new Map(S.products.slice().sort(bySort).map((p, i) => [p.id, i]));
  const ls = (o?.lines || []).filter(l => +l.qty > 0 || l.undelivered || +l.ordered_qty > 0).slice()
    .sort((a, b) => (pos.get(a.product_id) ?? 1e9) - (pos.get(b.product_id) ?? 1e9) || String(a.pack_name).localeCompare(b.pack_name));
  if (!ls.length) return '<div class="card empty" style="margin-top:16px">Nothing was ordered.</div>';
  const qtyOf = l => l.undelivered ? `<span class="ndtxt">Not delivered</span>` : l.ordered_qty != null && +l.qty < +l.ordered_qty ? `${+l.qty} <span class="muted">of ${+l.ordered_qty}</span>` : esc(+l.qty);
  return `<section class="supplier-block ordered"><div class="supplier-head"><h2>What was ordered</h2><span>${ls.length} line${ls.length === 1 ? '' : 's'}</span></div>
    <div class="tablewrap"><table><thead><tr><th>Product</th><th>Pack</th><th class="num">Qty</th></tr></thead><tbody>
    ${ls.map(l => { const p = prodOf(l.product_id); return `<tr${l.undelivered ? ' class="nd"' : ''}><td><b>${esc(l.product_name || p?.name || '')}</b>${p?.code || l.code ? ` <span class="muted mono" style="font-size:12px">${esc(p?.code || l.code)}</span>` : ''}</td><td>${esc(l.pack_name || '')}</td><td class="num">${qtyOf(l)}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
}
// Cancel leaves the order screen without saving. A new order is dropped; a saved draft keeps its last saved version.
function cancelOrder() {
  if (draftLines().length && !confirm(draft.id ? 'Leave without saving? Your last saved draft is kept.' : 'Cancel this order? Nothing will be saved.')) return;
  draft = null; go('mine', false);
}
// ---------- favourite orders (migrations/029) ----------
// A customer saves an order's products and quantities under a name and starts a new order from it later.
// Favourites belong to the business, so every login for it sees them. The delivery date is never saved.
async function loadFavs() {
  const { data, error } = await sb.from('favourites').select('*').order('name');
  if (!error) S.favs = data || [];
}
const favsFor = cid => (S.favs || []).filter(f => f.customer_id === cid && custAllows(custOf(cid), f.product_group));
const draftGroup = d => custGroup(custOf(d.customer_id)) === 'Both' ? (d.group || 'Organic') : custGroup(custOf(d.customer_id));
// The lines to keep: what was ordered on a sent order (before any delivery changes), or what is entered on a draft.
function favLines(d) {
  const o = d.id && d.status !== 'draft' ? S.orders.find(x => x.id === d.id) : null;
  const ls = o ? (o.lines || []).map(l => ({ pack_id: l.pack_id, qty: +(l.ordered_qty ?? l.qty), product_name: l.product_name, pack_name: l.pack_name })) : draftLines();
  return ls.filter(l => l.pack_id && l.qty > 0).map(l => ({ pack_id: l.pack_id, qty: l.qty, name: `${l.product_name} (${l.pack_name})` }));
}
function favPicker(d) {
  const fs = favsFor(d.customer_id);
  if (d.status !== 'draft' || !fs.length) return '';
  const both = custGroup(custOf(d.customer_id)) === 'Both';
  // A login that orders for several businesses sees only the favourites of the one chosen under Ordering for.
  return `<div class="favpick"><label class="f">Start from a favourite${S.customers.length > 1 ? ` for ${esc(custOf(d.customer_id)?.name || '')}` : ''}<select onchange="useFav(this.value)"><option value="">Choose a favourite…</option>${fs.map(f => `<option value="${f.id}">★ ${esc(f.name)}${both ? ` (${f.product_group})` : ''}</option>`).join('')}</select></label>
    <button class="link" onclick="manageFavs()">Manage favourites</button></div>`;
}
// Fill the order form from saved lines. Anything no longer available is left out, and the customer is told.
function fillDraft(g, lines, label) {
  const qty = {}, skipped = [];
  for (const l of lines) {
    const x = packOf(l.pack_id);
    if (!x || x.p.active === false || !x.k.available || groupOf(x.p) !== g) skipped.push(l.name || 'a product no longer listed');
    else qty[x.k.id] = +l.qty;
  }
  draft.group = g; draft.qty = qty; render();
  toast(skipped.length ? `${label} loaded. Not available at the moment, so left out: ${skipped.join(', ')}.` : `${label} loaded. Check the quantities, then choose the delivery date.`, !skipped.length);
}
function useFav(id) {
  const f = (S.favs || []).find(x => x.id === id); if (!f) return;
  if (draftLines().length && !confirm(`Replace the quantities you’ve entered with your favourite “${f.name}”?`)) return render();
  fillDraft(f.product_group, f.lines || [], `“${f.name}”`);
}
async function saveFav() {
  const d = draft, lines = favLines(d);
  if (!lines.length) return toast('Enter some quantities first.');
  const fs = favsFor(d.customer_id);
  const day = d.required_date ? new Date(d.required_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long' }) + ' order' : 'My usual order';
  const name = (prompt('Name this favourite, for example “Monday order”:', day) || '').trim().slice(0, 60);
  if (!name) return;
  const same = fs.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (same && !confirm(`You already have a favourite called “${same.name}”. Replace it with this order?`)) return;
  const row = { customer_id: d.customer_id, name: same?.name || name, product_group: draftGroup(d), lines, updated_at: new Date().toISOString() };
  const { error } = await sb.from('favourites').upsert(row, { onConflict: 'customer_id,name' });
  if (error) return toast(friendly(error));
  await loadFavs(); render();
  toast(`Saved as your favourite “${row.name}”`, true);
}
// Start a new order with the same products and quantities as the one being viewed.
function repeatOrder() {
  const d = draft, lines = favLines(d), g = draftGroup(d);
  draft = blankOrder(); draft.customer_id = d.customer_id; view = 'entry';
  fillDraft(g, lines, `Order ${orderNo(d.number)}`); window.scrollTo(0, 0);
}
function manageFavs() {
  const fs = favsFor(draft.customer_id);
  openDialog('Your favourites', `<p class="sub" style="margin:0">Tick any you no longer need, then press Save to delete them.</p>
    <div class="grid" style="gap:6px">${fs.map(f => `<label class="chk"><input type="checkbox" name="del" value="${f.id}"> ★ ${esc(f.name)} <span class="muted">· ${(f.lines || []).length} line${(f.lines || []).length === 1 ? '' : 's'}</span></label>`).join('')}</div>`,
    async f => {
      const ids = f.getAll('del'); if (!ids.length) return true;
      if (!(await run(sb.from('favourites').delete().in('id', ids)))) return false;
      await loadFavs(); toast(`${ids.length} favourite${ids.length > 1 ? 's' : ''} deleted`, true); return true;
    });
}
function canEditDraft() {
  if (isAdmin()) return draft.status !== 'complete' || !!draft.direct; // Received-tab orders stay editable
  return draft.status === 'draft';
}
function viewEntry() {
  const d = draft, admin = isAdmin(), editable = canEditDraft();
  const dis = editable ? '' : 'disabled';
  let blocks;
  if (admin) {
    // Admins enter one group at a time: the form shows only the Organic or only the Conventional products.
    const g = d.group || 'Organic';
    // SMFW's own Conventional orders (No customer, CID 1183) and Special Orders leave out the Vegetables and Drinks sections, apart from lines already on the order.
    const smfwCust = !d.customer_id || String(custOf(d.customer_id)?.cid) === String(CONVENTIONAL_CID) || !!d.special_order;
    const smfwHide = p => g === 'Conventional' && smfwCust && smfwSection(p.section) && !(p.product_packs || []).some(k => +d.qty?.[k.id] > 0);
    blocks = S.suppliers.slice().sort(byName).map(s => {
      const ps = S.products.filter(p => p.supplier_id === s.id && groupOf(p) === g && !smfwHide(p)), secs = sectionsFor(ps); if (!secs.length) return '';
      return `<section class="supplier-block"><div class="supplier-head"><h2>${esc(s.name)}</h2><span>${esc(s.cutoff || '')}</span></div><div class="sections">${g === 'Conventional' ? flatHtml(ps, dis) : gridHtml(secs, dis)}</div></section>`;
    }).join('') || `<div class="card empty" style="margin-top:16px">No ${g} products are set up yet. Add them under <b>Products</b>.</div>`;
  } else {
    // Customers order their own group only (set on the customer), or pick one if set to Both; Conventional uses the same flat list as the admin app.
    const g = custGroup(custOf(d.customer_id)) === 'Both' ? (d.group || 'Organic') : custGroup(custOf(d.customer_id)), mine = S.products.filter(p => groupOf(p) === g), secs = sectionsFor(mine);
    blocks = secs.length ? `<section class="supplier-block"><div class="supplier-head"><h2>${g}</h2><span>${g === 'Conventional' ? 'Fill in the quantities you need.' : 'Fill in the boxes you need. Grey boxes aren’t available.'}</span></div><div class="sections">${g === 'Conventional' ? flatHtml(mine, dis) : gridHtml(secs, dis)}</div></section>` : '';
  }
  // Show mode (an order that can't be changed): just what was ordered, not the whole product list.
  if (!editable) blocks = orderedHtml(d);
  const custField = admin
    ? `<label class="f">Customer<select id="e-cust" ${dis}><option value="">${needsCustomer(d) ? 'Choose a customer…' : 'No customer (SMFW, CID 1183)'}</option>${S.customers.filter(c => custAllows(c, d.group || 'Organic') || c.id === d.customer_id).sort(byName).map(c => `<option value="${c.id}" ${c.id === d.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
       <label class="f">Contact phone<input id="e-phone" disabled value="${esc(custOf(d.customer_id)?.phone || '')}"></label>`
    : S.customers.length > 1 && !d.id
      ? `<label class="f">Ordering for<select id="e-mycust" onchange="pickCust(this.value)">${myCusts().map(c => `<option value="${c.id}" ${c.id === d.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`
      : `<label class="f">Customer<input disabled value="${esc(custOf(d.customer_id)?.name || '')}"></label>`;
  const locField = !admin && custGroup(custOf(d.customer_id)) === 'Both'
    ? `<label class="f">Product location<select id="e-loc" ${dis || (d.id && draftLines().length ? 'disabled' : '')} onchange="setGroup(this.value)">${GROUPS.map(g => `<option value="${g}" ${(d.group || 'Organic') === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>` : '';
  const note = d.status === 'complete' ? (admin ? 'This order is complete. Reopen it to make changes.' : 'SMFW has accepted this order.')
    : d.status === 'submitted' ? (admin ? `Sent by the customer ${esc(fmtWhen(d.submitted_at))}. Check it, make any changes, then mark it complete.` : 'You’ve sent this order to SMFW. Contact SMFW if anything needs to change.')
    : 'Fill in the quantities needed. Empty boxes are ignored.';
  const missing = d.missing?.length ? `<div class="banner">${d.missing.length} line${d.missing.length > 1 ? 's refer' : ' refers'} to a pack type that no longer exists: ${d.missing.map(l => esc(`${l.product_name} (${l.pack_name}) × ${l.qty}`)).join(', ')}. Saving will drop ${d.missing.length > 1 ? 'them' : 'it'}.</div>` : '';
  return `<div class="row spread"><div><h1>${d.id ? 'Order ' + esc(orderNo(d.number)) : 'New order'}</h1><p class="sub">${note}</p></div>
      <span class="pill ${d.status}">${esc(statusText(d.status))}</span></div>${missing}
    <div class="entry"><div>
      ${admin ? `<div class="grpswitch" role="radiogroup" aria-label="Order type">${GROUPS.map(g => `<button type="button" role="radio" aria-checked="${(d.group || 'Organic') === g}" class="${(d.group || 'Organic') === g ? 'on' : ''}" ${dis} onclick="setGroup('${g}')">${g} order</button>`).join('')}</div>` : ''}
      <div class="card grid g2">
        ${admin ? '' : '<div class="grid datecol">'}${custField}${locField}${admin ? '' : favPicker(d) + '</div><div class="grid datecol">'}
        ${admin ? `<label class="f">Today’s date<input type="date" id="e-date" disabled title="Set automatically" value="${esc(d.status === 'draft' ? today() : d.order_date)}"></label>` : `<div class="f datebox"><span class="dl">Today’s date</span><span class="dv">${esc(fmtDate(d.status === 'draft' ? today() : d.order_date))}</span>`}
        ${admin ? '<div class="f">' : ''}<label for="e-req">Day / date required</label><div class="reqrow"><input type="date" id="e-req" ${dis} ${d.status === 'draft' ? `min="${earliestReq(d.group || 'Organic', custOf(d.customer_id))}"` : ''} max="${latestReq()}" value="${esc(d.required_date)}">${spoBox(d, dis)}</div>${!admin && d.status === 'draft' && custHint(d.group || 'Organic', custOf(d.customer_id)) ? `<span class="muted" style="font-size:12px;font-weight:400">${custHint(d.group || 'Organic', custOf(d.customer_id))}</span>` : ''}</div>${admin ? '' : '</div>'}
        ${admin ? `<label class="f" style="grid-column:1/-1">Special requirements<span class="muted" style="font-size:12px;font-weight:400">Printed on the supplier order form.</span><textarea id="e-special" ${dis}>${esc(d.special)}</textarea></label>` : ''}
      </div>
      ${editable ? `<div class="row" style="margin-top:16px"><input class="search" id="e-find" placeholder="Find a product by name or code"></div>` : ''}
      ${blocks || '<div class="card empty" style="margin-top:16px">No products are set up yet.</div>'}
      ${admin ? '' : `<label class="card f custnotes">Special Requirements<textarea id="e-special" maxlength="500" rows="3" placeholder="e.g. deliver to the back door" ${dis}>${esc(d.special)}</textarea></label>`}
    </div>
    <aside class="card summary" id="summary">${summaryHtml()}</aside></div>`;
}
// Special Order: Conventional orders entered by SMFW. Ticked, the upload CSV's H line ends in ,S.
const spoBox = (d, dis) => isAdmin() && (d.group || 'Organic') === 'Conventional'
  ? `<label class="chk spo"><input type="checkbox" id="e-spo" ${dis} ${d.special_order ? 'checked' : ''}>Special Order</label>` : '';
function setGroup(g) {
  if (draft.group === g) return;
  // Quantities belong to one group's form; switching drops the other group's lines after a check.
  const other = Object.entries(draft.qty).filter(([k, q]) => +q > 0 && groupOf(packOf(k)?.p || {}) !== g);
  if (other.length && !confirm(`Switch to a ${g} order? The ${other.length} ${draft.group} line${other.length > 1 ? 's' : ''} already entered will be cleared.`)) return render();
  other.forEach(([k]) => delete draft.qty[k]);
  // A customer set up for the other group only is cleared; a Both customer stays.
  if (isAdmin() && draft.customer_id && !custAllows(custOf(draft.customer_id), g)) draft.customer_id = '';
  draft.group = g; render();
}
function draftLines() {
  return Object.entries(draft.qty).filter(([, q]) => +q > 0).map(([packId, q]) => {
    const f = packOf(packId); if (!f || !f.k.available) return null;
    return { pack_id: f.k.id, product_id: f.p.id, sid: f.k.sid, code: f.p.code || '', product_name: f.p.name, pack_name: f.k.name, outer: outerOf(f.k), qty: +q, ...(draft.receipt?.[packId] || {}) };
  }).filter(Boolean);
}
function summaryHtml() {
  const d = draft, admin = isAdmin(), lines = draftLines();
  const groups = {};
  lines.forEach(l => { const p = prodOf(l.product_id); const g = admin ? (S.suppliers.find(s => s.id === p?.supplier_id)?.name || 'Other') : (p?.section || 'Other'); (groups[g] ||= []).push(l); });
  const body = Object.entries(groups).map(([g, ls]) => `<div class="sumsup">${esc(g)}</div><ul class="sumlist">${ls.map(l => `<li${l.undelivered ? ' class="nd"' : ''}><span>${esc(l.product_name)} <span class="muted">· ${esc(l.pack_name)}</span>${l.undelivered ? ' · NOT DELIVERED' : l.ordered_qty != null && +l.ordered_qty !== +l.qty ? ` <span class="muted">(ordered ${esc(l.ordered_qty)})</span>` : ''}</span><b class="mono">${l.qty}</b></li>`).join('')}</ul>`).join('');
  const got = lines.filter(l => !l.undelivered), nd = lines.length - got.length, total = got.reduce((a, l) => a + l.qty, 0);
  let btns = '';
  if (admin) {
    // Already transmitted: Close goes back to Orders untouched; once reopened, Close gives way to Save / Transmit Order.
    // A Received-tab order (imported PO or a customer's Conventional order) is edited in place; saving re-saves its CSV.
    if (d.status === 'complete' && d.direct) btns = `<button onclick="draft=null;go('orders',false)">Close</button><button class="primary" onclick="saveOrder('complete')">Save changes</button>`;
    else if (d.status === 'complete') btns = `<button onclick="reopenOrder()">Reopen to edit</button><button class="primary" onclick="draft=null;go('orders',false)">Close</button>`;
    else btns = `<button onclick="saveOrder('${d.status === 'submitted' ? 'submitted' : 'draft'}')">${d.status === 'submitted' ? 'Save changes' : 'Save draft'}</button><button class="primary" onclick="saveOrder('complete')">Transmit Order</button>`;
  } else if (d.status === 'draft') btns = `<button onclick="cancelOrder()">Cancel</button><button onclick="saveOrder('draft')">Save draft</button><button class="primary" onclick="saveOrder('submitted')">Send order</button>`;
  else btns = `<button class="primary" onclick="draft=null;go('mine',false)">Close</button>`;
  const del = d.id && (admin || d.status === 'draft') ? `<div class="row" style="margin-top:8px"><button class="danger" onclick="deleteOrder(this)">Delete order</button></div>` : '';
  const favRow = admin ? '' : `<div class="row favrow">${lines.length ? `<button onclick="saveFav()">☆ Save as favourite</button>` : ''}${d.status !== 'draft' && lines.length ? `<button onclick="repeatOrder()">↻ Repeat this order</button>` : ''}</div>`;
  return `<h2>Order summary</h2>
    <p class="muted" style="margin:4px 0 0">${esc(custOf(d.customer_id)?.name || (needsCustomer(d) ? 'No customer chosen' : 'Conventional order'))}${d.required_date ? ' · needed ' + esc(fmtDate(d.required_date)) : ''}</p>
    ${lines.length ? body + `<p style="margin:12px 0 0"><b>${got.length}</b> line${got.length === 1 ? '' : 's'} · <b>${total}</b> in total${nd ? ` · <span class="ndtxt">${nd} not delivered</span>` : ''}</p>` : '<p class="muted">No quantities entered yet.</p>'}
    ${notifyHtml(d)}<div class="row" style="margin-top:16px">${btns}</div>${favRow}${del}`;
}
// ---------- customer emails about missing items (supabase/functions/notify-undelivered) ----------
// Lines the customer is told about: not delivered at all, or delivered short.
const missingOf = o => (o?.lines || []).filter(l => l.undelivered || !(+l.qty > 0) || (l.ordered_qty != null && +l.qty < +l.ordered_qty));
// The function's name as deployed in Supabase (Edge Functions). Its code is supabase/functions/notify-undelivered/index.ts.
const NOTIFY_FN = 'quick-api';
async function notifyCustomer(id, resend = false) {
  const { data, error } = await sb.functions.invoke(NOTIFY_FN, { body: { order_id: id, resend } });
  if (error) { let m = ''; try { m = (await error.context.json()).error; } catch { } return { sent: false, reason: m || `The customer email service didn’t answer (${error.context?.status ? 'error ' + error.context.status : error.message}).` }; }
  return data;
}
function notifyHtml(d) {
  const o = d.id && S.orders.find(x => x.id === d.id);
  if (!isAdmin() || !o?.received_at || !missingOf(o).length) return '';
  return o.customer_notified_at
    ? `<p class="notify ok">Customer emailed about the shortages ${esc(fmtWhen(o.customer_notified_at))}${o.customer_notified_to ? ' to ' + esc(o.customer_notified_to) : ''}. <button class="ghost" onclick="emailCustomer(this, true)">Send again</button></p>`
    : `<p class="notify">Customer not emailed about the shortages yet.${o.notify_error ? ' ' + esc(o.notify_error) : ''} ${o.customer_id ? '<button class="ghost" onclick="emailCustomer(this)">Email customer</button>' : ''}</p>`;
}
async function emailCustomer(btn, resend = false) {
  btn.disabled = true;
  const r = await notifyCustomer(draft.id, resend);
  btn.disabled = false;
  await reloadOrders(); render();
  toast(r.sent ? `Customer emailed (${r.to.join(', ')}).` : r.reason, !!r.sent);
}
function wireEntry() {
  const sync = () => { $('#summary').innerHTML = summaryHtml(); };
  $('#e-cust')?.addEventListener('change', e => {
    draft.customer_id = e.target.value; $('#e-phone').value = custOf(draft.customer_id)?.phone || ''; sync();
    if (isAdmin() && draft.group === 'Conventional') render(); // Vegetables & Drinks shows only for real customers
  });
  $('#e-req')?.addEventListener('change', e => { draft.required_date = e.target.value; sync(); });
  $('#e-special')?.addEventListener('input', e => draft.special = e.target.value);
  $('#e-spo')?.addEventListener('change', e => { draft.special_order = e.target.checked; render(); }); // Special Orders hide Vegetables and Drinks
  document.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
    const v = inp.value.replace(/[^\d]/g, ''); if (v !== inp.value) inp.value = v;
    if (+v > 0) draft.qty[inp.dataset.k] = +v; else delete draft.qty[inp.dataset.k];
    inp.classList.toggle('has', +v > 0); sync();
  }));
  // Enter or Down arrow moves to the next quantity box, Shift+Enter or Up arrow goes back, skipping rows the search hides.
  // Left and Right arrows move across.
  // On the order-form grid this stays in the same pack column, running on through the sections below.
  document.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('keydown', e => {
    const usable = x => !x.closest('tr').hidden && !x.disabled;
    // Left / Right: the next box along the same product row (order form), or the same row of the next pack list (flat view).
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      let next;
      if (inp.dataset.pk !== undefined) { const row = [...inp.closest('tr').querySelectorAll('input[data-k]')].filter(usable); next = row[row.indexOf(inp) + dir]; }
      else {
        const lists = [...document.querySelectorAll('.flatsec')].map(sec => [...sec.querySelectorAll('input[data-k]')].filter(usable)).filter(l => l.length);
        const li = lists.findIndex(l => l.includes(inp)), to = lists[li + dir];
        if (to) next = to[Math.min(lists[li].indexOf(inp), to.length - 1)];
      }
      if (next) { next.focus(); next.select(); }
      return;
    }
    const step = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || e.key === 'Enter' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const all = [...document.querySelectorAll('input[data-k]')].filter(x => !x.closest('tr').hidden && !x.disabled && x.dataset.pk === inp.dataset.pk);
    const next = all[all.indexOf(inp) + step];
    if (next) { next.focus(); next.select(); }
  }));
  $('#e-find')?.addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('.sec tbody tr').forEach(tr => tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q)); });
}
let saving = false;
async function saveOrder(status) {
  if (!(await stillMyDevice())) return;
  if (saving) return;
  const lines = draftLines();
  if (draft.required_date && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.required_date) || draft.required_date > latestReq())) return toast(`The date required must be within the next 12 months (by ${fmtDate(latestReq())}).`);
  if (status !== 'draft') {
    if (needsCustomer(draft) && !draft.customer_id) return toast('Choose a customer first.');
    if (!lines.length) return toast('Enter at least one quantity first.');
    if (!draft.required_date) return toast('Add the day/date required first.');
    // Only checked when the order is placed, so older orders can still be processed after their date.
    const first = earliestReq(draft.group || 'Organic', custOf(draft.customer_id));
    if (draft.status === 'draft' && draft.required_date < first) return toast(`The date required must be ${first === sydNow().date ? 'today' : 'tomorrow'} (${fmtDate(first)}) or later.`);
    if (!isAdmin() && draft.status === 'draft' && draft.required_date) { const why = orderProblem(draft.group || 'Organic', draft.required_date, custOf(draft.customer_id)); if (why) return toast(why); }
  } else if (needsCustomer(draft) && !draft.customer_id) return toast('Choose a customer first.');
  // Today's date is fixed: an order is dated the day it's saved, and keeps that date once it's sent.
  const row = { customer_id: draft.customer_id || null, order_date: draft.status === 'draft' ? today() : draft.order_date || today(), required_date: draft.required_date || null, special: draft.special || null, status, lines };
  if (isAdmin()) row.special_order = draft.group === 'Conventional' && !!draft.special_order;
  if (draft.direct) row.csv_at = null; // back on the Received tab until its CSV is created again (same file name)
  saving = true;
  // An existing order only saves if no one else (another PC, a Receiver) has changed it since it was opened.
  let q = draft.id ? sb.from('orders').update(row).eq('id', draft.id) : null;
  if (q && draft.updated_at) q = q.eq('updated_at', draft.updated_at);
  const { data, error } = await (q ? q.select().maybeSingle() : sb.from('orders').insert({ ...row, source: isAdmin() ? 'admin' : 'customer' }).select().single());
  saving = false;
  if (error) return toast(friendly(error));
  if (!data) {
    const { data: now } = await sb.from('orders').select('id,updated_at').eq('id', draft.id).maybeSingle();
    if (!now || now.updated_at === draft.updated_at) return toast('This order can no longer be changed.');
    const id = draft.id, no = orderNo(draft.number);
    await reloadOrders(); openOrder(id);
    return toast(`Order ${no} was changed by someone else while you had it open, so your changes weren’t saved. It now shows their changes; make yours again and save.`);
  }
  const msg = draft.direct ? `Order ${orderNo(data.number)} saved. ${autoOn() ? 'Its CSV will be saved again.' : 'Create its CSV again on the Received tab.'}` : status === 'complete' ? `Order ${orderNo(data.number)} completed` : status === 'submitted' ? (isAdmin() ? `Order ${orderNo(data.number)} saved` : `Order ${orderNo(data.number)} sent to SMFW`) : `Draft ${orderNo(data.number)} saved`;
  toast(msg, true);
  await reloadOrders();
  const wasDirect = draft.direct;
  draft = null; go(isAdmin() ? (status === 'complete' ? 'orders' : view === 'entry' && data.source === 'customer' ? 'inbox' : 'orders') : 'mine', false);
  if (wasDirect) autoCsv2();
}
async function reopenOrder() {
  const o = S.orders.find(x => x.id === draft.id); if (!o) return;
  const status = o.source === 'customer' ? 'submitted' : 'draft';
  if (await run(sb.from('orders').update({ status, completed_at: null }).eq('id', draft.id), 'Order reopened')) { await reloadOrders(); draft.status = status; render(); }
}
async function deleteOrder(btn) {
  if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Press again to delete'; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = 'Delete order'; } }, 4000); return; }
  if (await run(sb.from('orders').delete().eq('id', draft.id), 'Order deleted')) { await reloadOrders(); draft = null; go(isAdmin() ? 'orders' : 'mine', false); }
}

// ---------- admin: reference lists ----------
// Customers search: rows are shown or hidden in place, so typing never redraws the page or loses the cursor.
let custSearch = '';
const custFindText = c => [c.cid, c.name, c.contact, c.phone, String(c.phone || '').replace(/\s/g, ''), c.email].filter(Boolean).join(' ').toLowerCase();
const custMatch = c => !custSearch.trim() || custSearch.toLowerCase().trim().split(/\s+/).every(w => custFindText(c).includes(w));
function filterCustomers() {
  const ws = custSearch.toLowerCase().trim().split(/\s+/).filter(Boolean); let n = 0;
  document.querySelectorAll('tr[data-find]').forEach(r => { r.hidden = !ws.every(w => r.dataset.find.includes(w)); if (!r.hidden) n++; });
  const cc = $('#cscount'); if (cc) cc.textContent = ws.length ? `${n} of ${S.customers.length}` : '';
}
function viewCustomers() {
  const cs = S.customers.slice().sort(byName);
  // Count orders and logins per customer once, rather than scanning every order for every row.
  const nOrders = new Map(), nLogins = new Map();
  S.orders.forEach(o => nOrders.set(o.customer_id, (nOrders.get(o.customer_id) || 0) + 1));
  if (!isManager()) S.profiles.filter(u => u.role === 'customer').forEach(u => new Set(loginCustIds(u)).forEach(id => nLogins.set(id, (nLogins.get(id) || 0) + 1)));
  return `<div class="pagehead"><div class="row spread"><div><h1>Customers</h1><p class="sub">The businesses who order from you.${isManager() ? '' : ' Link a login to a customer under <b>Administration › Logins</b>.'}</p></div><div class="row"><button onclick="importCustomers()">Import customers</button><button class="primary" onclick="editCustomer()">Add customer</button></div></div>
  ${cs.length ? `<div class="row"><input class="search" id="csearch" placeholder="Search customers" title="Name, CID, contact, phone or email" value="${esc(custSearch)}" oninput="custSearch=this.value;filterCustomers()"><span class="muted" id="cscount">${custSearch.trim() ? `${cs.filter(custMatch).length} of ${cs.length}` : ''}</span></div>` : ''}</div>
  ${cs.length ? `<div class="tablewrap stickyhead"><table><thead><tr><th class="num">CID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>Type</th>${isManager() ? '' : '<th class="num">Logins</th>'}<th class="num" title="Unfinished orders and orders from the last 2 weeks">Recent orders</th><th></th></tr></thead><tbody>
    ${cs.map(c => `<tr data-find="${esc(custFindText(c))}" ${custMatch(c) ? '' : 'hidden'}><td class="num mono">${esc(c.cid)}</td><td><b>${esc(c.name)}</b>${c.sunday_delivery ? ' <span class="pill">Sunday delivery</span>' : ''}${c.reminders !== false && GROUPS.some(g => custAllows(c, g) && S.cutSettings?.find(x => x.product_group === g)?.reminder_minutes) ? ' <span class="pill">Reminders</span>' : ''}${c.notes ? `<div class="muted" style="font-size:12px">${esc(c.notes)}</div>` : ''}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td><span class="pill grp-${custGroup(c).toLowerCase()}">${custGroup(c)}</span></td>${isManager() ? '' : `<td class="num">${nLogins.get(c.id) || 0}</td>`}<td class="num">${nOrders.get(c.id) || 0}</td><td class="num"><button class="ghost" onclick="editCustomer('${c.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No customers yet.</div>`}`;
}
function viewSuppliers() {
  const ss = S.suppliers.slice().sort(byName);
  return `<div class="row spread pagehead"><div><h1>Suppliers</h1><p class="sub">Who you buy from. Customers never see this list.</p></div><button class="primary" onclick="editSupplier()">Add supplier</button></div>
  ${ss.length ? `<div class="tablewrap stickyhead"><table><thead><tr><th>Name</th><th>Order emails</th><th>Cut-off</th><th class="num">Products</th><th></th></tr></thead><tbody>
    ${ss.map(s => `<tr><td><b>${esc(s.name)}</b>${s.notes ? `<div class="muted" style="font-size:12px">${esc(s.notes)}</div>` : ''}</td><td class="mono">${recipientsHtml(s)}</td><td>${esc(s.cutoff)}</td><td class="num">${S.products.filter(p => p.supplier_id === s.id).length}</td><td class="num"><button class="ghost" onclick="editSupplier('${s.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No suppliers yet.</div>`}`;
}
function viewProducts() {
  const blocks = S.suppliers.slice().sort(byName).map(s => {
    const ps = S.products.filter(p => p.supplier_id === s.id && (groupFilter === 'all' || groupOf(p) === groupFilter)).sort(bySort); if (!ps.length) return '';
    return `<section class="supblock"><h2>${esc(s.name)}</h2><div class="tablewrap stickyhead"><table><thead><tr><th>Code</th><th>Product</th><th>Group</th><th>Section</th><th>Pack types · SID · outer</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr${p.active === false ? ' class="muted"' : ''}><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}${p.active === false ? ' <span class="pill">Hidden</span>' : ''}</td><td><span class="pill grp-${groupOf(p).toLowerCase()}">${groupOf(p)}</span></td><td>${esc(p.section)}</td>
      <td class="packs">${(p.product_packs || []).map(k => `<div><span class="mono muted">SID ${esc(k.sid)}</span>${k.ref ? ` <span class="mono muted">· Ref ${esc(k.ref)}</span>` : ''} ${esc(k.name)} <span class="mono muted">· outer ${outerOf(k)}</span>${k.batch_code ? ' <span class="pill">Batch Code</span>' : ''}${k.available ? '' : ' <span class="pill">Not available</span>'}</div>`).join('')}</td>
      <td class="num"><button class="ghost" onclick="editProduct('${p.id}')">Edit</button></td></tr>`).join('')}
    </tbody></table></div></section>`;
  }).join('');
  const n = g => g === 'all' ? S.products.length : S.products.filter(p => groupOf(p) === g).length;
  const filters = `<div class="row" style="margin-bottom:4px">${['all', ...GROUPS].map(g => `<button class="${groupFilter === g ? 'primary' : ''}" onclick="groupFilter='${g}';render()">${g === 'all' ? 'All' : g} (${n(g)})</button>`).join('')}</div>`;
  return `<div class="pagehead"><div class="row spread"><div><h1>Products</h1><p class="sub">Grouped by supplier, in the same sections as their order forms.</p></div>${S.suppliers.length ? `<div class="row"><button onclick="editSections()">Sections</button><button class="primary" onclick="editProduct()">Add product</button></div>` : ''}</div>
  ${S.products.length ? filters : ''}</div>
  ${blocks || `<div class="card empty">${S.products.length ? 'No products in this group yet.' : `No products yet.${S.suppliers.length ? '' : ' Add a supplier first.'}`}</div>`}`;
}
// Logins search: name, email, mobile, business, role or linked customer.
let userSearch = '';
const userFindText = u => [u.full_name, u.email, u.mobile, String(u.mobile || '').replace(/\s/g, ''), u.business, u.role, ...loginCustIds(u).map(id => custOf(id)?.name)].filter(Boolean).join(' ').toLowerCase();
const userMatch = u => !userSearch.trim() || userSearch.toLowerCase().trim().split(/\s+/).every(w => userFindText(u).includes(w));
function filterUsers() {
  const ws = userSearch.toLowerCase().trim().split(/\s+/).filter(Boolean); let n = 0;
  document.querySelectorAll('tr[data-ufind]').forEach(r => { r.hidden = !ws.every(w => r.dataset.ufind.includes(w)); if (!r.hidden) n++; });
  const cc = $('#uscount'); if (cc) cc.textContent = ws.length ? `${n} of ${S.profiles.length}` : '';
}
function viewUsers() {
  const us = S.profiles.slice().sort((a, b) => (a.approved - b.approved) || (a.email || '').localeCompare(b.email || ''));
  const waiting = us.filter(u => !u.approved).length;
  const link = location.origin + location.pathname;
  return `<div class="pagehead"><h1>Logins</h1><p class="sub">Customers create their own account at <span class="mono">${esc(link)}</span>. Link each new account to its customer so they can start ordering.${waiting ? ` <b>${waiting} waiting.</b>` : ''}</p>
  <div class="row"><input class="search" id="usearch" placeholder="Search logins" title="Name, email, mobile, business, role or linked customer" value="${esc(userSearch)}" oninput="userSearch=this.value;filterUsers()"><span class="muted" id="uscount">${userSearch.trim() ? `${us.filter(userMatch).length} of ${us.length}` : ''}</span></div></div>
  <div class="tablewrap stickyhead"><table><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Business they gave</th><th>Role</th><th>Linked customer</th><th>Access</th><th></th></tr></thead><tbody>
  ${us.map(u => `<tr data-ufind="${esc(userFindText(u))}" ${userMatch(u) ? '' : 'hidden'}><td>${esc(u.full_name)}</td><td class="mono">${esc(u.email)}</td><td style="white-space:nowrap">${esc(u.mobile || '')}</td><td>${esc(u.business || '')}</td><td>${u.role === 'admin' ? 'Admin' : u.role === 'manager' ? 'Manager' : u.role === 'receiver' ? 'Receiver' : 'Customer'}</td>
    <td>${['admin', 'manager'].includes(u.role) ? '<span class="muted">All customers</span>' : u.role === 'receiver' ? '<span class="muted">All orders, view only</span>' : loginCustIds(u).map(id => esc(custOf(id)?.name || '')).sort().join('<br>')}</td>
    <td>${u.approved ? '<span class="pill complete">Active</span>' : '<span class="pill draft">Waiting</span>'}</td>
    <td class="num">${u.id === profile.id ? '<span class="muted">You</span>' : `<button class="ghost" onclick="editLogin('${u.id}')">${u.approved ? 'Edit' : 'Approve'}</button>`}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- admin: order emails ----------
// Each supplier has many outgoing addresses. Each one goes as To, CC or BCC and can be switched off without deleting it.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SEND_AS = { to: 'To', cc: 'CC', bcc: 'BCC' };
const emailsOf = sid => S.emails.filter(e => e.supplier_id === sid).sort((a, b) => a.sort - b.sort);
function recipientsHtml(s) {
  const on = emailsOf(s.id).filter(e => e.active);
  return on.length ? on.map(e => `${e.send_as === 'to' ? '' : `<span class="muted">${SEND_AS[e.send_as]}</span> `}${esc(e.email)}`).join('<br>') : '<span class="muted">None yet</span>';
}
function emailRow(e = {}) {
  return `<div class="emrow" data-id="${esc(e.id || '')}">
    <input name="eaddr" type="email" placeholder="name@supplier.com.au" aria-label="Email address" value="${esc(e.email ?? '')}" class="mono">
    <input name="ename" placeholder="Who (optional)" aria-label="Who this is" value="${esc(e.name ?? '')}">
    <select name="eas" aria-label="Send as">${Object.entries(SEND_AS).map(([v, l]) => `<option value="${v}" ${(e.send_as || 'to') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="emon"><input type="checkbox" name="eon" ${e.active === false ? '' : 'checked'}> Send</label>
    <button type="button" class="ghost" title="Remove this address" aria-label="Remove this address" onclick="this.parentElement.remove()">✕</button></div>`;
}
function emailSummary(sid) {
  const on = emailsOf(sid).filter(e => e.active);
  if (!on.length) return 'No addresses switched on, so this supplier’s orders have nowhere to go yet.';
  return Object.keys(SEND_AS).map(k => { const l = on.filter(e => e.send_as === k); return l.length ? `<b>${SEND_AS[k]}:</b> ${l.map(e => esc(e.email)).join(', ')}` : ''; }).filter(Boolean).join(' · ');
}
// ---------- order cut-off rules (Administration › Cut-offs, migrations/026) ----------
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
// Batch codes recorded by Receivers on Conventional, No customer orders: one row per day entered (newest first),
// one column per product, the batch code(s) where they meet.
function viewBatch() {
  const bs = (S.batches || []).slice().sort((a, b) => (a.entered_at || '').localeCompare(b.entered_at || ''));
  const packs = {}; bs.forEach(b => (packs[b.product_name] ||= new Set()).add(b.pack_name));
  const col = b => packs[b.product_name].size > 1 ? `${b.product_name} (${b.pack_name})` : b.product_name;
  // Headings stack the product name over its pack, so each column only needs to be as wide as its codes.
  const heads = {}; bs.forEach(b => heads[col(b)] = esc(b.product_name) + (packs[b.product_name].size > 1 ? `<span class="bpack">${esc(b.pack_name)}</span>` : ''));
  const cols = [...new Set(bs.map(col))].sort((a, b) => a.localeCompare(b));
  const grid = {}; // day -> column -> codes
  bs.forEach(b => { const day = new Date(b.entered_at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); const cell = ((grid[day] ||= {})[col(b)] ||= []); if (!cell.includes(b.code)) cell.push(b.code); });
  const days = Object.keys(grid).sort().reverse();
  return `<h1>Batch Code</h1><p class="sub">Batch codes entered when Conventional orders for No customer are received, by the day they were entered (newest first). Products that need one are ticked Batch Code in Products.</p>
    ${bs.length ? `<div class="tablewrap batchwrap"><table class="batchgrid"><thead><tr><th>Date</th>${cols.map(c => `<th>${heads[c]}</th>`).join('')}</tr></thead><tbody>${days.map(d =>
      `<tr><th scope="row">${esc(fmtDate(d))}</th>${cols.map(c => `<td class="mono">${(grid[d][c] || []).map(esc).join('<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<div class="card empty">No batch codes ${batchAll ? 'yet' : 'in the last 90 days'}. They appear here once a Receiver saves a Conventional, No customer order with Batch Code products ticked Received.</div>`}
    ${batchAll ? '' : `<p class="muted" style="margin-top:10px">Showing the last 90 days. <button class="link" onclick="batchAll=true;loadAll().then(render)">Show all</button></p>`}`;
}
// Settings: where the system copies CSV files. Browsers only let a page save into a folder the user picks,
// so each folder is chosen once on each computer and remembered in that browser.
function viewSettings() {
  const card = (n, title, about) => {
    const set = S.settings?.['csv_folder_' + n], dir = dirs[n];
    const folder = canPickFolder()
      ? `<div class="row" style="gap:12px;align-items:center"><span>Folder: <b>${esc(set || dir?.name || 'Not chosen yet')}</b>${set && !(dir && sameName(dir.name, set)) ? ' <span class="muted">(not connected on this PC)</span>' : ''}</span><button onclick="chooseCsvFolder(${n})">${set || dir ? 'Change folder' : 'Choose folder'}</button></div>
         <p class="muted" style="margin:8px 0 0;font-size:13px">This applies to every Admin and Manager login. Managers can’t change it. The first time a Manager needs it on their PC, the app asks them once to connect to this folder (the browser needs the folder picked on each computer) and only accepts this one.</p>`
      : `<p class="muted" style="margin:0">This browser can’t save into a chosen folder. Use Chrome or Edge on a PC.</p>`;
    return `<div class="card setcard"><h2>${title}</h2><p class="sub" style="margin-top:4px">${about}</p>${folder}
      <h3 class="seth">H line</h3>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><input id="h-tpl-${n}" class="mono" style="flex:1;min-width:240px" value="${esc(hTemplate(n))}" oninput="hPreview(${n})" aria-label="Condition ${n} H line">
        <button onclick="$('#h-tpl-${n}').value=H_DEFAULT;hPreview(${n})">Reset</button><button class="primary" onclick="saveHLine(this, ${n})">Save</button></div>
      <p class="muted" style="margin:8px 0 4px;font-size:13px">Separate fields with commas. Codes you can use:</p>
      <ul class="hcodes">${H_CODES.map(([c, d]) => `<li><code>${c}</code> ${esc(d)}</li>`).join('')}</ul>
      <div class="muted" style="font-size:13px">Example: <code id="h-prev-${n}">${esc(hSample(hTemplate(n)))}</code></div></div>`;
  };
  return `<h1>Settings</h1><p class="sub">Where the system copies CSV files.</p>
    ${card(1, 'Condition 1: Upload CSV', 'Created from the Orders tab with <b>Create upload CSV</b>. One file per order, as now.')}
    ${card(2, 'Condition 2: Upload CSV', 'Created from the Received tab with <b>Create upload CSV</b>, for Conventional orders sent from customer logins and imported purchase orders. With <b>Auto CSV</b> On (Orders tab), they are saved straight away by any Admin or Manager PC that has this app open and is connected to this folder.')}`;
}
function hSample(tpl) {
  const o = S.orders.find(x => x.customer_id && x.required_date) || { number: 13, required_date: '2026-10-15', special_order: false };
  const cust = o.customer_id ? custOf(o.customer_id)?.cid ?? '' : CONVENTIONAL_CID;
  return hLine(o, cust, tpl).map(csvCell).join(',');
}
function hPreview(n) { $('#h-prev-' + n).textContent = hSample($('#h-tpl-' + n).value.trim() || H_DEFAULT); }
async function saveHLine(btn, n) {
  const v = $('#h-tpl-' + n).value.trim() || H_DEFAULT;
  btn.disabled = true;
  const { error } = await sb.from('staff_settings').upsert({ key: `csv${n}_h`, value: v, updated_at: new Date().toISOString() });
  btn.disabled = false;
  if (error) return toast(/staff_settings/.test(error.message) ? 'Run migration 031 first, then try again.' : friendly(error));
  S.settings = { ...S.settings, [`csv${n}_h`]: v }; toast(`Condition ${n} H line saved. New CSV files use it.`, true);
}
function viewCutoffs() {
  const head = `<h1>Order cut-offs</h1><p class="sub">For each product location: the days you deliver, and when orders for each day close (Sydney time). Customers can’t send an order after its cut-off. You and your staff still can. Choose <b>Same day</b> to take orders for delivery that day, up to the time set.</p>`;
  return head + GROUPS.map(g => {
    const rem = S.cutSettings.find(x => x.product_group === g)?.reminder_minutes;
    const rows = cutRules(g).map(r => {
      const t = r.cutoff_time ? r.cutoff_time.slice(0, 5) : '07:30', times = TIMES.includes(t) ? TIMES : [...TIMES, t].sort();
      return `<tr data-dow="${r.dow}"><td><b>${DAYS[r.dow - 1]}</b></td>
        <td><select name="delivers" onchange="cutRowState(this)"><option value="all" ${r.delivers === 'all' ? 'selected' : ''}>All customers</option><option value="sunday" ${r.delivers === 'sunday' ? 'selected' : ''}>Sunday-delivery customers only</option><option value="none" ${r.delivers === 'none' ? 'selected' : ''}>No deliveries</option></select></td>
        <td><select name="days" onchange="cutRowState(this)"><option value="" ${r.days_before == null ? 'selected' : ''}>No cut-off</option>${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${r.days_before === n ? 'selected' : ''}>${n ? `${n} day${n > 1 ? 's' : ''} before (${DAYS[(r.dow - 1 - n + 7) % 7]})` : `Same day (${DAYS[r.dow - 1]})`}</option>`).join('')}</select></td>
        <td><select name="time">${times.map(x => `<option value="${x}" ${x === t ? 'selected' : ''}>${fmtTime(x)}</option>`).join('')}</select></td></tr>`;
    }).join('');
    return `<section class="card" style="margin-bottom:16px" id="cut-${g}"><div class="row spread"><h2>${g}</h2><span class="pill grp-${g.toLowerCase()}">${g}</span></div>
      <div class="tablewrap" style="margin-top:12px"><table class="cuttbl"><thead><tr><th>Delivery day</th><th>Deliveries</th><th>Orders close</th><th>At</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row spread" style="margin-top:12px;align-items:flex-end"><label class="f" style="max-width:420px">Reminder email to customers who haven’t ordered<select name="reminder"><option value="">No reminder emails</option>${[...new Set([10, 15, 20, 30, 60, 120, 180, ...(rem ? [rem] : [])])].sort((a, b) => a - b).map(m => `<option value="${m}" ${rem === m ? 'selected' : ''}>${m < 60 || m % 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')} before the cut-off</option>`).join('')}</select></label>
      <button class="primary" onclick="saveCutoffs('${g}', this)">Save ${g}</button></div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">${cutSeeText(g)}</p></section>`;
  }).join('');
}
// What customers read on their order form, with and without Sunday delivery when that differs.
function cutSeeText(g) {
  const all = orderHint(g, {}) || 'No restrictions.', sun = orderHint(g, { sunday_delivery: true }) || 'No restrictions.';
  return all === sun ? `Customers see: ${esc(all)}` : `Customers see: ${esc(all)}<br>Sunday-delivery customers see: ${esc(sun)}`;
}
// "No deliveries" or "No cut-off" greys out the boxes that don't apply.
function cutRowState(el) {
  const tr = el.closest('tr'), none = tr.querySelector('[name=delivers]').value === 'none', nocut = !tr.querySelector('[name=days]').value;
  tr.querySelector('[name=days]').disabled = none; tr.querySelector('[name=time]').disabled = none || nocut;
}
async function saveCutoffs(g, btn) {
  const box = document.getElementById('cut-' + g);
  const rows = [...box.querySelectorAll('tr[data-dow]')].map(tr => {
    const delivers = tr.querySelector('[name=delivers]').value, days = tr.querySelector('[name=days]').value, on = delivers !== 'none' && days !== '';
    return { product_group: g, dow: +tr.dataset.dow, delivers, days_before: on ? +days : null, cutoff_time: on ? tr.querySelector('[name=time]').value : null };
  });
  const rem = box.querySelector('[name=reminder]').value;
  btn.disabled = true;
  const [a, b] = await Promise.all([sb.from('cutoff_rules').upsert(rows), sb.from('cutoff_settings').upsert({ product_group: g, reminder_minutes: rem ? +rem : null })]);
  btn.disabled = false;
  if (a.error || b.error) return toast('Couldn’t save: ' + friendly(a.error || b.error));
  const [cr, cs] = await Promise.all([sb.from('cutoff_rules').select('*'), sb.from('cutoff_settings').select('*')]);
  S.cutRules = cr.data || S.cutRules; S.cutSettings = cs.data || S.cutSettings;
  // No full redraw, so unsaved changes to the other location stay on screen.
  box.querySelector('p.muted').innerHTML = cutSeeText(g);
  toast(`${g} cut-offs saved`, true);
}

// ---------- SMS settings (SMS Broadcast; new-login texts) ----------
// Kept in the database's private settings. The password never comes back to the browser.
let smsCfg = null;
async function loadSms() {
  const { data, error } = await sb.rpc('get_sms_settings');
  smsCfg = error ? { error: friendly(error) } : data || {};
  if (view === 'sms') render();
}
function viewSms() {
  const head = `<h1>SMS</h1><p class="sub">Texts are sent through SMS Broadcast, for example when a new login is waiting to be activated.</p>`;
  if (!smsCfg) { loadSms(); return head + '<div class="card empty">Loading…</div>'; }
  if (smsCfg.error) return head + `<div class="card banner">${esc(smsCfg.error)}</div>`;
  const c = smsCfg;
  return head + `<form class="card grid" style="max-width:640px" onsubmit="event.preventDefault();saveSms(this)">
    <label class="f">SMS Broadcast username<input name="username" autocomplete="off" value="${esc(c.username || '')}"></label>
    <label class="f">SMS Broadcast password<input name="password" type="password" autocomplete="new-password" placeholder="${c.password_saved ? 'Saved. Leave blank to keep it.' : 'Not set yet'}"></label>
    <label class="chk" style="margin-top:-6px"><input type="checkbox" onchange="this.form.password.type = this.checked ? 'text' : 'password'">Show password while typing</label>
    <label class="f">Default sender<input name="sender" maxlength="15" value="${esc(c.sender || '')}"><span class="muted" style="font-size:12px;font-weight:400">Shown as who the text is from: a mobile number, or a name of up to 11 letters or numbers.</span></label>
    <label class="f">Send texts to<input name="mobile" value="${esc(c.mobile || '')}"><span class="muted" style="font-size:12px;font-weight:400">Mobile number. Separate several with commas.</span></label>
    <div class="row spread"><button type="button" id="smstest" onclick="testSms(this)">Send test text</button><button class="primary">Save</button></div>
    <p class="muted" id="smsmsg" style="margin:0;font-size:13px">The test uses the saved settings, so press Save first after a change.</p>
  </form>`;
}
async function saveSms(f) {
  const v = n => f.elements[n].value.trim();
  if (!v('username') || !v('mobile')) return toast('Please fill in the username and the mobile number.');
  const btn = f.querySelector('button.primary'); btn.disabled = true;
  const { error } = await sb.rpc('save_sms_settings', { username: v('username'), password: f.elements.password.value, sender: v('sender'), mobile: v('mobile') });
  btn.disabled = false;
  if (error) return toast('Couldn’t save: ' + error.message);
  toast('SMS settings saved', true); smsCfg = null; render();
}
async function testSms(btn) {
  const msg = $('#smsmsg'); btn.disabled = true; msg.textContent = 'Sending…';
  const { data, error } = await sb.functions.invoke(NOTIFY_FN, { body: { action: 'test-sms' } });
  let m = ''; if (error) try { m = (await error.context.json()).error; } catch { }
  btn.disabled = false;
  msg.textContent = data?.sent ? `Test text sent to ${data.to.join(', ')}. Check the phone.`
    : data?.reason || m || (error ? 'The text service isn’t reachable right now.' : 'The test text wasn’t sent.');
}
function viewEmails() {
  const head = `<h1>Order emails</h1><p class="sub">Where each supplier’s completed orders are sent. Add as many addresses as you need, choose To, CC or BCC for each, and untick <b>Send</b> to pause one without deleting it.</p>`;
  const ss = S.suppliers.slice().sort(byName);
  if (!ss.length) return head + `<div class="card empty">Add a supplier first, under <b>Suppliers</b>.</div>`;
  return head + ss.map(s => `<section class="card" style="margin-bottom:14px"><div class="row spread"><h2>${esc(s.name)}</h2><span class="muted" style="font-size:13px">${esc(s.cutoff || '')}</span></div>
    <p class="muted" style="font-size:13px;margin:6px 0 12px" id="emsum-${s.id}">${emailSummary(s.id)}</p>
    <div class="grid" style="gap:8px" id="emrows-${s.id}">${emailsOf(s.id).map(emailRow).join('') || emailRow()}</div>
    <div class="row spread" style="margin-top:12px"><button type="button" onclick="document.getElementById('emrows-${s.id}').insertAdjacentHTML('beforeend', emailRow())">Add address</button>
    <button type="button" class="primary" onclick="saveEmails('${s.id}', this)">Save</button></div></section>`).join('');
}
async function saveEmails(sid, btn) {
  const rows = [...document.querySelectorAll(`#emrows-${sid} .emrow`)].map((r, i) => ({
    id: r.dataset.id || null, email: r.querySelector('[name=eaddr]').value.trim().toLowerCase(), name: r.querySelector('[name=ename]').value.trim(),
    send_as: r.querySelector('[name=eas]').value, active: r.querySelector('[name=eon]').checked, sort: i + 1 })).filter(r => r.email);
  const bad = rows.find(r => !EMAIL_RE.test(r.email)); if (bad) { toast('Check this email address: ' + bad.email); return; }
  const dup = rows.find((r, i) => rows.findIndex(x => x.email === r.email) !== i); if (dup) { toast(dup.email + ' is listed twice.'); return; }
  btn.disabled = true;
  const keep = new Set(rows.filter(r => r.id).map(r => r.id));
  const gone = emailsOf(sid).filter(e => !keep.has(e.id)).map(e => e.id);
  let ok = !gone.length || await run(sb.from('supplier_emails').delete().in('id', gone));
  // Park changed addresses on placeholders first, so swapping two addresses doesn't trip the one-address-per-supplier rule.
  const changed = rows.filter(r => r.id && emailsOf(sid).find(e => e.id === r.id)?.email !== r.email);
  for (const r of changed) if (ok) ok = await run(sb.from('supplier_emails').update({ email: `moving-${r.id}@placeholder.invalid` }).eq('id', r.id));
  for (const r of rows) {
    if (!ok) break;
    const body = { supplier_id: sid, email: r.email, name: r.name || null, send_as: r.send_as, active: r.active, sort: r.sort };
    ok = await run(r.id ? sb.from('supplier_emails').update(body).eq('id', r.id) : sb.from('supplier_emails').insert(body));
  }
  btn.disabled = false;
  // Only this supplier's card is redrawn, so unsaved changes on the other cards stay put.
  const { data, error } = await sb.from('supplier_emails').select('*').order('sort');
  if (error) return toast(friendly(error));
  S.emails = data || [];
  $(`#emrows-${sid}`).innerHTML = emailsOf(sid).map(emailRow).join('') || emailRow();
  $(`#emsum-${sid}`).innerHTML = emailSummary(sid);
  if (ok) toast('Order emails saved', true);
}

// ---------- one-off customer import (CSV or Excel) ----------
// Every imported customer is set to Conventional. Rows with a blank, non-numeric or duplicated CID are never imported;
// rows whose name is already used (in the file or in the app) are left unticked.
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = ok; s.onerror = () => fail(new Error('Couldn’t load the spreadsheet reader. Check your internet connection and try again.')); document.head.append(s); });
}
const normName = t => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(pty|ltd|limited|the)\b/g, '').replace(/\s+/g, ' ').trim();
const IMPORT_COLS = [['cid', /^(cid|customer ?(id|no|number|code)|account ?(no|number|code)?|code|id)$/], ['name', /^(name|customer( name)?|business( name)?|company( name)?|trading name)$/],
  ['contact', /^(contact( person| name)?|attention|attn)$/], ['phone', /^(phone|tel|telephone|mobile|contact phone|ph)$/], ['email', /^(e-?mail( address)?)$/], ['notes', /^(notes?|comments?)$/]];
let importRows = [];
function importCheck(raw) {
  const head = (raw[0] || []).map(h => String(h ?? '').trim().toLowerCase());
  const col = Object.fromEntries(IMPORT_COLS.map(([k, re]) => [k, head.findIndex(h => re.test(h))]));
  if (col.name < 0) throw new Error('The file needs a column headed “Name” (or Customer, Business or Company) in its first row.');
  // Placeholders such as "." or "0" count as blank; an email without an @ is dropped.
  const cell = (r, k) => { const v = col[k] < 0 ? '' : String(r[col[k]] ?? '').trim(); return /^[.,\-0\s]*$/.test(v) || (k === 'email' && !v.includes('@')) ? '' : v; };
  const rows = raw.slice(1).filter(r => r.some(v => String(v ?? '').trim())).map((r, i) => ({ line: i + 2, cid: cell(r, 'cid'), name: cell(r, 'name'), contact: cell(r, 'contact'), phone: cell(r, 'phone'), email: cell(r, 'email'), notes: cell(r, 'notes') }));
  const byCid = new Map(S.customers.map(c => [String(c.cid), c])), byName = new Map(S.customers.map(c => [normName(c.name), c]));
  const seenName = new Map(), cidLines = new Map();
  for (const r of rows) if (r.cid) cidLines.set(r.cid, [...(cidLines.get(r.cid) || []), r.line]);
  for (const r of rows) {
    r.issues = [];
    if (!r.name) r.issues.push('No name');
    if (r.cid && !/^\d+$/.test(r.cid)) r.issues.push(`CID “${r.cid}” isn’t a number`);
    if (r.cid && byCid.has(r.cid)) r.issues.push(`CID ${r.cid} already used by ${byCid.get(r.cid).name}`);
    r.blocked = !r.name || !/^\d+$/.test(r.cid) || byCid.has(r.cid) || cidLines.get(r.cid)?.length > 1;
    if (!r.cid) r.issues.push('No CID');
    if (r.cid && cidLines.get(r.cid).length > 1) r.issues.push(`CID ${r.cid} is in the file more than once (lines ${cidLines.get(r.cid).join(', ')})`);
    if (r.name && byName.has(normName(r.name))) r.issues.push(`Already a customer: ${byName.get(normName(r.name)).name}`);
    if (r.name && seenName.has(normName(r.name))) r.issues.push(`Same name as line ${seenName.get(normName(r.name))}`);
    if (r.name && !seenName.has(normName(r.name))) seenName.set(normName(r.name), r.line);
    r.ok = !r.issues.length;
  }
  return rows;
}
function importPreview() {
  const good = importRows.filter(r => r.ok).length, bad = importRows.length - good, blocked = importRows.filter(r => r.blocked).length;
  $('#impprev').innerHTML = `<p style="margin:0"><b>${importRows.length}</b> rows: <b>${good}</b> new customer${good === 1 ? '' : 's'} to add${bad ? `, <b class="ndtxt">${bad}</b> duplicate or problem row${bad === 1 ? '' : 's'} left unticked` : ''}${blocked ? ` (${blocked} can’t be imported because the CID is blank, not a number or duplicated)` : ''}. All will be <b>Conventional</b>.</p>
    <div class="tablewrap impwrap"><table><thead><tr><th></th><th>Line</th><th class="num">CID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>Check</th></tr></thead><tbody>
    ${importRows.map((r, i) => `<tr${r.ok ? '' : ' class="nd"'}><td><input type="checkbox" data-imp="${i}" ${r.ok ? 'checked' : ''} ${r.blocked ? 'disabled' : ''}></td><td class="muted">${r.line}</td><td class="num mono">${esc(r.cid)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.contact)}</td><td>${esc(r.phone)}</td><td>${esc(r.email)}</td><td class="${r.ok ? 'okgreen' : 'ndtxt'}">${r.ok ? 'New' : esc(r.issues.join('; '))}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function importCustomers() {
  importRows = [];
  openDialog('Import customers',
    `<p class="sub" style="margin:0">Choose a CSV or Excel file. The first row must be headings, for example <b>CID, Name, Contact, Phone, Email, Notes</b>. Each customer needs a <b>CID</b> and a <b>Name</b>; rows with a blank or duplicated CID aren’t imported. Every customer imported is set to <b>Conventional</b>.</p>
     <input type="file" id="impfile" accept=".csv,.xlsx,.xls">
     <div id="impprev"></div>`,
    async f => {
      const pick = [...document.querySelectorAll('input[data-imp]:checked')].map(x => importRows[+x.dataset.imp]).filter(r => !r.blocked);
      if (!pick.length) { toast('Choose a file and tick at least one customer to import.'); return false; }
      const rows = pick.map(r => {
        const row = { cid: +r.cid, name: r.name, contact: r.contact, phone: r.phone, email: r.email, notes: r.notes };
        row.product_group = 'Conventional'; row.reminders = false;
        return row;
      });
      if (!(await run(sb.from('customers').insert(rows)))) return false;
      toast(`${rows.length} customer${rows.length === 1 ? '' : 's'} imported as Conventional`, true); return true;
    });
  $('#dlg').classList.add('wide');
  $('#dlg').addEventListener('close', () => $('#dlg').classList.remove('wide'), { once: true });
  $('#impfile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      importRows = importCheck(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }));
      importPreview();
    } catch (err) { importRows = []; $('#impprev').innerHTML = `<div class="banner">${esc(err.message || err)}</div>`; }
  };
}
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
function loadPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = JSPDF_URL; s.onload = ok; s.onerror = () => fail(new Error('Couldn’t load the PDF maker. Check your internet connection and try again.')); document.head.append(s); });
}
const supplierOfLine = l => S.suppliers.find(s => s.id === prodOf(l.product_id)?.supplier_id);
function recipients(s) {
  const on = emailsOf(s.id).filter(e => e.active);
  return { to: on.filter(e => e.send_as === 'to').map(e => e.email), cc: on.filter(e => e.send_as === 'cc').map(e => e.email), bcc: on.filter(e => e.send_as === 'bcc').map(e => e.email) };
}
const safeName = t => String(t).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
const formFileName = (o, s) => safeName(`${orderNo(o.number)} ${custOf(o.customer_id)?.name || ''} ${s.name}`) + '.pdf';

// The supplier's whole order form as an A4 portrait PDF, laid out like their paper form, with this order's quantities filled in.
async function formPdf(o, s) {
  await loadPdf();
  const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 10, BOTTOM = 284, GAP = 4;
  const qty = {}; (o.lines || []).forEach(l => { if (l.pack_id) qty[l.pack_id] = l.qty; });
  // Only the form(s) for the groups this order uses: a Conventional order gets the Conventional form.
  // s.id '*' means every product the viewer can see (a customer's printout, where suppliers aren't visible).
  const mine = p => s.id === '*' || p.supplier_id === s.id;
  // A product switched off since the order was taken still prints when the order has it.
  const onOrder = new Set((o.lines || []).map(l => l.product_id));
  const own = S.products.filter(mine).map(p => p.active === false && onOrder.has(p.id) ? { ...p, active: true } : p);
  const used = new Set((o.lines || []).map(l => prodOf(l.product_id)).filter(p => p && mine(p)).map(groupOf));
  const gs = GROUPS.filter(g => used.has(g)), mixed = gs.length > 1;
  const secs = gs.flatMap(g => sectionsFor(own.filter(p => groupOf(p) === g)).map(x => mixed && !x.name.toLowerCase().startsWith(g.toLowerCase()) ? { ...x, name: `${g} ${x.name}` } : x));
  // Two side-by-side blocks: sections fill the left until it holds about half the rows.
  const rowsOf = x => x.products.length + 2, half = secs.reduce((a, x) => a + rowsOf(x), 0) / 2;
  const left = [], right = []; let acc = 0;
  secs.forEach(x => { if (!left.length || acc < half) { left.push(x); acc += rowsOf(x); } else right.push(x); });
  const c = custOf(o.customer_id) || {};
  const line = () => { doc.setDrawColor(140); doc.setLineWidth(0.2); };
  const text = (t, x, y, opt = {}) => doc.text(Array.isArray(t) ? t : String(t ?? ''), x, y, opt);
  // Title
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); text(`${s.name.toUpperCase()} WHOLESALE ORDER`, W / 2, M + 5, { align: 'center' });
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); text([s.cutoff, s.notes].filter(Boolean).join('  ·  '), W / 2, M + 10, { align: 'center' });
  // Header fields
  const half2 = (W - 2 * M - GAP) / 2, LBL = 30, RH = 7;
  const field = (x, y, w, label, value) => {
    line(); doc.rect(x, y, LBL, RH); doc.rect(x + LBL, y, w - LBL, RH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); text(label, x + 1.5, y + 4.6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); text(doc.splitTextToSize(String(value ?? ''), w - LBL - 3)[0] || '', x + LBL + 1.5, y + 4.8);
  };
  let y = M + 14;
  field(M, y, half2, 'Customer Name', c.name || ''); field(M + half2 + GAP, y, half2, 'Today’s Date', fmtDate(o.order_date)); y += RH;
  field(M, y, half2, 'Contact Phone', c.phone || ''); field(M + half2 + GAP, y, half2, 'Day/Date Required', fmtDate(o.required_date)); y += RH;
  field(M, y, half2, 'Order No.', orderNo(o.number)); field(M + half2 + GAP, y, half2, 'Customer No. (CID)', c.cid ?? ''); y += RH;
  const sp = doc.splitTextToSize(o.special || '', W - 2 * M - LBL - 3); const spH = Math.max(RH, sp.length * 4 + 3);
  line(); doc.rect(M, y, LBL, spH); doc.rect(M + LBL, y, W - 2 * M - LBL, spH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); text('Special Requirements', M + 1.5, y + 4.6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); text(sp, M + LBL + 1.5, y + 4.8);
  const top = y + spH + 5;
  // Product blocks
  let lines = 0, units = 0, lastPage = 1, lastY = top;
  const block = (list, x0, bw) => {
    let page = 1, by = top; doc.setPage(1);
    const need = h => { if (by + h > BOTTOM) { page++; if (page > doc.getNumberOfPages()) doc.addPage(); doc.setPage(page); by = M + 6; } };
    for (const sec of list) {
      const n = Math.max(1, sec.packs.length), CW = 15, PW = Math.min(16, (bw - CW - 30) / n), NW = bw - CW - n * PW;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8);
      const heads = sec.packs.map(pk => doc.splitTextToSize(pk, PW - 1.5));
      doc.setFontSize(8.5); const title = doc.splitTextToSize(sec.name, CW + NW - 2); doc.setFontSize(5.8);
      const hh = Math.max(7, title.length * 3.4 + 3.5, ...heads.map(h => h.length * 2.4 + 2.5));
      need(hh + 6);
      line(); doc.setFillColor(232, 239, 230); doc.rect(x0, by, CW + NW, hh, 'FD');
      doc.setFontSize(8.5); text(title, x0 + 1.5, by + hh - 1.8 - (title.length - 1) * 3.4);
      doc.setFontSize(5.8);
      heads.forEach((h, i) => { const x = x0 + CW + NW + i * PW; doc.setFillColor(232, 239, 230); doc.rect(x, by, PW, hh, 'FD'); text(h, x + PW / 2, by + hh - 1.5 - (h.length - 1) * 2.4, { align: 'center' }); });
      by += hh;
      for (const p of sec.products) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        const nm = doc.splitTextToSize(p.name, NW - 2), rh = Math.max(5.5, nm.length * 3.2 + 2.2);
        need(rh);
        line(); doc.rect(x0, by, CW, rh); doc.rect(x0 + CW, by, NW, rh);
        doc.setFontSize(6); text(doc.splitTextToSize(p.code || '', CW - 1.5)[0] || '', x0 + 1, by + 3.7);
        doc.setFontSize(7.5); text(nm, x0 + CW + 1.2, by + 3.8);
        sec.packs.forEach((pk, i) => {
          const x = x0 + CW + NW + i * PW, k = (p.product_packs || []).find(z => z.name === pk), q = k ? qty[k.id] : null, ok = k && (k.available || q);
          if (!ok) { doc.setFillColor(191, 191, 191); doc.rect(x, by, PW, rh, 'FD'); }
          else { doc.rect(x, by, PW, rh); if (q) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); text(+q, x + PW / 2, by + rh / 2 + 1.6, { align: 'center' }); doc.setFont('helvetica', 'normal'); lines++; units += +q; } }
        });
        by += rh;
      }
      by += 3;
    }
    if (page > lastPage || (page === lastPage && by > lastY)) { lastPage = page; lastY = by; }
  };
  // Share the page width by how many pack columns each side needs, so a 6-column block isn't squeezed.
  const want = list => 15 + 34 + 13 * Math.max(1, ...list.map(x => x.packs.length)), room = W - 2 * M - GAP;
  const bl = right.length ? room * want(left) / (want(left) + want(right)) : W - 2 * M;
  block(left, M, bl); if (right.length) block(right, M + bl + GAP, room - bl);
  doc.setPage(lastPage); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
  text(`${lines} line${lines === 1 ? '' : 's'} · ${units} in total · Grey boxes are not available`, M, Math.min(lastY + 3, BOTTOM + 6));
  return { buf: doc.output('arraybuffer') };
}
// Customer printout: their order on the order form (same layout as the supplier's copy), opened ready to print.
async function printOrder(id, btn) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const w = window.open('', '_blank'); // opened straight from the click so the browser allows it
  btn.disabled = true;
  try {
    const { buf } = await formPdf(o, { id: '*', name: custGroup(custOf(o.customer_id)) === 'Both' ? orderGroup(o) : custGroup(custOf(o.customer_id)) });
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
    if (w) w.location.href = url; else download(buf, safeName(`${orderNo(o.number)} order`) + '.pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { if (w) w.close(); toast(e.message); } finally { btn.disabled = false; }
}
function download(buf, name) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// Group the ticked orders by supplier: one email per supplier carrying every ticked order that has lines for them.
function pickedBySupplier() {
  const os = S.orders.filter(o => picked.has(o.id)).sort((a, b) => a.number - b.number), groups = new Map();
  for (const o of os) for (const s of new Set((o.lines || []).map(supplierOfLine).filter(Boolean))) { if (!groups.has(s)) groups.set(s, []); groups.get(s).push(o); }
  return { os, groups: [...groups.entries()].sort((a, b) => byName(a[0], b[0])) };
}
// Suppliers already emailed from the open dialog, so "Try again" only sends to the ones that failed.
const sentSuppliers = new Set();
function dropPastDone() { S.orders.forEach(o => { if (pastDone(o)) picked.delete(o.id); if (noUpload(o)) upPicked.delete(o.id); }); }
function emailPicked() {
  dropPastDone(); if (!picked.size) return toast('Those orders’ required date has passed, so they can’t be emailed.');
  sentSuppliers.clear();
  const { os, groups } = pickedBySupplier();
  const empty = os.filter(o => !(o.lines || []).some(supplierOfLine));
  const notDone = os.filter(o => o.status !== 'complete');
  const sendable = groups.filter(([s]) => { const r = recipients(s); return r.to.length || r.cc.length || r.bcc.length; }).length;
  const blocks = groups.map(([s, list], i) => {
    const r = recipients(s), none = !r.to.length && !r.cc.length && !r.bcc.length;
    return `<div class="card" style="padding:12px"><div class="row spread"><b>${esc(s.name)}</b><span class="muted" style="font-size:12px">${list.length} form${list.length > 1 ? 's' : ''}</span></div>
      <p style="margin:6px 0;font-size:13px">${none ? `<span class="err">No addresses are switched on for this supplier. ${isManager() ? 'Ask an Admin to add them under <b>Administration › Emails</b>.' : 'Add them under <b>Administration › Emails</b> first.'}</span>` : ['to', 'cc', 'bcc'].filter(k => r[k].length).map(k => `<b>${SEND_AS[k]}:</b> <span class="mono">${r[k].map(esc).join(', ')}</span>`).join('<br>')}</p>
      <ul class="sumlist" style="margin:6px 0">${list.map(o => `<li><span class="mono">${esc(formFileName(o, s))}</span></li>`).join('')}</ul>
      <div class="row"><span class="est" id="est-${i}">${none ? '' : 'Ready to send'}</span><button type="button" class="ghost" style="margin-left:auto;font-size:12px" ${none ? 'disabled' : ''} onclick="outlookEmail(${i}, this)">Open in Outlook instead</button></div></div>`;
  }).join('');
  const dlg = $('#dlg');
  dlg.innerHTML = `<div class="grid"><h2>Email ${os.length} order${os.length > 1 ? 's' : ''} to suppliers</h2>
    ${notDone.length ? `<div class="banner">Not marked complete yet: ${notDone.map(o => esc(orderNo(o.number))).join(', ')}.</div>` : ''}
    ${empty.length ? `<div class="banner">No lines to send on ${empty.map(o => esc(orderNo(o.number))).join(', ')}, so ${empty.length > 1 ? 'they are' : 'it is'} skipped.</div>` : ''}
    ${blocks || '<div class="card empty">None of the selected orders have any lines.</div>'}
    <div class="row spread" style="margin-top:4px"><button type="button" onclick="document.getElementById('dlg').close()">Close</button>
    ${groups.length ? `<span class="row"><button type="button" class="ghost" title="Use this after sending through Outlook" onclick="markEmailed(this)">Mark as emailed</button><button type="button" class="primary" id="sendall" ${sendable ? '' : 'disabled'} onclick="sendSupplierEmails(this)">Send ${sendable} email${sendable === 1 ? '' : 's'}</button></span>` : ''}</div></div>`;
  dlg.showModal();
}
async function buildGroup(i) {
  const [s, list] = pickedBySupplier().groups[i];
  const files = [];
  for (const o of list) files.push({ name: formFileName(o, s), ...(await formPdf(o, s)) });
  return { s, list, files };
}
// The email's subject and message to the supplier.
function mailText(s, list) {
  const nos = list.map(o => orderNo(o.number)).join(', ');
  const dates = [...new Set(list.map(o => o.required_date).filter(Boolean))].map(fmtDate);
  const subject = `Coolibah Salads Sydney order ${nos}${dates.length === 1 ? ' for ' + dates[0] : ''}`;
  const body = `Hi ${s.name},\n\nPlease find attached our order form${list.length > 1 ? 's' : ''}:\n${list.map(o => `- ${orderNo(o.number)}${o.required_date ? ', required ' + fmtDate(o.required_date) : ''}`).join('\n')}\n\nAttached: ${list.map(o => formFileName(o, s)).join(', ')}\n\nRegards,\nCoolibah Salads Sydney`;
  return { subject, body };
}
// Outlook on Windows: an .eml file marked X-Unsent opens as a new email, ready to send, with the PDFs attached.
const b64 = bytes => { let bin = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); };
const b64text = t => b64(new TextEncoder().encode(t));
const wrap76 = t => t.replace(/.{1,76}/g, '$&\r\n');
const mimeWord = t => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64text(t)}?=`;
async function outlookEmail(i, btn) {
  btn.disabled = true;
  try {
    const { s, list, files } = await buildGroup(i);
    const r = recipients(s), { subject, body } = mailText(s, list), bd = 'smfw-' + Math.random().toString(36).slice(2);
    const head = [r.to.length && `To: ${r.to.join(', ')}`, r.cc.length && `Cc: ${r.cc.join(', ')}`, r.bcc.length && `Bcc: ${r.bcc.join(', ')}`,
      `Subject: ${mimeWord(subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${bd}"`].filter(Boolean);
    const parts = [`--${bd}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64text(body.replace(/\n/g, '\r\n')))}`,
      ...files.map(f => `--${bd}\r\nContent-Type: application/pdf; name="${mimeWord(f.name)}"\r\nContent-Disposition: attachment; filename="${mimeWord(f.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(f.buf))}`)];
    const eml = head.join('\r\n') + '\r\n\r\n' + parts.join('') + `--${bd}--\r\n`;
    const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: safeName(`${s.name} order ${list.map(o => orderNo(o.number)).join(' ')}`) + '.eml' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Email saved. Open it from your Downloads and it opens in Outlook, ready to send.', true);
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
}
// Upload CSV, one file per order:
//   H,<CID>,<date required as YYYYMMDD>[,S]   (S only when Special Order is ticked)
//   D,<Ref>,<order qty × outer multiple>   (one line per order line)
const CONVENTIONAL_CID = 1183;
// The Vegetables and Drinks sections aren't offered on SMFW's own Conventional orders (No customer, or a customer with CID 1183).
const smfwSection = sec => /^(vegetables?|drinks?|vegetables?\s*(&|and|\+)\s*drinks?)$/.test(String(sec || '').toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
const ymd = d => (d || '').replace(/-/g, '');
const csvCell = v => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
// The H line follows the template set in Administration > Settings (Condition 1). Each comma-separated field
// can hold fixed text and these codes; empty fields at the end are left off (so no S means no trailing comma).
const H_DEFAULT = 'H,{CID},{DATE},{S}';
const H_CODES = [['{CID}', 'Customer CID'], ['{DATE}', 'Date required, YYYYMMDD'], ['{S}', 'S when Special Order is ticked, otherwise blank'], ['{ORDER}', 'Order number, e.g. SO-0013'], ['{CUSTOMER}', 'Customer name']];
const hTemplate = (n = 1) => S.settings?.[`csv${n}_h`] || H_DEFAULT;
function hLine(o, cust, tpl = hTemplate()) {
  const vals = { CID: cust, DATE: ymd(o.required_date || o.order_date), S: o.special_order ? 'S' : '', ORDER: orderNo(o.number), CUSTOMER: custOf(o.customer_id)?.name || '' };
  const f = tpl.split(',').map(x => x.replace(/\{(CID|DATE|S|ORDER|CUSTOMER)\}/gi, (_, k) => vals[k.toUpperCase()] ?? '').trim());
  while (f.length > 1 && f[f.length - 1] === '') f.pop();
  return f;
}
function orderCsv(o, n = 1) {
  // An order goes under its customer's CID; a Conventional order SMFW enters without a customer goes under 1183.
  const cust = o.customer_id ? custOf(o.customer_id)?.cid ?? '' : orderGroup(o) === 'Conventional' ? CONVENTIONAL_CID : '';
  const missing = [], rows = [hLine(o, cust, hTemplate(n))];
  for (const l of o.lines || []) {
    if (l.undelivered || !(+l.qty > 0)) continue; // undelivered lines never go in the upload
    const k = packOf(l.pack_id)?.k, ref = (k?.ref || '').trim();
    if (!ref) { missing.push(`${l.product_name} (${l.pack_name})`); continue; }
    rows.push(['D', ref, (+l.qty || 0) * (Number(l.outer) || Number(k?.outer_multiple) || 1)]);
  }
  return { text: rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n', missing, lines: rows.length - 1 };
}
// CSV folder: Chrome and Edge on a PC can save straight into a chosen folder (the C94GSHS folder on the network).
// The folder is picked once and remembered in this browser; other browsers fall back to Downloads.
const CSV_FOLDER = 'C94GSHS';
const canPickFolder = () => 'showDirectoryPicker' in window;
const dirs = { 1: null, 2: null }; // the folder for each Condition, on this computer
function idb(mode, fn) {
  return new Promise((res, rej) => { const q = indexedDB.open('smfw', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => { try { const t = q.result.transaction('kv', mode), x = fn(t.objectStore('kv')); t.oncomplete = () => res(x?.result); t.onerror = () => rej(t.error); } catch (e) { rej(e); } }; q.onerror = () => rej(q.error); });
}
async function loadCsvDir(n = 1) { if (!canPickFolder()) return null; try { dirs[n] = await idb('readonly', st => st.get(n === 1 ? 'csvDir' : 'csvDir' + n)) || null; } catch { dirs[n] = null; } return dirs[n]; }
// The Admin's choice (Administration > Settings) is shared with every staff login. Managers can't change it:
// on their PC they only connect to that same folder once, as the browser needs it picked on each computer.
const csvTarget = (n = 1) => S.settings?.['csv_folder_' + n] || (n === 1 ? CSV_FOLDER : '');
const sameName = (a, b) => (a || '').toUpperCase() === (b || '').toUpperCase();
async function chooseCsvFolder(n = 1) {
  if (isManager() && !csvTarget(n)) { toast(`Admin hasn’t chosen the Condition ${n} folder yet.`); return null; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: n === 1 ? 'csvfolder' : 'csvfolder' + n, mode: 'readwrite' }); } catch { return null; } // cancelled
  if (isManager() && !sameName(dir.name, csvTarget(n))) { toast(`That folder is "${dir.name}". Admin has set Condition ${n} CSV files to go to ${csvTarget(n)}, so pick that folder.`); return null; }
  dirs[n] = dir;
  try { await idb('readwrite', st => st.put(dir, n === 1 ? 'csvDir' : 'csvDir' + n)); } catch {}
  if (!isManager() && !sameName(dir.name, S.settings?.['csv_folder_' + n])) {
    const { error } = await sb.from('staff_settings').upsert({ key: 'csv_folder_' + n, value: dir.name, updated_at: new Date().toISOString() });
    if (!error) S.settings = { ...S.settings, ['csv_folder_' + n]: dir.name };
  }
  toast(`Condition ${n} CSV files will be saved in ${dir.name}.`, true);
  render(); if (n === 2) autoCsv2(); return dir;
}
async function csvFolder(n = 1) {
  if (!canPickFolder()) return null;
  if (!dirs[n]) await loadCsvDir(n);
  if (!dirs[n] || (isManager() && !sameName(dirs[n].name, csvTarget(n)))) { toast(`Pick the ${csvTarget(n)} folder so CSV files can be saved there.`); return chooseCsvFolder(n); }
  const ok = async q => (await dirs[n][q]({ mode: 'readwrite' })) === 'granted';
  try { if (await ok('queryPermission') || await ok('requestPermission')) return dirs[n]; } catch {}
  return chooseCsvFolder(n); // folder moved, renamed or access refused: pick it again
}
// Condition 2: Conventional orders sent from customer logins and imported purchase orders (marked "direct") skip the
// Inbox and sit on the Received tab. Create upload CSV saves their files in the Condition 2 folder.
const csvName = o => safeName(`${orderNo(o.number)} ${custOf(o.customer_id)?.name || ''}`) + '.csv';
// Auto CSV (switch on the Orders tab, shared by every staff login): while On, every order that lands on the Received
// tab has its CSV saved in the Condition 2 folder straight away by any Admin or Manager PC that has this app open and is connected
// to that folder. Each order is claimed first, so two open PCs never both save it.
const autoOn = () => S.settings?.auto_csv_2 === 'on';
let auto2Busy = false, auto2Issue = '';
const auto2Due = () => autoOn() ? S.orders.filter(o => o.direct && !o.csv_at && !nothingDelivered(o)) : [];
const autoSwitch = () => `<button type="button" class="autosw${autoOn() ? ' on' : ''}" role="switch" aria-checked="${autoOn()}" ${isManager() ? 'disabled title="Only an Admin can switch this"' : `title="When On, orders arriving on the Received tab get their CSV saved in the ${esc(csvTarget(2) || 'Condition 2')} folder straight away" onclick="toggleAutoCsv(this)"`}><span class="knob"></span>Auto CSV ${autoOn() ? 'On' : 'Off'}</button>`;
async function toggleAutoCsv(btn) {
  const v = autoOn() ? 'off' : 'on';
  if (v === 'on' && !csvTarget(2)) return toast('Choose the Condition 2 folder in Administration › Settings first.');
  btn.disabled = true;
  const { error } = await sb.from('staff_settings').upsert({ key: 'auto_csv_2', value: v, updated_at: new Date().toISOString() });
  if (error) { btn.disabled = false; return toast(friendly(error)); }
  S.settings = { ...S.settings, auto_csv_2: v }; auto2Issue = '';
  render(); toast(v === 'on' ? 'Auto CSV is On: Received tab orders get their CSV saved straight away.' : 'Auto CSV is Off: create Received tab CSVs with Create upload CSV.', true);
  if (v === 'on') { if (dirs[2] && sameName(dirs[2].name, csvTarget(2))) { try { await dirs[2].requestPermission({ mode: 'readwrite' }); } catch {} } autoCsv2(); }
}
function setAuto2(msg) { if (msg === auto2Issue) return; auto2Issue = msg; if (view === 'orders' && canRedraw()) render(); }
async function autoCsv2() {
  if (!isAdmin() || !canPickFolder() || auto2Busy || !auto2Due().length) return auto2Due().length || setAuto2('');
  auto2Busy = true;
  try {
    // Another PC may have just switched it Off.
    const { data: sw } = await sb.from('staff_settings').select('value').eq('key', 'auto_csv_2').maybeSingle();
    if (sw?.value !== 'on') { S.settings = { ...S.settings, auto_csv_2: sw?.value || 'off' }; if (view === 'orders' && canRedraw()) render(); return; }
    if (!dirs[2]) await loadCsvDir(2);
    const dir = dirs[2];
    if (!csvTarget(2)) return setAuto2('no-folder');
    if (!dir || !sameName(dir.name, csvTarget(2))) return setAuto2('connect');
    let perm = 'denied'; try { perm = await dir.queryPermission({ mode: 'readwrite' }); } catch {}
    if (perm !== 'granted') return setAuto2('connect');
    const problems = []; let saved = 0;
    for (const o of auto2Due()) {
      const { text, missing, lines } = orderCsv(o, 2);
      if (missing.length) { problems.push(`${orderNo(o.number)}: no Ref for ${missing.join(', ')}`); continue; }
      if (!lines) continue;
      const { data, error } = await sb.from('orders').update({ csv_at: new Date().toISOString() }).eq('id', o.id).is('csv_at', null).select('id');
      if (error || !data?.length) continue; // another PC got it first
      try { const w = await (await dir.getFileHandle(csvName(o), { create: true })).createWritable(); await w.write(text); await w.close(); saved++; }
      catch (e) { await sb.from('orders').update({ csv_at: null }).eq('id', o.id); problems.push(`${orderNo(o.number)}: couldn’t save to ${dir.name} (${e.message})`); }
    }
    setAuto2(problems.length ? 'problems:' + problems.join('\n') : '');
    if (saved) { await reloadOrders(); if (canRedraw()) render(); toast(`Auto CSV: ${saved} CSV file${saved > 1 ? 's' : ''} saved to ${dir.name}`, true); }
  } finally { auto2Busy = false; }
}
async function reconnectCsv2() {
  const dir = dirs[2] || await loadCsvDir(2);
  if (dir && sameName(dir.name, csvTarget(2))) { try { if (await dir.requestPermission({ mode: 'readwrite' }) === 'granted') { auto2Issue = ''; return autoCsv2(); } } catch {} }
  await chooseCsvFolder(2);
}
function auto2Banner() {
  const n = auto2Due().length; if (!n || !auto2Issue) return '';
  const what = `Auto CSV is On, and ${n} order${n > 1 ? 's are' : ' is'} waiting for a CSV.`;
  if (!canPickFolder()) return `<div class="banner">${what} Open this app in Chrome or Edge on a PC to save them.</div>`;
  if (auto2Issue === 'no-folder') return `<div class="banner">${what} Choose the Condition 2 folder in Administration › Settings.</div>`;
  if (auto2Issue === 'connect') return `<div class="banner">${what} This PC isn’t connected to the ${esc(csvTarget(2))} folder. <button class="link" onclick="reconnectCsv2()">Connect</button></div>`;
  return `<div class="banner">${what} Fix these, then they save on their own:<br>${esc(auto2Issue.slice(9)).replace(/\n/g, '<br>')}</div>`;
}
async function uploadCsvs() {
  dropPastDone(); if (!upPicked.size) { render(); return toast('No CSV can be created for those orders: nothing was delivered, or their required date has passed.'); }
  // Direct (Received tab) orders go to the Condition 2 folder, everything else to Condition 1.
  const os = S.orders.filter(o => upPicked.has(o.id)).sort((a, b) => a.number - b.number), folders = {};
  for (const n of [...new Set(os.map(o => o.direct ? 2 : 1))]) {
    if (n === 2 && canPickFolder() && !csvTarget(2)) return toast('Choose the Condition 2 folder in Administration › Settings first.');
    folders[n] = await csvFolder(n);
    if (canPickFolder() && !folders[n]) return toast(`Choose the ${csvTarget(n)} folder so the CSV files can be saved there.`);
  }
  const bad = [], made = [], used = new Set();
  for (const o of os) {
    const n = o.direct ? 2 : 1, dir = folders[n];
    const { text, missing, lines } = orderCsv(o, n);
    if (missing.length) { bad.push(`${orderNo(o.number)}: no Ref for ${missing.join(', ')}`); continue; }
    if (!lines) { bad.push(`${orderNo(o.number)} has nothing delivered on it`); continue; }
    const name = csvName(o);
    // Claim the order first: if another PC has created its CSV since this screen loaded, skip it.
    const was = o.csv_at || null;
    let claim = sb.from('orders').update({ csv_at: new Date().toISOString() }).eq('id', o.id);
    claim = was ? claim.eq('csv_at', was) : claim.is('csv_at', null);
    const { data: got, error: cerr } = await claim.select('id');
    if (cerr) { bad.push(`${orderNo(o.number)}: ${friendly(cerr)}`); continue; }
    if (!got?.length) { bad.push(`${orderNo(o.number)}: its CSV was just created on another PC, so it was skipped`); continue; }
    if (dir) {
      try { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); }
      catch (e) { await sb.from('orders').update({ csv_at: was }).eq('id', o.id); bad.push(`${orderNo(o.number)}: couldn’t save to ${dir.name} (${e.message})`); continue; }
      used.add(dir.name);
    } else {
      if (made.length) await new Promise(r => setTimeout(r, 400));
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    made.push(o.id);
  }
  made.forEach(id => upPicked.delete(id));
  if (made.length || bad.length) await reloadOrders();
  render();
  if (bad.length) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="grid"><h2>${made.length ? `${made.length} CSV file${made.length > 1 ? 's' : ''} created` : 'No CSV files created'}</h2>
      <p style="margin:0">These orders were skipped:</p>
      <ul class="sumlist">${bad.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <div class="row" style="justify-content:flex-end"><button type="button" class="primary" onclick="document.getElementById('dlg').close()">OK</button></div></div>`;
    dlg.showModal();
  } else toast(`${made.length} CSV file${made.length > 1 ? 's' : ''} ${used.size ? 'saved to ' + [...used].join(' and ') : 'created'}`, true);
}
// Sends each supplier's email from orders@csorders.org (replies go to sales@cssydney.com.au) with the order form PDFs attached,
// then marks as emailed every order whose suppliers were all sent to.
async function sendSupplierEmails(btn) {
  btn.disabled = true;
  if (!(await stillMyDevice())) return;
  const { os, groups } = pickedBySupplier(), failed = new Set(), done = [];
  // Another device (or another person) may have emailed or changed these orders since this screen loaded.
  // Check the latest copy first, then claim the not-yet-emailed ones so two devices can't both send them.
  const { data: fresh, error: ferr } = await sb.from('orders').select('id,number,updated_at,emailed_at').in('id', os.map(o => o.id));
  if (ferr) { btn.disabled = false; return toast(friendly(ferr)); }
  const now = new Map(fresh.map(o => [o.id, o]));
  const elsewhere = os.filter(o => !o.emailed_at && now.get(o.id)?.emailed_at), changed = os.filter(o => now.get(o.id)?.updated_at !== o.updated_at && !elsewhere.includes(o));
  let claimed = [];
  if (!elsewhere.length && !changed.length) {
    const fresh0 = os.filter(o => !o.emailed_at).map(o => o.id);
    if (fresh0.length) {
      const { data: got, error: cerr } = await sb.from('orders').update({ emailed_at: new Date().toISOString() }).in('id', fresh0).is('emailed_at', null).select('id');
      if (cerr) { btn.disabled = false; return toast(friendly(cerr)); }
      claimed = got.map(o => o.id);
      if (claimed.length < fresh0.length) {
        elsewhere.push(...os.filter(o => fresh0.includes(o.id) && !claimed.includes(o.id)));
        if (claimed.length) await sb.from('orders').update({ emailed_at: null }).in('id', claimed);
        claimed = [];
      }
    }
  }
  if (elsewhere.length || changed.length) {
    elsewhere.forEach(o => picked.delete(o.id));
    await reloadOrders(); $('#dlg').close(); render();
    const msg = [elsewhere.length && `${elsewhere.map(o => orderNo(o.number)).join(', ')} ${elsewhere.length > 1 ? 'were' : 'was'} already emailed from another device and ${elsewhere.length > 1 ? 'have' : 'has'} been taken off the list`,
      changed.length && `${changed.map(o => orderNo(o.number)).join(', ')} changed on another device`].filter(Boolean).join('. ');
    alert(`Nothing was sent. ${msg}. Please check the orders, then press Email selected again.`);
    return;
  }
  let ids = [];
  try {
    for (const [i, [s, list]] of groups.entries()) {
      if (sentSuppliers.has(s.id)) continue;
      const st = $(`#est-${i}`) || {}, r = recipients(s);
      if (!r.to.length && !r.cc.length && !r.bcc.length) { list.forEach(o => failed.add(o.id)); continue; }
      st.className = 'est'; st.textContent = 'Sending…';
      let res;
      try {
        const { files } = await buildGroup(i), { subject, body } = mailText(s, list);
        const { data, error } = await sb.functions.invoke(NOTIFY_FN, { body: { action: 'supplier', supplier_id: s.id, subject, text: body, files: files.map(f => ({ name: f.name, content: b64(f.buf) })) } });
        if (error) { let m = ''; try { m = (await error.context.json()).error; } catch { } res = { sent: false, reason: m === 'Order not found.' ? 'The email function in Supabase needs updating first.' : m || 'The email service didn’t answer.' }; }
        else res = data;
      } catch (e) { res = { sent: false, reason: e.message }; }
      if (res?.sent) { st.className = 'est ok'; st.textContent = `Sent to ${[...res.to, ...res.cc].join(', ') || 'BCC only'}`; done.push(s.name); sentSuppliers.add(s.id); }
      else { st.className = 'est err'; st.textContent = res?.reason || 'Not sent'; list.forEach(o => failed.add(o.id)); }
    }
    ids = os.filter(o => (o.lines || []).some(supplierOfLine) && !failed.has(o.id)).map(o => o.id);
    if (ids.length) { const { error } = await sb.from('orders').update({ emailed_at: new Date().toISOString() }).in('id', ids); if (error) toast('Sent, but couldn’t mark the orders as emailed: ' + friendly(error)); }
  } finally {
    // Orders claimed above whose email didn't go are always put back to not emailed, even if something broke.
    const unsent = claimed.filter(id => !ids.includes(id));
    if (unsent.length) { const { error } = await sb.from('orders').update({ emailed_at: null }).in('id', unsent); if (error) toast('Some orders are marked emailed but weren’t sent: ' + friendly(error)); }
  }
  await reloadOrders();
  if (!failed.size) { $('#dlg').close(); picked.clear(); sentSuppliers.clear(); render(); toast(`${done.length} email${done.length === 1 ? '' : 's'} sent and ${ids.length} order${ids.length === 1 ? '' : 's'} marked as emailed`, true); }
  else { render(); toast(done.length ? `${done.length} sent, but some didn’t go. See the dialog.` : 'Nothing was sent. See the dialog.'); btn.disabled = false; btn.textContent = 'Try again'; }
}
async function markEmailed(btn) {
  const ids = pickedBySupplier().os.filter(o => (o.lines || []).some(supplierOfLine)).map(o => o.id);
  btn.disabled = true;
  const { error } = await sb.from('orders').update({ emailed_at: new Date().toISOString() }).in('id', ids);
  btn.disabled = false;
  if (error) { toast(friendly(error)); return; }
  $('#dlg').close(); picked.clear(); await reloadOrders(); render(); toast(`${ids.length} order${ids.length > 1 ? 's' : ''} marked as emailed`, true);
}

// ---------- edit dialogs ----------
function openDialog(title, fieldsHtml, onSave, onDelete) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" class="grid" id="dform"><h2>${esc(title)}</h2>${fieldsHtml}
    <div class="row spread" style="margin-top:8px"><div>${onDelete ? '<button type="button" class="danger" id="ddel">Delete</button>' : ''}</div>
    <div class="row"><button type="button" id="dcancel">Cancel</button><button class="primary" type="submit">Save</button></div></div></form>`;
  dlg.querySelector('#dcancel').onclick = () => dlg.close();
  dlg.querySelector('#dform').onsubmit = async e => { e.preventDefault(); const b = e.submitter; if (b) b.disabled = true; const ok = await onSave(new FormData(e.target)); if (b) b.disabled = false; if (ok) { dlg.close(); await loadAll(); render(); } };
  const del = dlg.querySelector('#ddel');
  if (del) del.onclick = async () => { if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Press again to delete'; return; } if (await onDelete()) { dlg.close(); await loadAll(); render(); } };
  dlg.showModal();
}
const fld = (name, label, val, type = 'text', extra = '') => `<label class="f">${label}<input name="${name}" id="f-${name}" type="${type}" value="${esc(val ?? '')}" ${extra}></label>`;
const nextCid = () => S.customers.reduce((m, c) => Math.max(m, c.cid || 0), 0) + 1;
const allSids = () => S.products.flatMap(p => (p.product_packs || []).map(k => k.sid));
const nextSid = (extra = []) => Math.max(0, ...allSids(), ...extra) + 1;

function editCustomer(id) {
  const c = id ? custOf(id) : {};
  openDialog(id ? 'Edit customer' : 'Add customer',
    `<div class="grid g2">${fld('cid', 'CID (unique number)', c.cid ?? nextCid(), 'number', 'required min="1" step="1"')}${fld('name', 'Customer name', c.name, 'text', 'required')}</div>
     <div class="grid g2">${fld('contact', 'Contact person', c.contact)}${fld('phone', 'Contact phone', c.phone)}</div><div class="grid g2">${fld('email', 'Email', c.email, 'email')}<label class="f">Orders products<select name="product_group" id="f-product_group">${[...GROUPS, 'Both'].map(g => `<option value="${g}" ${custGroup(c) === g ? 'selected' : ''}>${g === 'Both' ? 'Both (Organic and Conventional)' : g}</option>`).join('')}</select></label></div>
     <div class="grid g2"><label class="chk"><input type="checkbox" name="reminders" value="1" ${c.reminders !== false ? 'checked' : ''}> Email a reminder before the cut-off if no order is in (see Administration › Cut-offs)</label><label class="chk"><input type="checkbox" name="sunday_delivery" value="1" ${c.sunday_delivery ? 'checked' : ''}> Sunday delivery (see Administration › Cut-offs)</label></div>
     <label class="f">Notes<textarea name="notes" id="f-notes">${esc(c.notes)}</textarea></label>`,
    f => {
      const row = { cid: Number(f.get('cid')), name: f.get('name').trim(), contact: f.get('contact').trim(), phone: f.get('phone').trim(), email: f.get('email').trim(), notes: f.get('notes').trim() };
      row.product_group = f.get('product_group'); row.sunday_delivery = f.get('sunday_delivery') === '1'; row.reminders = f.get('reminders') === '1';
      if (!Number.isInteger(row.cid) || row.cid < 1) { toast('CID must be a whole number above 0.'); return false; }
      const clash = S.customers.find(x => x.id !== id && x.cid === row.cid); if (clash) { toast(`CID ${row.cid} is already used by ${clash.name}. Next free CID is ${nextCid()}.`); return false; }
      return run(id ? sb.from('customers').update(row).eq('id', id) : sb.from('customers').insert(row), 'Customer saved');
    },
    id && !S.orders.some(o => o.customer_id === id) ? async () => {
      const { count } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', id); // older orders aren't loaded
      if (count) { toast(`${c.name} has ${count} older order${count > 1 ? 's' : ''}, so it can’t be deleted.`); return false; }
      return run(sb.from('customers').delete().eq('id', id), 'Customer deleted');
    } : null);
}
function editSupplier(id) {
  const s = id ? S.suppliers.find(x => x.id === id) : {};
  openDialog(id ? 'Edit supplier' : 'Add supplier',
    fld('name', 'Supplier name', s.name, 'text', 'required') +
    `<p class="muted" style="margin:0;font-size:13px">Order email addresses are set under <b>Administration › Emails</b>.</p>` +
    fld('cutoff', 'Order cut-off', s.cutoff, 'text', 'placeholder="e.g. Orders by 9am for same-day processing"') +
    `<label class="f">Notes<textarea name="notes" id="f-notes">${esc(s.notes)}</textarea></label>`,
    f => {
      const row = { name: f.get('name').trim(), cutoff: f.get('cutoff').trim(), notes: f.get('notes').trim() };
      return run(id ? sb.from('suppliers').update(row).eq('id', id) : sb.from('suppliers').insert(row), 'Supplier saved');
    },
    id && !S.products.some(p => p.supplier_id === id) ? () => run(sb.from('suppliers').delete().eq('id', id), 'Supplier deleted') : null);
}
function packRow(k = {}) {
  const key = k.id || 'new-' + Math.random().toString(36).slice(2, 8);
  return `<div class="packrow withref" data-row="${esc(key)}"><input name="psid" type="number" min="1" step="1" placeholder="SID" aria-label="SID" value="${esc(k.sid ?? '')}">
    <input name="pref" placeholder="Ref" aria-label="Ref" value="${esc(k.ref ?? '')}">
    <label class="pbatch" title="Receivers must enter a batch code for this on Conventional, No customer orders"><input type="checkbox" ${k.batch_code ? 'checked' : ''} onchange="this.nextElementSibling.value=this.checked?'1':'0'"><input type="hidden" name="pbatch" value="${k.batch_code ? '1' : '0'}">Batch</label>
    <input name="pname" placeholder="Pack type, e.g. BOX of 10 BUNCHES" aria-label="Pack type" value="${esc(k.name ?? '')}">
    <input name="pouter" type="number" min="1" step="1" aria-label="Outer multiple" title="Outer multiple" value="${esc(k.outer_multiple ?? 1)}">
    <select name="pavail" aria-label="Availability"><option value="1" ${k.available === false ? '' : 'selected'}>Available</option><option value="0" ${k.available === false ? 'selected' : ''}>Not available</option></select>
    <button type="button" class="ghost" title="Remove this pack type" aria-label="Remove this pack type" onclick="this.parentElement.remove()">✕</button><input type="hidden" name="pid" value="${esc(k.id || '')}"></div>`;
}
function addPackRow() {
  const box = $('#packrows'); const used = [...box.querySelectorAll('input[name=psid]')].map(x => Number(x.value) || 0);
  box.insertAdjacentHTML('beforeend', packRow({ sid: nextSid(used) }));
}
// Every section: the saved list (Products > Sections) plus any a product already uses.
const allSections = () => [...new Set([...(S.sections || []), ...S.products.map(x => x.section).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
function editSections() {
  const used = n => S.products.filter(p => p.section === n).length;
  const rows = allSections().map(n => `<div class="secrow"><input name="secname" value="${esc(n)}" aria-label="Section name"><input type="hidden" name="secold" value="${esc(n)}"><span class="muted">${used(n)} product${used(n) === 1 ? '' : 's'}</span>${used(n) ? '<span></span>' : `<label class="muted"><input type="checkbox" name="secdel" value="${esc(n)}"> Remove</label>`}</div>`).join('');
  openDialog('Sections',
    `<p class="sub" style="margin:0">The headings on the order forms. Change a name to rename it on every product in that section.</p>
     <div class="grid" style="gap:6px">${rows || '<p class="muted">No sections yet.</p>'}</div>
     <label class="f">New section<input name="secnew" id="f-secnew" placeholder="e.g. Microgreens"></label>`,
    async f => {
      const olds = f.getAll('secold'), news = f.getAll('secname').map(x => x.trim()), dels = new Set(f.getAll('secdel')), add = (f.get('secnew') || '').trim();
      const final = olds.map((o, i) => dels.has(o) ? null : news[i]).filter(Boolean).concat(add ? [add] : []);
      if (news.some((n, i) => !n && !dels.has(olds[i]))) { toast('A section name can’t be empty.'); return false; }
      const dup = final.find((n, i) => final.findIndex(x => x.toLowerCase() === n.toLowerCase()) !== i); if (dup) { toast(`There are two sections called “${dup}”.`); return false; }
      // Renames go through a temporary name first, so swapping two names doesn't merge their products.
      const rename = async (from, to) => {
        if (!(await run(sb.from('product_sections').upsert({ name: to })))) return false;
        if (!(await run(sb.from('products').update({ section: to }).eq('section', from)))) return false;
        await sb.from('product_sections').delete().eq('name', from); return true;
      };
      const moves = [];
      for (const [i, o] of olds.entries()) {
        if (dels.has(o)) { if (!(await run(sb.from('product_sections').delete().eq('name', o)))) return false; continue; }
        if (news[i] === o) continue;
        const tmp = `~renaming ${i} ${Date.now()}`;
        if (!(await rename(o, tmp))) return false;
        moves.push([tmp, news[i]]);
      }
      for (const [tmp, n] of moves) if (!(await rename(tmp, n))) return false;
      if (add && !(await run(sb.from('product_sections').upsert({ name: add })))) return false;
      toast('Sections saved', true); return true;
    });
}
function editProduct(id) {
  // A copy, kept up to date as each part saves, so pressing Save again after an error doesn't add things twice.
  const p = id ? { ...prodOf(id), product_packs: [...(prodOf(id).product_packs || [])] } : { supplier_id: S.suppliers[0]?.id, product_packs: [] };
  const secs = allSections();
  const packs = p.product_packs?.length ? p.product_packs : [{ sid: nextSid() }];
  openDialog(id ? 'Edit product' : 'Add product',
    `<label class="f">Supplier<select name="supplier_id" id="f-supplier_id">${S.suppliers.slice().sort(byName).map(s => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="grid g2">${fld('code', 'Supplier code', p.code)}${fld('name', 'Product name', p.name, 'text', 'required')}</div>
    <label class="f">Product group<select name="product_group" id="f-product_group">${GROUPS.map(g => `<option ${groupOf(p) === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    <label class="f">Section on the form<select name="section" id="f-section"><option value="">No section</option>${secs.map(x => `<option ${x === p.section ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><span class="muted" style="font-size:12px">Add or rename sections with the <b>Sections</b> button on the Products page.</span></label>
    <div class="grid" style="gap:6px"><div class="packrow packhead withref"><span>SID</span><span>Ref</span><span>Pack type (match the form’s column heading)</span><span>Outer</span><span>Availability</span><span></span></div>
      <div class="grid" style="gap:6px" id="packrows">${packs.map(packRow).join('')}</div>
      <div><button type="button" class="ghost" onclick="addPackRow()">+ Add pack type</button></div></div>
    <div class="grid g2">${fld('sort', 'Position on the form', p.sort ?? '', 'number')}
    <label class="f">Show on order forms<select name="active" id="f-active"><option value="1" ${p.active !== false ? 'selected' : ''}>Yes</option><option value="0" ${p.active === false ? 'selected' : ''}>No, hide it</option></select></label></div>`,
    async f => {
      const name = f.get('name').trim(); if (!name) { toast('Enter a product name.'); return false; }
      const names = f.getAll('pname').map(x => x.trim()), sids = f.getAll('psid'), refs = f.getAll('pref').map(x => x.trim()), outs = f.getAll('pouter'), avail = f.getAll('pavail'), batches = f.getAll('pbatch'), pids = f.getAll('pid');
      const rows = []; const others = S.products.filter(x => x.id !== id).flatMap(x => (x.product_packs || []).map(k => ({ sid: k.sid, ref: (k.ref || '').trim().toUpperCase(), label: `${x.name} (${k.name})` })));
      for (let i = 0; i < names.length; i++) {
        if (!names[i]) continue;
        const sid = Number(sids[i]), outer = Number(outs[i]);
        if (rows.some(r => r.name === names[i])) { toast(`Pack type "${names[i]}" is listed twice.`); return false; }
        if (!Number.isInteger(sid) || sid < 1) { toast(`Give "${names[i]}" a SID that is a whole number above 0.`); return false; }
        if (rows.some(r => r.sid === sid)) { toast(`SID ${sid} is used twice on this product.`); return false; }
        const clash = others.find(o => o.sid === sid); if (clash) { toast(`SID ${sid} is already used by ${clash.label}.`); return false; }
        if (!Number.isInteger(outer) || outer < 1) { toast(`Outer multiple for "${names[i]}" must be a whole number of 1 or more.`); return false; }
        // Ref is optional, but each one must be unique across every pack type.
        const ref = refs[i] || '', REF = ref.toUpperCase();
        if (REF && rows.some(r => (r.ref || '').toUpperCase() === REF)) { toast(`Ref ${ref} is used twice on this product.`); return false; }
        const refClash = REF && others.find(o => o.ref === REF); if (refClash) { toast(`Ref ${ref} is already used by ${refClash.label}.`); return false; }
        rows.push({ i, id: pids[i] || undefined, name: names[i], sid, ref: ref || null, outer_multiple: outer, available: avail[i] === '1', batch: batches[i] === '1', sort: rows.length });
      }
      if (!rows.length) { toast('Add at least one pack type.'); return false; }
      const prow = { supplier_id: f.get('supplier_id'), code: f.get('code').trim(), name, section: f.get('section').trim(), sort: f.get('sort') === '' ? 999 : +f.get('sort'), active: f.get('active') === '1' };
      prow.product_group = f.get('product_group');
      const saved = await run(id ? sb.from('products').update(prow).eq('id', id).select().single() : sb.from('products').insert(prow).select().single());
      if (!saved) return false;
      const pid = id = saved.id;
      // Remove dropped pack types first, then park SIDs on temporary values so swaps between rows don't collide.
      const keep = rows.filter(r => r.id).map(r => r.id);
      const dropped = (p.product_packs || []).filter(k => !keep.includes(k.id)).map(k => k.id);
      if (dropped.length && !await run(sb.from('product_packs').delete().in('id', dropped))) return false;
      p.product_packs = p.product_packs.filter(k => keep.includes(k.id));
      for (const r of rows.filter(r => r.id)) {
        const old = (p.product_packs || []).find(k => k.id === r.id);
        if (old && old.sid !== r.sid && !await run(sb.from('product_packs').update({ sid: 2000000000 - Math.floor(Math.random() * 1e6) }).eq('id', r.id))) return false;
        if (old && (old.ref || null) !== r.ref && old.ref && !await run(sb.from('product_packs').update({ ref: null }).eq('id', r.id))) return false;
      }
      for (const r of rows) {
        const body = { product_id: pid, name: r.name, sid: r.sid, outer_multiple: r.outer_multiple, available: r.available, sort: r.sort };
        body.ref = r.ref;
        if (r.batch || (p.product_packs || []).find(k => k.id === r.id)?.batch_code) body.batch_code = r.batch; // only sent when used, so saving works before 030 is run
        const k = await run(r.id ? sb.from('product_packs').update(body).eq('id', r.id).select().single() : sb.from('product_packs').insert(body).select().single());
        if (!k) return false;
        p.product_packs = [...p.product_packs.filter(x => x.id !== k.id), k];
        document.querySelectorAll('#dlg input[name=pid]')[r.i].value = k.id;
      }
      toast('Product saved', true); return true;
    },
    id ? () => run(sb.from('products').delete().eq('id', id), 'Product deleted') : null);
}
function editLogin(uid) {
  const u = S.profiles.find(x => x.id === uid);
  let welcomed = false; // so pressing Save again after an error can't text twice
  openDialog(u.approved ? 'Edit login' : 'Approve login',
    `<p style="margin:0"><b>${esc(u.full_name || u.email)}</b><br><span class="mono muted">${esc(u.email)}</span>${u.business ? `<br>Business they gave: ${esc(u.business)}` : ''}</p>
    <label class="f">Mobile number<input name="mobile" id="f-mobile" type="tel" placeholder="04XX XXX XXX" value="${esc(u.mobile || '')}"></label>
    <label class="f">Role<select name="role" id="f-role" onchange="document.getElementById('custpick').hidden = this.value!=='customer'"><option value="customer" ${!['admin', 'manager', 'receiver'].includes(u.role) ? 'selected' : ''}>Customer: orders for the businesses ticked below</option><option value="receiver" ${u.role === 'receiver' ? 'selected' : ''}>Receiver: checks deliveries and marks orders received</option><option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager: orders, customers and products, not Suppliers or Administration</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin: full access, like you</option></select></label>
    ${`<div class="custpick" id="custpick" ${['admin', 'manager', 'receiver'].includes(u.role) ? 'hidden' : ''}>Customers this login orders for<input class="search" placeholder="Find a customer" oninput="for(const l of document.querySelectorAll('#custlist label'))l.hidden=!l.textContent.toLowerCase().includes(this.value.toLowerCase())"><div class="custlist" id="custlist">${S.customers.slice().sort(byName).map(c => `<label><input type="checkbox" name="customer_ids" value="${c.id}" ${loginCustIds(u).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div><span class="muted" style="font-size:12px">Tick more than one and the customer picks which business each order is for.</span></div>`}
    <label class="f">Access<select name="approved" id="f-approved"><option value="1" selected>Allowed to sign in</option><option value="0">Blocked</option></select></label>`,
    async f => {
      const role = f.get('role'), approved = f.get('approved') === '1', mtxt = f.get('mobile').trim(), mobile = auMobile(mtxt);
      if (mtxt && !mobile) { toast('Please enter a valid Australian mobile number, like 0412 345 678.'); return false; }
      const ids = role !== 'customer' ? [] : f.getAll('customer_ids');
      if (role === 'customer' && approved && !ids.length) { toast('Choose which customer this login orders for.'); return false; }
      // The main customer stays the same while it is still ticked; the rest are linked in profile_customers.
      const customer_id = ids.includes(u.customer_id) ? u.customer_id : ids[0] || null;
      const upd = { role, customer_id, approved }; if ((mobile || null) !== (u.mobile ?? null)) upd.mobile = mobile || null;
      if (!(await run(sb.from('profiles').update(upd).eq('id', uid)))) return false;
      const gone = loginCustIds(u).filter(id => !ids.includes(id));
      if (gone.length && !(await run(sb.from('profile_customers').delete().eq('profile_id', uid).in('customer_id', gone)))) return false;
      if (ids.length && !(await run(sb.from('profile_customers').upsert(ids.map(id => ({ profile_id: uid, customer_id: id })))))) return false;
      // A customer login that has just been approved gets a text saying it is ready.
      if (!u.approved && approved && role === 'customer' && !welcomed) {
        welcomed = true;
        if (!mobile) { toast('Login saved. No mobile number, so no welcome text was sent.', true); return true; }
        const { data, error } = await sb.functions.invoke(NOTIFY_FN, { body: { action: 'welcome-sms', id: uid } });
        let m = ''; if (error) try { m = (await error.context.json()).error; } catch { }
        toast(data?.sent ? `Login saved. Welcome text sent to ${mobile}.` : `Login saved, but the welcome text wasn’t sent: ${data?.reason || m || 'the text service didn’t answer.'}`, !!data?.sent);
        return true;
      }
      toast('Login saved', true); return true;
    },
    // Deleting removes the sign-in for good. Not offered on your own login.
    uid !== profile.id ? async () => {
      const { error } = await sb.rpc('delete_login', { user_id: uid });
      if (error) { toast(friendly(error)); return false; }
      toast('Login deleted', true); return true;
    } : null);
}

start();
