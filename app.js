// SMFW Orders: one page app for admins (SMFW staff) and customers.
// Data and logins live in Supabase; access rules in supabase/schema.sql decide what each person can see.

const cfg = window.SMFW_CONFIG || {};
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const S = { customers: [], suppliers: [], products: [], orders: [], profiles: [], emails: [], emailsMissing: false, groupsMissing: false };
const GROUPS = ['Organic', 'Conventional'];
const groupOf = p => p.product_group || 'Organic';
// Each customer orders one group (migrations/013); customers saved before that are Organic.
const custGroup = c => c?.product_group || 'Organic';
// An order's group comes from its products: Organic unless every line is Conventional.
const orderGroups = o => [...new Set((o.lines || []).map(l => prodOf(l.product_id)).filter(Boolean).map(groupOf))];
const orderGroup = o => { const g = orderGroups(o); return g.length === 1 ? g[0] : 'Organic'; };
let session = null, profile = null, view = null, draft = null, listFilter = 'all', search = '', authMode = 'signin', authMsg = '', ordersChannel = null;
let groupFilter = 'all';
const picked = new Set(); // orders ticked on the Orders tab for emailing
const upPicked = new Set(); // orders ticked on the Orders tab for an upload CSV

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
// Orders being placed must be required tomorrow or later.
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return new Date(+y, m - 1, +dd).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = t => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const bySort = (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || byName(a, b);
const orderNo = n => n == null ? '' : 'SO-' + String(n).padStart(4, '0');
// Admins and Managers share the office dashboard; only Admins see Suppliers, Emails and Logins (migrations/012).
const isAdmin = () => ['admin', 'manager'].includes(profile?.role) && profile?.approved;
const isManager = () => profile?.role === 'manager' && profile?.approved;
const ADMIN_ONLY = ['suppliers', 'emails', 'users'];
// Receivers see every order read-only (migrations/010).
const isReceiver = () => profile?.role === 'receiver' && profile?.approved;
// Conventional orders are entered by SMFW for its own supply, so they have no customer.
const needsCustomer = d => !(isAdmin() && d.group === 'Conventional');
const custOf = id => S.customers.find(c => c.id === id);
const prodOf = id => S.products.find(p => p.id === id);
const packOf = id => { for (const p of S.products) { const k = (p.product_packs || []).find(x => x.id === id); if (k) return { p, k }; } return null; };
const STATUS = { draft: 'Draft', submitted: 'Sent', complete: 'Complete' };

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
  if (err.code === '23502' && /customer_id/.test(m)) return 'Orders without a customer need one more database update. Run 007_conventional_no_customer.sql in the Supabase SQL Editor.';
  if (err.code === '23514' && /profiles_role_check/.test(m)) return 'This role needs one more database update. Run 010_receiver_role.sql and 012_manager_role.sql in the Supabase SQL Editor.';
  if (err.code === '23503') return 'This is still used elsewhere, so it can’t be deleted.';
  if (err.code === '42501' || /row-level security/i.test(m)) return 'You don’t have permission to do that.';
  return m;
}
async function run(promise, okMsg) { const { data, error } = await promise; if (error) { toast(friendly(error)); return null; } if (okMsg) toast(okMsg, true); return data ?? true; }

// ---------- data ----------
async function loadAll() {
  // product_group arrives with migrations/004; until it is run, load without it and treat everything as Organic.
  // ref arrives with migrations/008; until then packs load without it and the Ref box is hidden.
  const cols = g => `id,supplier_id,code,name,section,sort,active${g ? ',product_group' : ''},product_packs(id,name,sid${S.refMissing ? '' : ',ref'},outer_multiple,available,sort)`;
  let probe = await sb.from('products').select('product_group').limit(1);
  S.groupsMissing = !!probe.error && /product_group/.test(probe.error.message || '');
  probe = await sb.from('product_packs').select('ref').limit(1);
  S.refMissing = !!probe.error && /ref/.test(probe.error.message || '');
  probe = await sb.from('customers').select('product_group').limit(1);
  S.custGroupMissing = !!probe.error && /product_group/.test(probe.error.message || '');
  const prods = sb.from('products').select(cols(!S.groupsMissing));
  const orders = sb.from('orders').select('*').order('number', { ascending: false });
  if (isReceiver()) {
    const [c, s, p, o] = await Promise.all([sb.from('customers').select('id,cid,name,phone'), sb.from('suppliers').select('*'), prods, orders]);
    for (const r of [c, s, p, o]) if (r.error) toast(friendly(r.error));
    S.customers = c.data || []; S.suppliers = s.data || []; S.products = p.data || []; S.orders = o.data || [];
  } else if (isAdmin()) {
    const [c, s, p, o, u, m] = await Promise.all([sb.from('customers').select('*'), sb.from('suppliers').select('*'), prods, orders, sb.from('profiles').select('*').order('created_at'), sb.from('supplier_emails').select('*').order('sort')]);
    for (const r of [c, s, p, o, u]) if (r.error) toast(friendly(r.error));
    S.customers = c.data || []; S.suppliers = s.data || []; S.products = p.data || []; S.orders = o.data || []; S.profiles = u.data || [];
    // The order-emails table arrives with migrations/002; until it is run, fall back to the addresses on each supplier.
    S.emailsMissing = !!m.error; S.emails = m.data || [];
    if (m.error && !['42P01', 'PGRST205'].includes(m.error.code)) toast(friendly(m.error));
  } else {
    const [c, p, o] = await Promise.all([sb.from('customers').select(`id,cid,name${S.custGroupMissing ? '' : ',product_group'}`), prods.eq('active', true), orders]);
    for (const r of [c, p, o]) if (r.error) toast(friendly(r.error));
    S.customers = c.data || []; S.suppliers = []; S.products = p.data || []; S.orders = o.data || [];
  }
  S.products.forEach(p => (p.product_packs || []).sort((a, b) => a.sort - b.sort));
}
async function reloadOrders() { const { data, error } = await sb.from('orders').select('*').order('number', { ascending: false }); if (!error) S.orders = data; }

function listenForOrders() {
  if (ordersChannel) sb.removeChannel(ordersChannel);
  ordersChannel = sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async payload => {
    const before = payload.old, after = payload.new;
    await reloadOrders();
    if (isAdmin() && after?.status === 'submitted' && before?.status !== 'submitted' && after.source === 'customer')
      toast(`New order ${orderNo(after.number)} from ${custOf(after.customer_id)?.name || 'a customer'}`, true);
    if (view !== 'entry') render(); else updateNavBadge();
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
async function enter() {
  if (!session) { profile = null; view = null; $('#top').hidden = true; if (ordersChannel) { sb.removeChannel(ordersChannel); ordersChannel = null; } renderAuth(); return; }
  if (authMode === 'newpass') return renderAuth();
  await loadProfile();
  if (!profile || !profile.approved || (!isAdmin() && !isReceiver() && !profile.customer_id)) { $('#top').hidden = true; return renderPending(); }
  $('#top').hidden = false;
  $('#contact').hidden = isAdmin() || isReceiver(); // customers see who to call or email
  $('#whoami').textContent = (profile.full_name || profile.email) + (isManager() ? ' · Manager' : isAdmin() ? ' · Admin' : isReceiver() ? ' · Receiver' : '');
  await loadAll();
  if (isAdmin()) await loadCsvDir();
  listenForOrders();
  if (!view) view = homeView();
  render();
}
$('#signout').addEventListener('click', () => sb.auth.signOut());

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
    if (authMode === 'signin') ({ error } = await sb.auth.signInWithPassword({ email, password }));
    else if (authMode === 'signup') {
      const r = await sb.auth.signUp({ email, password, options: { data: { full_name: $('#a-name').value.trim(), business: $('#a-biz').value.trim() }, emailRedirectTo: location.origin + location.pathname } });
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
    ? [['inbox', 'Inbox'], ['orders', 'Orders'], ['entry', 'New order'], ['customers', 'Customers'], ['products', 'Products'], ['suppliers', 'Suppliers'], ['emails', 'Emails'], ['users', 'Logins']].filter(([v]) => !isManager() || !ADMIN_ONLY.includes(v))
    : [['mine', 'My orders'], ['entry', 'New order']];
}
function inboxCount() { return S.orders.filter(o => o.status === 'submitted').length; }
function updateNavBadge() { const b = document.querySelector('#nav [data-v=inbox] .badge'); const n = inboxCount(); if (b) { b.textContent = n; b.hidden = !n; } }
function go(v, fresh = true) { view = v; if (v === 'entry' && fresh) draft = blankOrder(); render(); window.scrollTo(0, 0); }
// Each tab press fetches fresh data, so new sign-ups and other people's edits show up.
$('#nav').addEventListener('click', async e => { const b = e.target.closest('button[data-v]'); if (!b) return; await loadAll(); go(b.dataset.v); });

function render() {
  const nav = $('#nav');
  nav.innerHTML = navItems().map(([v, label]) => `<button data-v="${v}" aria-current="${v === view && !(v === 'entry' && draft?.id) ? 'page' : 'false'}">${label}${v === 'inbox' ? `<span class="badge" ${inboxCount() ? '' : 'hidden'}>${inboxCount()}</span>` : ''}</button>`).join('');
  const views = { recv: viewRecv, recvorder: viewRecvOrder, inbox: viewInbox, orders: viewOrders, mine: viewMine, entry: viewEntry, customers: viewCustomers, products: viewProducts, suppliers: viewSuppliers, emails: viewEmails, users: viewUsers };
  const allowed = isManager() ? Object.keys(views).filter(v => !ADMIN_ONLY.includes(v) && !v.startsWith('recv')) : isAdmin() ? null : isReceiver() ? ['recv', 'recvorder'] : ['mine', 'entry'];
  if (!views[view] || ['recv', 'recvorder'].includes(view) && !isReceiver() || (allowed && !allowed.includes(view))) view = homeView();
  if (view === 'entry' && !draft) draft = blankOrder();
  $('#app').innerHTML = views[view]();
  if (view === 'entry') wireEntry();
  if (view === 'orders') wireOrderSearch();
  if (view === 'recvorder') wireRecvOrder();
  if (view === 'recv') { const i = $('#osearch'); if (i) i.oninput = () => { search = i.value; render(); const j = $('#osearch'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; }
}

// ---------- order lists ----------
function orderRow(o, opts = {}) {
  const c = custOf(o.customer_id);
  return `<tr class="rowlink" onclick="openOrder('${o.id}')">
    <td class="mono">${esc(orderNo(o.number))}${!S.groupsMissing && orderGroup(o) === 'Conventional' ? ' <span class="pill grp-conventional">Conv.</span>' : ''}</td>
    ${opts.customer === false ? '' : `<td>${c ? esc(c.name) : o.customer_id ? 'Unknown customer' : '<span class="muted">No customer</span>'}</td>`}
    <td>${esc(fmtDate(o.required_date))}</td>
    ${opts.sent ? `<td>${esc(fmtWhen(o.submitted_at))}</td>` : ''}
    ${opts.source ? `<td>${o.source === 'customer' ? 'Customer' : 'SMFW'}</td>` : ''}
    <td class="num lines">${(o.lines || []).filter(l => !l.undelivered).length}</td>
    <td>${opts.pick ? `<div class="stgrid"><span class="pill ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span><span>${o.emailed_at ? `<span class="pill emailed" title="Emailed ${esc(fmtWhen(o.emailed_at))}">Emailed</span>` : ''}</span><span>${receivedPill(o)}</span><span>${o.csv_at ? `<span class="pill emailed" title="CSV created ${esc(fmtWhen(o.csv_at))}">CSV</span>` : ''}</span></div>`
      : `<span class="pill ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span>`}</td>
    ${opts.customer === false ? `<td class="num acts" onclick="event.stopPropagation()"><button class="ghost" onclick="openOrder('${o.id}')">View</button><button class="ghost" onclick="printOrder('${o.id}', this)">Print<span class="long"> Order</span></button></td>`
      : `<td class="num openc"><button class="ghost" onclick="event.stopPropagation();openOrder('${o.id}')">Open</button></td>`}
    ${opts.pick ? `<td class="pick" onclick="event.stopPropagation()"><input type="checkbox" data-up="${o.id}" aria-label="Select ${esc(orderNo(o.number))} for an upload CSV" ${upPicked.has(o.id) ? 'checked' : ''}></td>` : ''}
    ${opts.pick ? `<td class="pick" onclick="event.stopPropagation()"><input type="checkbox" data-pick="${o.id}" aria-label="Select ${esc(orderNo(o.number))} for emailing" ${picked.has(o.id) ? 'checked' : ''}></td>` : ''}</tr>`;
}
// Receiver: completed orders not yet received.
function viewRecv() {
  let os = S.orders.filter(o => o.status === 'complete' && !o.received_at);
  const q = search.trim().toLowerCase();
  if (q) os = os.filter(o => [orderNo(o.number), custOf(o.customer_id)?.name, custOf(o.customer_id)?.cid].join(' ').toLowerCase().includes(q));
  return `<h1>Orders</h1><p class="sub">Orders waiting to be received. Open an order to correct quantities or flag lines that didn’t arrive, save it, then press Mark received.</p>
    <div class="row" style="margin-bottom:12px"><input class="search" id="osearch" placeholder="Search order no., customer or CID" value="${esc(search)}"></div>
    ${os.length ? `<div class="tablewrap"><table class="recvlist"><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>Ticked</th><th class="acts"></th></tr></thead><tbody>${os.map(o => {
      const c = custOf(o.customer_id);
      return `<tr><td class="mono">${esc(orderNo(o.number))}${orderGroup(o) === 'Conventional' ? ' <span class="pill grp-conventional">Conv.</span>' : ''}</td>
        <td>${c ? esc(c.name) : '<span class="muted">No customer</span>'}</td>
        <td>${esc(fmtDate(o.required_date))}</td><td><span class="${tickedCount(o) < (o.lines || []).length ? 'ndtxt' : 'okgreen'}">${tickedCount(o)}/${(o.lines || []).length}</span></td>
        <td class="num acts recvacts"><button class="ghost" onclick="openReceipt('${o.id}')">Open</button><button class="ghost" onclick="markReceived('${o.id}', this)">Mark received</button></td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="card empty">${S.orders.some(o => o.status === 'complete' && !o.received_at) ? 'No orders match this search.' : 'Nothing waiting. Every order has been received.'}</div>`}`;
}
// Receiver: one order's lines, with the quantity that arrived and a Not delivered tick for each.
let receipt = null;
function openReceipt(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  receipt = { id, lines: (o.lines || []).map(l => ({ ...l, ordered: l.ordered_qty ?? l.qty, qty: l.qty, undelivered: !!l.undelivered, received: !!l.received && !l.undelivered })) };
  go('recvorder', false);
}
function viewRecvOrder() {
  const o = S.orders.find(x => x.id === receipt?.id); if (!o) { view = 'recv'; return viewRecv(); }
  const c = custOf(o.customer_id), sup = l => S.suppliers.find(s => s.id === prodOf(l.product_id)?.supplier_id)?.name || 'Other';
  const bySup = {}; receipt.lines.forEach((l, i) => (bySup[sup(l)] ||= []).push([l, i]));
  return `<div class="row spread"><div><h1>Order ${esc(orderNo(o.number))}</h1><div class="recvcust">${c ? esc(c.name) : '<span class="muted">No customer</span>'}</div><p class="sub">${o.required_date ? 'Needed ' + esc(fmtDate(o.required_date)) + '. ' : ''}Tick Received for each line that arrived, changing the quantity if a different amount came, or tick Not delivered.</p></div>
      <div class="row"><button onclick="receipt=null;go('recv',false)">Back</button><button class="primary" onclick="saveReceipt(this)">Save</button></div></div>
    ${Object.entries(bySup).map(([sn, ls]) => `<h2 style="margin:16px 0 8px">${esc(sn)}</h2><div class="tablewrap"><table><thead><tr><th>Product</th><th>Pack</th><th class="num">Ordered</th><th class="num">Qty received</th><th class="pick">Received</th><th class="pick">Not delivered</th></tr></thead><tbody>
      ${ls.map(([l, i]) => `<tr${l.undelivered ? ' class="nd"' : ''}><td>${esc(l.product_name)}</td><td>${esc(l.pack_name)}</td><td class="num mono">${esc(l.ordered)}</td>
        <td class="num"><input class="rq" inputmode="numeric" data-i="${i}" value="${esc(l.qty)}" ${l.undelivered ? 'disabled' : ''} aria-label="${esc(l.product_name)} received"></td>
        <td class="pick"><input type="checkbox" data-rc="${i}" ${l.received ? 'checked' : ''} aria-label="${esc(l.product_name)} received"></td>
        <td class="pick"><input type="checkbox" data-nd="${i}" ${l.undelivered ? 'checked' : ''} aria-label="${esc(l.product_name)} not delivered"></td></tr>`).join('')}
    </tbody></table></div>`).join('')}`;
}
function wireRecvOrder() {
  document.querySelectorAll('input.rq').forEach(inp => inp.oninput = () => { const v = inp.value.replace(/[^\d]/g, ''); if (v !== inp.value) inp.value = v; receipt.lines[inp.dataset.i].qty = v === '' ? 0 : +v; });
  document.querySelectorAll('input[data-nd]').forEach(cb => cb.onchange = () => { const l = receipt.lines[cb.dataset.nd]; l.undelivered = cb.checked; if (cb.checked) l.received = false; render(); });
  document.querySelectorAll('input[data-rc]').forEach(cb => cb.onchange = () => { const l = receipt.lines[cb.dataset.rc]; l.received = cb.checked; if (cb.checked) l.undelivered = false; render(); });
}
async function saveReceipt(btn) {
  btn.disabled = true;
  const items = receipt.lines.map(l => ({ pack_id: l.pack_id, qty: l.qty, undelivered: l.undelivered || !(l.qty > 0), received: l.received && !l.undelivered && l.qty > 0 }));
  const { error } = await sb.rpc('save_receipt', { order_id: receipt.id, items });
  btn.disabled = false;
  if (error) return toast(/save_receipt/.test(error.message) ? 'One step first: run 011_receiving.sql in Supabase.' : friendly(error));
  await reloadOrders(); receipt = null; toast('Saved. Press Mark received when you’re done with this order.', true); go('recv', false);
}
// Every line must be ticked Received or Not delivered (and saved) before the order can be marked received.
const tickedCount = o => (o.lines || []).filter(l => l.received || l.undelivered).length;
function markReceived(id, btn) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const left = (o.lines || []).length - tickedCount(o);
  if (left) return toast(`Open the order and tick Received or Not delivered on ${left === 1 ? 'the last line' : `the ${left} remaining lines`}, then Save.`);
  setReceived(id, true, btn);
}
const receivedPill = o => o.received_at ? ` <span class="pill emailed" title="Received ${esc(fmtWhen(o.received_at))}${o.received_by ? ' by ' + esc(o.received_by) : ''}">Received</span>` : '';
async function setReceived(id, received, btn) {
  btn.disabled = true;
  const { error } = await sb.rpc('set_received', { order_id: id, received });
  btn.disabled = false;
  if (error) return toast(/set_received/.test(error.message) ? 'One step first: run 010_receiver_role.sql in Supabase.' : friendly(error));
  await reloadOrders(); render(); toast(received ? 'Marked as received' : 'Received tick removed', true);
}
function viewInbox() {
  const os = S.orders.filter(o => o.status === 'submitted').sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
  return `<h1>Inbox</h1><p class="sub">Orders customers have sent that still need processing. Open one to check it and mark it complete.</p>
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>Sent</th><th>From</th><th class="num lines">Lines</th><th>Status</th><th class="openc"></th></tr></thead><tbody>${os.map(o => orderRow(o, { sent: true, source: true })).join('')}</tbody></table></div>`
      : `<div class="card empty">No orders waiting. New customer orders appear here as soon as they’re sent.</div>`}`;
}
function viewOrders() {
  let os = S.orders.slice();
  if (listFilter !== 'all') os = os.filter(o => o.status === listFilter);
  const q = search.trim().toLowerCase();
  if (q) os = os.filter(o => [orderNo(o.number), custOf(o.customer_id)?.name, custOf(o.customer_id)?.cid].join(' ').toLowerCase().includes(q));
  const count = f => f === 'all' ? S.orders.length : S.orders.filter(o => o.status === f).length;
  return `<div class="row spread"><div><h1>Orders</h1><p class="sub">Every order, whether a customer sent it or you entered it.</p></div><button class="primary" onclick="go('entry')">New order</button></div>
    <div class="row" style="margin-bottom:12px">
      ${['all', 'draft', 'submitted', 'complete'].map(f => `<button class="${listFilter === f ? 'primary' : ''}" onclick="listFilter='${f}';render()">${f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : f === 'submitted' ? 'Sent' : 'Complete'} (${count(f)})</button>`).join('')}
      <input class="search" id="osearch" placeholder="Search order no., customer or CID" value="${esc(search)}">
    </div>
    ${os.length ? `<div class="pickbar row spread"><span id="pickcount">${pickText()}</span><div class="row"><button id="pickclear" ${picked.size || upPicked.size ? '' : 'hidden'} onclick="picked.clear();upPicked.clear();render()">Clear</button><button class="primary" id="pickup" ${upPicked.size ? '' : 'disabled'} onclick="uploadCsvs()">Create upload CSV</button>${csvFolderNote()}<button class="primary" id="pickmail" ${picked.size ? '' : 'disabled'} onclick="emailPicked()">Email selected</button></div></div>
      <div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>From</th><th class="num lines">Lines</th><th><div class="stgrid"><span>Status</span><span>Emailed</span><span>Received</span><span>CSV</span></div></th><th class="openc"></th><th class="pick"><span class="picklbl">Upload</span><input type="checkbox" id="upall" aria-label="Select all orders shown for upload" ${os.every(o => upPicked.has(o.id)) ? 'checked' : ''}></th><th class="pick"><span class="picklbl">Email</span><input type="checkbox" id="pickall" aria-label="Select all orders shown for emailing" ${os.every(o => picked.has(o.id)) ? 'checked' : ''}></th></tr></thead><tbody>${os.map(o => orderRow(o, { source: true, pick: true })).join('')}</tbody></table></div>`
      : `<div class="card empty">${S.orders.length ? 'No orders match this filter.' : 'No orders yet.'}</div>`}`;
}
function wireOrderSearch() {
  const i = $('#osearch'); if (!i) return; i.oninput = () => { search = i.value; render(); const j = $('#osearch'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); };
  // Two tick columns: Upload (CSV) and Email, each with its own select-all box.
  const sync = () => { $('#pickcount').textContent = pickText(); $('#pickmail').disabled = !picked.size; $('#pickup').disabled = !upPicked.size; $('#pickclear').hidden = !picked.size && !upPicked.size; };
  [['pick', picked, 'pickall'], ['up', upPicked, 'upall']].forEach(([key, set, allId]) => {
    const boxes = [...document.querySelectorAll(`input[data-${key}]`)], all = $('#' + allId);
    const syncAll = () => { if (all) all.checked = boxes.length && boxes.every(b => b.checked); sync(); };
    boxes.forEach(b => b.onchange = () => { b.checked ? set.add(b.dataset[key]) : set.delete(b.dataset[key]); syncAll(); });
    if (all) all.onchange = () => { boxes.forEach(b => { b.checked = all.checked; all.checked ? set.add(b.dataset[key]) : set.delete(b.dataset[key]); }); sync(); };
  });
}
const pickText = () => picked.size || upPicked.size ? [upPicked.size && `${upPicked.size} for upload`, picked.size && `${picked.size} to email`].filter(Boolean).join(' · ') : 'Tick orders on the right to create an upload CSV or email them to the supplier.';
// On an iPhone or iPad in Safari, suggest adding the site to the home screen so it opens like an app.
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function homeTip() {
  let hidden = false; try { hidden = localStorage.getItem('smfw-hometip') === 'off'; } catch (e) {}
  if (hidden || !isIos() || isStandalone()) return '';
  return `<div class="hometip" id="hometip"><span>Tip: tap <b>Share</b> <span aria-hidden="true">⬆︎</span> then <b>Add to Home Screen</b> to open SMFW Orders like an app.</span><button class="ghost" aria-label="Hide this tip" onclick="try{localStorage.setItem('smfw-hometip','off')}catch(e){};document.getElementById('hometip').remove()">✕</button></div>`;
}
function viewMine() {
  const os = S.orders;
  const me = custOf(profile.customer_id);
  return `<div class="row spread"><div>${me?.name ? `<p class="custname">${esc(me.name)}</p>` : ''}<h1>My orders</h1></div><button class="primary" onclick="go('entry')">New order</button></div>
    ${homeTip()}
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Required</th><th class="num lines">Lines</th><th>Status</th><th class="acts"></th></tr></thead><tbody>${os.map(o => orderRow(o, { customer: false })).join('')}</tbody></table></div>`
      : `<div class="card empty">You haven’t placed any orders yet. Press <b>New order</b> to start one.</div>`}`;
}
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  draft = { id, number: o.number, customer_id: o.customer_id, order_date: o.order_date, required_date: o.required_date || '', special: o.special || '', status: o.status, source: o.source, submitted_at: o.submitted_at, qty: {} };
  (o.lines || []).forEach(l => { if (l.pack_id) draft.qty[l.pack_id] = l.qty; });
  // Keep what a Receiver recorded (ordered_qty, undelivered) when an admin re-saves the order.
  draft.receipt = Object.fromEntries((o.lines || []).filter(l => l.pack_id && (l.ordered_qty != null || l.undelivered || l.received)).map(l => [l.pack_id, { ordered_qty: l.ordered_qty, undelivered: !!l.undelivered, received: !!l.received }]));
  draft.missing = (o.lines || []).filter(l => !packOf(l.pack_id));
  draft.group = orderGroup(o);
  go('entry', false);
}

// ---------- order entry ----------
function blankOrder() { return { id: null, number: null, customer_id: isAdmin() ? '' : profile?.customer_id, order_date: today(), required_date: '', special: '', status: 'draft', source: isAdmin() ? 'admin' : 'customer', qty: {}, missing: [], group: isAdmin() ? 'Organic' : custGroup(custOf(profile?.customer_id)) }; }
const outerOf = k => Number(k.outer_multiple) || 1;
function sectionsFor(products) {
  const secs = [], idx = {};
  products.filter(p => p.active !== false).sort(bySort).forEach(p => {
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
  products.filter(p => p.active !== false).sort(bySort).forEach(p => (p.product_packs || []).filter(k => k.available).forEach(k => rows[k.name]?.push({ p, k })));
  packs.splice(0, packs.length, ...packs.filter(pk => rows[pk].length));
  return `<div class="flat">${packs.map(pk => `<div class="sec flatsec"><table><colgroup><col style="width:52px"><col><col style="width:90px"></colgroup><thead><tr><th colspan="2"><span class="sectitle">${esc(pk)}</span> <span class="muted" style="font-weight:400">${rows[pk].length} products</span></th><th class="packh">Qty</th></tr></thead><tbody>
    ${rows[pk].map(({ p, k }) => { const q = draft.qty[k.id]; return `<tr><td class="code">${esc(p.code)}</td><td>${esc(p.name)}</td><td class="q"><input inputmode="numeric" ${dis} aria-label="${esc(p.name)}, ${esc(pk)}" title="SID ${esc(k.sid)}" data-k="${k.id}" value="${esc(q || '')}" class="${q ? 'has' : ''}"></td></tr>`; }).join('')}
  </tbody></table></div>`).join('')}</div>`;
}
function canEditDraft() {
  if (isAdmin()) return draft.status !== 'complete';
  return draft.status === 'draft';
}
function viewEntry() {
  const d = draft, admin = isAdmin(), editable = canEditDraft();
  const dis = editable ? '' : 'disabled';
  let blocks;
  if (admin) {
    // Admins enter one group at a time: the form shows only the Organic or only the Conventional products.
    const g = d.group || 'Organic';
    blocks = S.suppliers.slice().sort(byName).map(s => {
      const secs = sectionsFor(S.products.filter(p => p.supplier_id === s.id && groupOf(p) === g)); if (!secs.length) return '';
      return `<section class="supplier-block"><div class="supplier-head"><h2>${esc(s.name)}</h2><span>${esc(s.cutoff || '')}</span></div><div class="sections">${g === 'Conventional' ? flatHtml(S.products.filter(p => p.supplier_id === s.id && groupOf(p) === g), dis) : gridHtml(secs, dis)}</div></section>`;
    }).join('') || `<div class="card empty" style="margin-top:16px">No ${g} products are set up yet. Add them under <b>Products</b>.</div>`;
  } else {
    // Customers order their own group only (set on the customer); Conventional uses the same flat list as the admin app.
    const g = custGroup(custOf(profile?.customer_id)), mine = S.products.filter(p => groupOf(p) === g), secs = sectionsFor(mine);
    blocks = secs.length ? `<section class="supplier-block"><div class="supplier-head"><h2>${g}</h2><span>${g === 'Conventional' ? 'Fill in the quantities you need.' : 'Fill in the boxes you need. Grey boxes aren’t available.'}</span></div><div class="sections">${g === 'Conventional' ? flatHtml(mine, dis) : gridHtml(secs, dis)}</div></section>` : '';
  }
  const custField = admin
    ? `<label class="f">Customer<select id="e-cust" ${dis}><option value="">${needsCustomer(d) ? 'Choose a customer…' : 'No customer (SMFW, CID 1183)'}</option>${S.customers.filter(c => custGroup(c) === (d.group || 'Organic') || c.id === d.customer_id).sort(byName).map(c => `<option value="${c.id}" ${c.id === d.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
       <label class="f">Contact phone<input id="e-phone" disabled value="${esc(custOf(d.customer_id)?.phone || '')}"></label>`
    : `<label class="f">Customer<input disabled value="${esc(custOf(d.customer_id)?.name || '')}"></label>`;
  const note = d.status === 'complete' ? (admin ? 'This order is complete. Reopen it to make changes.' : 'SMFW has processed this order.')
    : d.status === 'submitted' ? (admin ? `Sent by the customer ${esc(fmtWhen(d.submitted_at))}. Check it, make any changes, then mark it complete.` : 'You’ve sent this order to SMFW. Contact SMFW if anything needs to change.')
    : 'Fill in the quantities needed. Empty boxes are ignored.';
  const missing = d.missing?.length ? `<div class="banner">${d.missing.length} line${d.missing.length > 1 ? 's refer' : ' refers'} to a pack type that no longer exists: ${d.missing.map(l => esc(`${l.product_name} (${l.pack_name}) × ${l.qty}`)).join(', ')}. Saving will drop ${d.missing.length > 1 ? 'them' : 'it'}.</div>` : '';
  return `<div class="row spread"><div><h1>${d.id ? 'Order ' + esc(orderNo(d.number)) : 'New order'}</h1><p class="sub">${note}</p></div>
      <span class="pill ${d.status}">${STATUS[d.status]}</span></div>${missing}
    <div class="entry"><div>
      ${admin ? `<div class="grpswitch" role="radiogroup" aria-label="Order type">${GROUPS.map(g => `<button type="button" role="radio" aria-checked="${(d.group || 'Organic') === g}" class="${(d.group || 'Organic') === g ? 'on' : ''}" ${dis} onclick="setGroup('${g}')">${g} order</button>`).join('')}</div>` : ''}
      <div class="card grid g2">
        ${custField}
        <label class="f">Today’s date<input type="date" id="e-date" disabled title="Set automatically" value="${esc(d.status === 'draft' ? today() : d.order_date)}"></label>
        <label class="f">Day / date required<input type="date" id="e-req" ${dis} ${d.status === 'draft' ? `min="${tomorrow()}"` : ''} value="${esc(d.required_date)}"></label>
        <label class="f" style="grid-column:1/-1">Special requirements<textarea id="e-special" ${dis}>${esc(d.special)}</textarea></label>
      </div>
      <div class="row" style="margin-top:16px"><input class="search" id="e-find" placeholder="Find a product by name or code"></div>
      ${blocks || '<div class="card empty" style="margin-top:16px">No products are set up yet.</div>'}
    </div>
    <aside class="card summary" id="summary">${summaryHtml()}</aside></div>`;
}
function setGroup(g) {
  if (draft.group === g) return;
  // Quantities belong to one group's form; switching drops the other group's lines after a check.
  const other = Object.entries(draft.qty).filter(([k, q]) => +q > 0 && groupOf(packOf(k)?.p || {}) !== g);
  if (other.length && !confirm(`Switch to a ${g} order? The ${other.length} ${draft.group} line${other.length > 1 ? 's' : ''} already entered will be cleared.`)) return;
  other.forEach(([k]) => delete draft.qty[k]);
  // Customers are set up for one group, so a customer from the other group is cleared.
  if (draft.customer_id && custGroup(custOf(draft.customer_id)) !== g) draft.customer_id = '';
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
    if (d.status === 'complete') btns = `<button onclick="reopenOrder()">Reopen to edit</button><button class="primary" onclick="draft=null;go('orders',false)">Close</button>`;
    else btns = `<button onclick="saveOrder('${d.status === 'submitted' ? 'submitted' : 'draft'}')">${d.status === 'submitted' ? 'Save changes' : 'Save draft'}</button><button class="primary" onclick="saveOrder('complete')">Transmit Order</button>`;
  } else if (d.status === 'draft') btns = `<button onclick="saveOrder('draft')">Save draft</button><button class="primary" onclick="saveOrder('submitted')">Send order</button>`;
  const del = d.id && (admin || d.status === 'draft') ? `<div class="row" style="margin-top:8px"><button class="danger" onclick="deleteOrder(this)">Delete order</button></div>` : '';
  return `<h2>Order summary</h2>
    <p class="muted" style="margin:4px 0 0">${esc(custOf(d.customer_id)?.name || (needsCustomer(d) ? 'No customer chosen' : 'Conventional order'))}${d.required_date ? ' · needed ' + esc(fmtDate(d.required_date)) : ''}</p>
    ${lines.length ? body + `<p style="margin:12px 0 0"><b>${got.length}</b> line${got.length === 1 ? '' : 's'} · <b>${total}</b> in total${nd ? ` · <span class="ndtxt">${nd} not delivered</span>` : ''}</p>` : '<p class="muted">No quantities entered yet.</p>'}
    <div class="row" style="margin-top:16px">${btns}</div>${del}`;
}
function wireEntry() {
  const sync = () => { $('#summary').innerHTML = summaryHtml(); };
  $('#e-cust')?.addEventListener('change', e => { draft.customer_id = e.target.value; $('#e-phone').value = custOf(draft.customer_id)?.phone || ''; sync(); });
  $('#e-req')?.addEventListener('change', e => { draft.required_date = e.target.value; sync(); });
  $('#e-special')?.addEventListener('input', e => draft.special = e.target.value);
  document.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
    const v = inp.value.replace(/[^\d]/g, ''); if (v !== inp.value) inp.value = v;
    if (+v > 0) draft.qty[inp.dataset.k] = +v; else delete draft.qty[inp.dataset.k];
    inp.classList.toggle('has', +v > 0); sync();
  }));
  // Enter or Down arrow moves to the next quantity box, Shift+Enter or Up arrow goes back, skipping rows the search hides.
  // On the order-form grid this stays in the same pack column, running on through the sections below.
  document.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('keydown', e => {
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
  if (saving) return;
  const lines = draftLines();
  if (status !== 'draft') {
    if (needsCustomer(draft) && !draft.customer_id) return toast('Choose a customer first.');
    if (!lines.length) return toast('Enter at least one quantity first.');
    if (!draft.required_date) return toast('Add the day/date required first.');
    // Only checked when the order is placed, so older orders can still be processed after their date.
    if (draft.status === 'draft' && draft.required_date < tomorrow()) return toast(`The date required must be tomorrow (${fmtDate(tomorrow())}) or later.`);
  } else if (needsCustomer(draft) && !draft.customer_id) return toast('Choose a customer first.');
  // Today's date is fixed: an order is dated the day it's saved, and keeps that date once it's sent.
  const row = { customer_id: needsCustomer(draft) ? draft.customer_id : null, order_date: draft.status === 'draft' ? today() : draft.order_date || today(), required_date: draft.required_date || null, special: draft.special || null, status, lines };
  saving = true;
  const q = draft.id ? sb.from('orders').update(row).eq('id', draft.id).select().single() : sb.from('orders').insert({ ...row, source: isAdmin() ? 'admin' : 'customer' }).select().single();
  const { data, error } = await q;
  saving = false;
  if (error) return toast(friendly(error));
  if (!data) return toast('This order can no longer be changed.');
  const msg = status === 'complete' ? `Order ${orderNo(data.number)} completed` : status === 'submitted' ? (isAdmin() ? `Order ${orderNo(data.number)} saved` : `Order ${orderNo(data.number)} sent to SMFW`) : `Draft ${orderNo(data.number)} saved`;
  toast(msg, true);
  await reloadOrders();
  draft = null; go(isAdmin() ? (status === 'complete' ? 'orders' : view === 'entry' && data.source === 'customer' ? 'inbox' : 'orders') : 'mine', false);
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
function viewCustomers() {
  const cs = S.customers.slice().sort(byName);
  return `<div class="row spread"><div><h1>Customers</h1><p class="sub">The businesses who order from you.${isManager() ? '' : ' Link a login to a customer under <b>Logins</b>.'}</p></div><button class="primary" onclick="editCustomer()">Add customer</button></div>
  ${cs.length ? `<div class="tablewrap"><table><thead><tr><th class="num">CID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th>${S.custGroupMissing ? '' : '<th>Type</th>'}${isManager() ? '' : '<th class="num">Logins</th>'}<th class="num">Orders</th><th></th></tr></thead><tbody>
    ${cs.map(c => `<tr><td class="num mono">${esc(c.cid)}</td><td><b>${esc(c.name)}</b>${c.notes ? `<div class="muted" style="font-size:12px">${esc(c.notes)}</div>` : ''}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td>${S.custGroupMissing ? '' : `<td><span class="pill grp-${custGroup(c).toLowerCase()}">${custGroup(c)}</span></td>`}${isManager() ? '' : `<td class="num">${S.profiles.filter(u => u.customer_id === c.id).length}</td>`}<td class="num">${S.orders.filter(o => o.customer_id === c.id).length}</td><td class="num"><button class="ghost" onclick="editCustomer('${c.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No customers yet.</div>`}`;
}
function viewSuppliers() {
  const ss = S.suppliers.slice().sort(byName);
  return `<div class="row spread"><div><h1>Suppliers</h1><p class="sub">Who you buy from. Customers never see this list.</p></div><button class="primary" onclick="editSupplier()">Add supplier</button></div>
  ${ss.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Order emails</th><th>Cut-off</th><th class="num">Products</th><th></th></tr></thead><tbody>
    ${ss.map(s => `<tr><td><b>${esc(s.name)}</b>${s.notes ? `<div class="muted" style="font-size:12px">${esc(s.notes)}</div>` : ''}</td><td class="mono">${recipientsHtml(s)}</td><td>${esc(s.cutoff)}</td><td class="num">${S.products.filter(p => p.supplier_id === s.id).length}</td><td class="num"><button class="ghost" onclick="editSupplier('${s.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No suppliers yet.</div>`}`;
}
function viewProducts() {
  const blocks = S.suppliers.slice().sort(byName).map(s => {
    const ps = S.products.filter(p => p.supplier_id === s.id && (groupFilter === 'all' || groupOf(p) === groupFilter)).sort(bySort); if (!ps.length) return '';
    return `<h2 style="margin:20px 0 8px">${esc(s.name)}</h2><div class="tablewrap"><table><thead><tr><th>Code</th><th>Product</th><th>Group</th><th>Section</th><th>Pack types · SID · outer</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr${p.active === false ? ' class="muted"' : ''}><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}${p.active === false ? ' <span class="pill">Hidden</span>' : ''}</td><td><span class="pill grp-${groupOf(p).toLowerCase()}">${groupOf(p)}</span></td><td>${esc(p.section)}</td>
      <td>${(p.product_packs || []).map(k => `<div><span class="mono muted">SID ${esc(k.sid)}</span>${k.ref ? ` <span class="mono muted">· Ref ${esc(k.ref)}</span>` : ''} ${esc(k.name)} <span class="mono muted">· outer ${outerOf(k)}</span>${k.available ? '' : ' <span class="pill">Not available</span>'}</div>`).join('')}</td>
      <td class="num"><button class="ghost" onclick="editProduct('${p.id}')">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }).join('');
  const n = g => g === 'all' ? S.products.length : S.products.filter(p => groupOf(p) === g).length;
  const filters = `<div class="row" style="margin-bottom:4px">${['all', ...GROUPS].map(g => `<button class="${groupFilter === g ? 'primary' : ''}" onclick="groupFilter='${g}';render()">${g === 'all' ? 'All' : g} (${n(g)})</button>`).join('')}</div>`;
  const note = S.groupsMissing ? `<div class="banner">To use the Organic and Conventional groups, run <a href="https://raw.githubusercontent.com/muzzascan-creator/smfw-orders/main/supabase/migrations/004_product_groups.sql" target="_blank" rel="noopener">004_product_groups.sql</a> in Supabase’s SQL Editor, then reload. Until then every product counts as Organic.</div>` : '';
  return `<div class="row spread"><div><h1>Products</h1><p class="sub">Grouped by supplier, in the same sections as their order forms.</p></div>${S.suppliers.length ? `<button class="primary" onclick="editProduct()">Add product</button>` : ''}</div>
  ${note}${S.products.length ? filters : ''}
  ${blocks || `<div class="card empty">${S.products.length ? 'No products in this group yet.' : `No products yet.${S.suppliers.length ? '' : ' Add a supplier first.'}`}</div>`}`;
}
function viewUsers() {
  const us = S.profiles.slice().sort((a, b) => (a.approved - b.approved) || (a.email || '').localeCompare(b.email || ''));
  const waiting = us.filter(u => !u.approved).length;
  const link = location.origin + location.pathname;
  return `<h1>Logins</h1><p class="sub">Customers create their own account at <span class="mono">${esc(link)}</span>. Link each new account to its customer so they can start ordering.${waiting ? ` <b>${waiting} waiting.</b>` : ''}</p>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Business they gave</th><th>Role</th><th>Linked customer</th><th>Access</th><th></th></tr></thead><tbody>
  ${us.map(u => `<tr><td>${esc(u.full_name)}</td><td class="mono">${esc(u.email)}</td><td>${esc(u.business || '')}</td><td>${u.role === 'admin' ? 'Admin' : u.role === 'manager' ? 'Manager' : u.role === 'receiver' ? 'Receiver' : 'Customer'}</td>
    <td>${['admin', 'manager'].includes(u.role) ? '<span class="muted">All customers</span>' : u.role === 'receiver' ? '<span class="muted">All orders, view only</span>' : esc(custOf(u.customer_id)?.name || '')}</td>
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
  if (S.emailsMissing) return (s.emails || []).map(esc).join('<br>');
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
function viewEmails() {
  const head = `<h1>Order emails</h1><p class="sub">Where each supplier’s completed orders are sent. Add as many addresses as you need, choose To, CC or BCC for each, and untick <b>Send</b> to pause one without deleting it.</p>`;
  if (S.emailsMissing) return head + `<div class="card"><p style="margin-top:0"><b>One step first.</b> This section needs a new table in your database. In Supabase open <b>SQL Editor</b>, paste in <a href="https://raw.githubusercontent.com/muzzascan-creator/smfw-orders/main/supabase/migrations/002_supplier_emails.sql" target="_blank" rel="noopener">002_supplier_emails.sql</a> and press <b>Run</b>, then reload this page. Your existing supplier addresses are carried across.</p></div>`;
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
  await loadAll(); render();
  if (ok) toast('Order emails saved', true);
}

// ---------- emailing orders to suppliers ----------
// Each ticked order becomes the supplier's whole order form as an A4 PDF, with this order's quantities filled in.
// The email itself opens in the admin's own email program, addressed from the Emails tab, ready to attach and send.
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
function loadPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = JSPDF_URL; s.onload = ok; s.onerror = () => fail(new Error('Couldn’t load the PDF maker. Check your internet connection and try again.')); document.head.append(s); });
}
const supplierOfLine = l => S.suppliers.find(s => s.id === prodOf(l.product_id)?.supplier_id);
function recipients(s) {
  if (S.emailsMissing) return { to: s.emails || [], cc: [], bcc: [] };
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
  const own = S.products.filter(mine);
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
          const x = x0 + CW + NW + i * PW, k = (p.product_packs || []).find(z => z.name === pk), ok = k && k.available, q = ok ? qty[k.id] : null;
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
  return { buf: doc.output('arraybuffer'), lines };
}
// Customer printout: their order on the order form (same layout as the supplier's copy), opened ready to print.
async function printOrder(id, btn) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const w = window.open('', '_blank'); // opened straight from the click so the browser allows it
  btn.disabled = true;
  try {
    const { buf } = await formPdf(o, { id: '*', name: custGroup(custOf(o.customer_id)) });
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
function emailPicked() {
  const { os, groups } = pickedBySupplier();
  const empty = os.filter(o => !(o.lines || []).some(supplierOfLine));
  const notDone = os.filter(o => o.status !== 'complete');
  const blocks = groups.map(([s, list], i) => {
    const r = recipients(s), none = !r.to.length && !r.cc.length && !r.bcc.length;
    return `<div class="card" style="padding:12px"><div class="row spread"><b>${esc(s.name)}</b><span class="muted" style="font-size:12px">${list.length} form${list.length > 1 ? 's' : ''}</span></div>
      <p style="margin:6px 0;font-size:13px">${none ? `<span class="err">No addresses are switched on for this supplier. ${isManager() ? 'Ask an Admin to add them under <b>Emails</b>.' : 'Add them under <b>Emails</b> first.'}</span>` : ['to', 'cc', 'bcc'].filter(k => r[k].length).map(k => `<b>${SEND_AS[k]}:</b> <span class="mono">${r[k].map(esc).join(', ')}</span>`).join('<br>')}</p>
      <ul class="sumlist" style="margin:6px 0">${list.map(o => `<li><span class="mono">${esc(formFileName(o, s))}</span></li>`).join('')}</ul>
      <div class="row"><button type="button" class="primary" ${none ? 'disabled' : ''} onclick="outlookEmail(${i}, this)">Open in Outlook</button><span class="muted" style="font-size:12px">Saves an email with the PDF${list.length > 1 ? 's' : ''} attached. Open it from Downloads, then press Send.</span></div></div>`;
  }).join('');
  const dlg = $('#dlg');
  dlg.innerHTML = `<div class="grid"><h2>Email ${os.length} order${os.length > 1 ? 's' : ''} to suppliers</h2>
    ${notDone.length ? `<div class="banner">Not marked complete yet: ${notDone.map(o => esc(orderNo(o.number))).join(', ')}.</div>` : ''}
    ${empty.length ? `<div class="banner">No lines to send on ${empty.map(o => esc(orderNo(o.number))).join(', ')}, so ${empty.length > 1 ? 'they are' : 'it is'} skipped.</div>` : ''}
    ${blocks || '<div class="card empty">None of the selected orders have any lines.</div>'}
    <div class="row spread" style="margin-top:4px"><button type="button" onclick="document.getElementById('dlg').close()">Close</button>
    ${groups.length ? `<button type="button" class="primary" onclick="markEmailed(this)">Mark ${os.length - empty.length} as emailed</button>` : ''}</div></div>`;
  dlg.showModal();
}
async function buildGroup(i) {
  const [s, list] = pickedBySupplier().groups[i];
  const files = [];
  for (const o of list) files.push({ name: formFileName(o, s), ...(await formPdf(o, s)) });
  return { s, list, files };
}
async function downloadForms(i, btn) {
  btn.disabled = true;
  try { const { files } = await buildGroup(i); for (const [n, f] of files.entries()) { if (n) await new Promise(r => setTimeout(r, 400)); download(f.buf, f.name); } toast(`${files.length} form${files.length > 1 ? 's' : ''} downloaded`, true); }
  catch (e) { toast(e.message); } finally { btn.disabled = false; }
}
// The new email's addresses, subject and message, as links for a mail app, Gmail and Outlook on the web.
// They are plain links (not opened from code) so the browser always lets them open.
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
function composeLinks(s, list) {
  const r = recipients(s), { subject, body } = mailText(s, list);
  const enc = encodeURIComponent, addr = xs => xs.map(x => enc(x).replace(/%40/g, '@')).join(',');
  const mq = [r.cc.length && 'cc=' + addr(r.cc), r.bcc.length && 'bcc=' + addr(r.bcc), 'subject=' + enc(subject), 'body=' + enc(body)].filter(Boolean).join('&');
  const qs = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + enc(v)).join('&');
  return [
    ['Email app', `mailto:${addr(r.to)}?${mq}`],
    ['Gmail', 'https://mail.google.com/mail/?' + qs({ view: 'cm', fs: '1', to: r.to.join(','), cc: r.cc.join(','), bcc: r.bcc.join(','), su: subject, body })],
    ['Outlook web', 'https://outlook.office.com/mail/deeplink/compose?' + qs({ to: r.to.join(','), cc: r.cc.join(','), bcc: r.bcc.join(','), subject, body })],
  ];
}
// Upload CSV, one file per order:
//   H,<CID>,<date required as YYYYMMDD>
//   D,<Ref>,<order qty × outer multiple>   (one line per order line)
const CONVENTIONAL_CID = 1183;
const ymd = d => (d || '').replace(/-/g, '');
const csvCell = v => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
function orderCsv(o) {
  // An order goes under its customer's CID; a Conventional order SMFW enters without a customer goes under 1183.
  const cust = o.customer_id ? custOf(o.customer_id)?.cid ?? '' : orderGroup(o) === 'Conventional' ? CONVENTIONAL_CID : '';
  const missing = [], rows = [['H', cust, ymd(o.required_date || o.order_date)]];
  for (const l of o.lines || []) {
    if (l.undelivered || !(+l.qty > 0)) continue; // undelivered lines never go in the upload
    const k = packOf(l.pack_id)?.k, ref = (k?.ref || '').trim();
    if (!ref) { missing.push(`${l.product_name} (${l.pack_name})`); continue; }
    rows.push(['D', ref, (+l.qty || 0) * (Number(l.outer) || Number(k?.outer_multiple) || 1)]);
  }
  return { text: rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n', missing };
}
// CSV folder: Chrome and Edge on a PC can save straight into a chosen folder (the C94GSHS folder on the network).
// The folder is picked once and remembered in this browser; other browsers fall back to Downloads.
const CSV_FOLDER = 'C94GSHS';
const canPickFolder = () => 'showDirectoryPicker' in window;
let csvDir = null;
function idb(mode, fn) {
  return new Promise((res, rej) => { const q = indexedDB.open('smfw', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => { try { const t = q.result.transaction('kv', mode), x = fn(t.objectStore('kv')); t.oncomplete = () => res(x?.result); t.onerror = () => rej(t.error); } catch (e) { rej(e); } }; q.onerror = () => rej(q.error); });
}
async function loadCsvDir() { if (!canPickFolder()) return null; try { csvDir = await idb('readonly', st => st.get('csvDir')) || null; } catch { csvDir = null; } return csvDir; }
async function chooseCsvFolder() {
  try { csvDir = await window.showDirectoryPicker({ id: 'csvfolder', mode: 'readwrite' }); } catch { return null; } // cancelled
  try { await idb('readwrite', st => st.put(csvDir, 'csvDir')); } catch {}
  if (csvDir.name.toUpperCase() !== CSV_FOLDER) toast(`That folder is "${csvDir.name}", not ${CSV_FOLDER}. CSV files will be saved there until you change it.`);
  render(); return csvDir;
}
async function csvFolder() {
  if (!canPickFolder()) return null;
  if (!csvDir) await loadCsvDir();
  if (!csvDir) return chooseCsvFolder();
  const ok = async q => (await csvDir[q]({ mode: 'readwrite' })) === 'granted';
  try { if (await ok('queryPermission') || await ok('requestPermission')) return csvDir; } catch {}
  return chooseCsvFolder(); // folder moved, renamed or access refused: pick it again
}
const csvFolderNote = () => canPickFolder() ? `<span class="muted" style="font-size:12px">CSV folder: <b>${esc(csvDir?.name || 'not chosen')}</b> <button class="link" onclick="chooseCsvFolder()">${csvDir ? 'Change' : 'Choose'}</button></span>` : '';
async function uploadCsvs() {
  if (S.refMissing) return toast('One step first: run 008_pack_ref.sql in Supabase so products can have a Ref.');
  const dir = await csvFolder();
  if (canPickFolder() && !dir) return toast(`Choose the ${CSV_FOLDER} folder so the CSV files can be saved there.`);
  const os = S.orders.filter(o => upPicked.has(o.id)).sort((a, b) => a.number - b.number);
  const bad = [], made = [];
  for (const o of os) {
    const { text, missing } = orderCsv(o);
    if (!(o.lines || []).length) { bad.push(`${orderNo(o.number)} has no lines`); continue; }
    if (missing.length) { bad.push(`${orderNo(o.number)}: no Ref for ${missing.join(', ')}`); continue; }
    const name = safeName(`${orderNo(o.number)} ${custOf(o.customer_id)?.name || ''}`) + '.csv';
    if (dir) {
      try { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); }
      catch (e) { bad.push(`${orderNo(o.number)}: couldn’t save to ${dir.name} (${e.message})`); continue; }
    } else {
      if (made.length) await new Promise(r => setTimeout(r, 400));
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    made.push(o.id);
  }
  made.forEach(id => upPicked.delete(id));
  // Stamp the orders so they show a CSV tag (needs migrations/009).
  if (made.length) {
    const { error } = await sb.from('orders').update({ csv_at: new Date().toISOString() }).in('id', made);
    if (error) toast(/csv_at/.test(error.message) ? 'CSV files created. To show the CSV tag, run 009_order_csv.sql in Supabase.' : friendly(error));
    else await reloadOrders();
  }
  render();
  if (bad.length) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="grid"><h2>${made.length ? `${made.length} CSV file${made.length > 1 ? 's' : ''} created` : 'No CSV files created'}</h2>
      <p style="margin:0">These orders were skipped. Fix the problems below, then try again:</p>
      <ul class="sumlist">${bad.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <div class="row" style="justify-content:flex-end"><button type="button" class="primary" onclick="document.getElementById('dlg').close()">OK</button></div></div>`;
    dlg.showModal();
  } else toast(`${made.length} CSV file${made.length > 1 ? 's' : ''} ${dir ? 'saved to ' + dir.name : 'created'}`, true);
}
async function markEmailed(btn) {
  const ids = pickedBySupplier().os.filter(o => (o.lines || []).some(supplierOfLine)).map(o => o.id);
  btn.disabled = true;
  const { error } = await sb.from('orders').update({ emailed_at: new Date().toISOString() }).in('id', ids);
  btn.disabled = false;
  if (error) { toast(/emailed_at/.test(error.message) ? 'One step first: run 003_order_emailed.sql in Supabase, then try again.' : friendly(error)); return; }
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
     <div class="grid g2">${fld('contact', 'Contact person', c.contact)}${fld('phone', 'Contact phone', c.phone)}</div><div class="grid g2">${fld('email', 'Email', c.email, 'email')}${S.custGroupMissing ? '' : `<label class="f">Orders products<select name="product_group" id="f-product_group">${GROUPS.map(g => `<option value="${g}" ${custGroup(c) === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`}</div>
     <label class="f">Notes<textarea name="notes" id="f-notes">${esc(c.notes)}</textarea></label>`,
    f => {
      const row = { cid: Number(f.get('cid')), name: f.get('name').trim(), contact: f.get('contact').trim(), phone: f.get('phone').trim(), email: f.get('email').trim(), notes: f.get('notes').trim() };
      if (!S.custGroupMissing) row.product_group = f.get('product_group');
      if (!Number.isInteger(row.cid) || row.cid < 1) { toast('CID must be a whole number above 0.'); return false; }
      const clash = S.customers.find(x => x.id !== id && x.cid === row.cid); if (clash) { toast(`CID ${row.cid} is already used by ${clash.name}. Next free CID is ${nextCid()}.`); return false; }
      return run(id ? sb.from('customers').update(row).eq('id', id) : sb.from('customers').insert(row), 'Customer saved');
    },
    id && !S.orders.some(o => o.customer_id === id) ? () => run(sb.from('customers').delete().eq('id', id), 'Customer deleted') : null);
}
function editSupplier(id) {
  const s = id ? S.suppliers.find(x => x.id === id) : {};
  openDialog(id ? 'Edit supplier' : 'Add supplier',
    fld('name', 'Supplier name', s.name, 'text', 'required') +
    (S.emailsMissing ? `<label class="f">Order email addresses (one per line)<textarea name="emails" id="f-emails">${esc((s.emails || []).join('\n'))}</textarea></label>`
      : `<p class="muted" style="margin:0;font-size:13px">Order email addresses are set under <b>Emails</b>.</p>`) +
    fld('cutoff', 'Order cut-off', s.cutoff, 'text', 'placeholder="e.g. Orders by 9am for same-day processing"') +
    `<label class="f">Notes<textarea name="notes" id="f-notes">${esc(s.notes)}</textarea></label>`,
    f => {
      const row = { name: f.get('name').trim(), cutoff: f.get('cutoff').trim(), notes: f.get('notes').trim() };
      if (S.emailsMissing) {
        const emails = f.get('emails').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
        const bad = emails.find(e => !EMAIL_RE.test(e)); if (bad) { toast('Check this email address: ' + bad); return false; }
        row.emails = emails;
      }
      return run(id ? sb.from('suppliers').update(row).eq('id', id) : sb.from('suppliers').insert(row), 'Supplier saved');
    },
    id && !S.products.some(p => p.supplier_id === id) ? () => run(sb.from('suppliers').delete().eq('id', id), 'Supplier deleted') : null);
}
function packRow(k = {}) {
  const key = k.id || 'new-' + Math.random().toString(36).slice(2, 8);
  return `<div class="packrow${S.refMissing ? '' : ' withref'}" data-row="${esc(key)}"><input name="psid" type="number" min="1" step="1" placeholder="SID" aria-label="SID" value="${esc(k.sid ?? '')}">
    ${S.refMissing ? '' : `<input name="pref" placeholder="Ref" aria-label="Ref" value="${esc(k.ref ?? '')}">`}
    <input name="pname" placeholder="Pack type, e.g. BOX of 10 BUNCHES" aria-label="Pack type" value="${esc(k.name ?? '')}">
    <input name="pouter" type="number" min="1" step="1" aria-label="Outer multiple" title="Outer multiple" value="${esc(k.outer_multiple ?? 1)}">
    <select name="pavail" aria-label="Availability"><option value="1" ${k.available === false ? '' : 'selected'}>Available</option><option value="0" ${k.available === false ? 'selected' : ''}>Not available</option></select>
    <button type="button" class="ghost" title="Remove this pack type" aria-label="Remove this pack type" onclick="this.parentElement.remove()">✕</button><input type="hidden" name="pid" value="${esc(k.id || '')}"></div>`;
}
function addPackRow() {
  const box = $('#packrows'); const used = [...box.querySelectorAll('input[name=psid]')].map(x => Number(x.value) || 0);
  box.insertAdjacentHTML('beforeend', packRow({ sid: nextSid(used) }));
}
function editProduct(id) {
  const p = id ? prodOf(id) : { supplier_id: S.suppliers[0]?.id, product_packs: [] };
  const secs = [...new Set(S.products.map(x => x.section).filter(Boolean))];
  const packs = p.product_packs?.length ? p.product_packs : [{ sid: nextSid() }];
  openDialog(id ? 'Edit product' : 'Add product',
    `<label class="f">Supplier<select name="supplier_id" id="f-supplier_id">${S.suppliers.slice().sort(byName).map(s => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="grid g2">${fld('code', 'Supplier code', p.code)}${fld('name', 'Product name', p.name, 'text', 'required')}</div>
    ${S.groupsMissing ? '' : `<label class="f">Product group<select name="product_group" id="f-product_group">${GROUPS.map(g => `<option ${groupOf(p) === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`}
    <label class="f">Section on the form<input name="section" id="f-section" list="seclist" value="${esc(p.section)}"><datalist id="seclist">${secs.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="grid" style="gap:6px"><div class="packrow packhead${S.refMissing ? '' : ' withref'}"><span>SID</span>${S.refMissing ? '' : '<span>Ref</span>'}<span>Pack type (match the form’s column heading)</span><span>Outer</span><span>Availability</span><span></span></div>
      <div class="grid" style="gap:6px" id="packrows">${packs.map(packRow).join('')}</div>
      <div><button type="button" class="ghost" onclick="addPackRow()">+ Add pack type</button></div></div>
    <div class="grid g2">${fld('sort', 'Position on the form', p.sort ?? '', 'number')}
    <label class="f">Show on order forms<select name="active" id="f-active"><option value="1" ${p.active !== false ? 'selected' : ''}>Yes</option><option value="0" ${p.active === false ? 'selected' : ''}>No, hide it</option></select></label></div>`,
    async f => {
      const name = f.get('name').trim(); if (!name) { toast('Enter a product name.'); return false; }
      const names = f.getAll('pname').map(x => x.trim()), sids = f.getAll('psid'), refs = f.getAll('pref').map(x => x.trim()), outs = f.getAll('pouter'), avail = f.getAll('pavail'), pids = f.getAll('pid');
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
        rows.push({ id: pids[i] || undefined, name: names[i], sid, ref: ref || null, outer_multiple: outer, available: avail[i] === '1', sort: rows.length });
      }
      if (!rows.length) { toast('Add at least one pack type.'); return false; }
      const prow = { supplier_id: f.get('supplier_id'), code: f.get('code').trim(), name, section: f.get('section').trim(), sort: f.get('sort') === '' ? 999 : +f.get('sort'), active: f.get('active') === '1' };
      if (!S.groupsMissing) prow.product_group = f.get('product_group');
      const saved = await run(id ? sb.from('products').update(prow).eq('id', id).select().single() : sb.from('products').insert(prow).select().single());
      if (!saved) return false;
      const pid = saved.id;
      // Remove dropped pack types first, then park SIDs on temporary values so swaps between rows don't collide.
      const keep = rows.filter(r => r.id).map(r => r.id);
      const dropped = (p.product_packs || []).filter(k => !keep.includes(k.id)).map(k => k.id);
      if (dropped.length && !await run(sb.from('product_packs').delete().in('id', dropped))) return false;
      for (const r of rows.filter(r => r.id)) {
        const old = (p.product_packs || []).find(k => k.id === r.id);
        if (old && old.sid !== r.sid && !await run(sb.from('product_packs').update({ sid: 2000000000 - Math.floor(Math.random() * 1e6) }).eq('id', r.id))) return false;
        if (!S.refMissing && old && (old.ref || null) !== r.ref && old.ref && !await run(sb.from('product_packs').update({ ref: null }).eq('id', r.id))) return false;
      }
      for (const r of rows) {
        const body = { product_id: pid, name: r.name, sid: r.sid, outer_multiple: r.outer_multiple, available: r.available, sort: r.sort };
        if (!S.refMissing) body.ref = r.ref;
        if (!await run(r.id ? sb.from('product_packs').update(body).eq('id', r.id) : sb.from('product_packs').insert(body))) return false;
      }
      toast('Product saved', true); return true;
    },
    id ? () => run(sb.from('products').delete().eq('id', id), 'Product deleted') : null);
}
function editLogin(uid) {
  const u = S.profiles.find(x => x.id === uid);
  openDialog(u.approved ? 'Edit login' : 'Approve login',
    `<p style="margin:0"><b>${esc(u.full_name || u.email)}</b><br><span class="mono muted">${esc(u.email)}</span>${u.business ? `<br>Business they gave: ${esc(u.business)}` : ''}</p>
    <label class="f">Role<select name="role" id="f-role" onchange="document.getElementById('custpick').hidden = this.value!=='customer'"><option value="customer" ${!['admin', 'manager', 'receiver'].includes(u.role) ? 'selected' : ''}>Customer: orders for one business</option><option value="receiver" ${u.role === 'receiver' ? 'selected' : ''}>Receiver: checks deliveries and marks orders received</option><option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager: orders, customers and products, but not Suppliers, Emails or Logins</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin: full access, like you</option></select></label>
    <label class="f" id="custpick" ${['admin', 'manager', 'receiver'].includes(u.role) ? 'hidden' : ''}>Customer this login orders for<select name="customer_id" id="f-customer_id"><option value="">Choose a customer…</option>${S.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === u.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f">Access<select name="approved" id="f-approved"><option value="1" selected>Allowed to sign in</option><option value="0">Blocked</option></select></label>`,
    f => {
      const role = f.get('role'), customer_id = f.get('customer_id') || null, approved = f.get('approved') === '1';
      if (role === 'customer' && approved && !customer_id) { toast('Choose which customer this login orders for.'); return false; }
      return run(sb.from('profiles').update({ role, customer_id: role === 'customer' ? customer_id : null, approved }).eq('id', uid), 'Login saved');
    });
}

start();
