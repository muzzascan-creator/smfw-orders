// SMFW Orders: one page app for admins (SMFW staff) and customers.
// Data and logins live in Supabase; access rules in supabase/schema.sql decide what each person can see.

const cfg = window.SMFW_CONFIG || {};
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const S = { customers: [], suppliers: [], products: [], orders: [], profiles: [] };
let session = null, profile = null, view = null, draft = null, listFilter = 'all', search = '', authMode = 'signin', authMsg = '', ordersChannel = null;

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return new Date(+y, m - 1, +dd).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = t => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const bySort = (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || byName(a, b);
const orderNo = n => n == null ? '' : 'SO-' + String(n).padStart(4, '0');
const isAdmin = () => profile?.role === 'admin' && profile?.approved;
const custOf = id => S.customers.find(c => c.id === id);
const prodOf = id => S.products.find(p => p.id === id);
const packOf = id => { for (const p of S.products) { const k = (p.product_packs || []).find(x => x.id === id); if (k) return { p, k }; } return null; };
const STATUS = { draft: 'Draft', submitted: 'Sent', complete: 'Complete' };

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2800); }
function friendly(err) {
  if (!err) return 'Something went wrong.';
  const m = err.message || String(err);
  if (err.code === '23505') {
    if (/sid/i.test(m)) return 'That SID is already used by another pack type.';
    if (/cid/i.test(m)) return 'That CID is already used by another customer.';
    if (/product_id, name|product_packs_product_id_name/i.test(m)) return 'A pack type is listed twice on this product.';
    return 'That value is already in use.';
  }
  if (err.code === '23503') return 'This is still used elsewhere, so it can’t be deleted.';
  if (err.code === '42501' || /row-level security/i.test(m)) return 'You don’t have permission to do that.';
  return m;
}
async function run(promise, okMsg) { const { data, error } = await promise; if (error) { toast(friendly(error)); return null; } if (okMsg) toast(okMsg); return data ?? true; }

// ---------- data ----------
async function loadAll() {
  const prods = sb.from('products').select('id,supplier_id,code,name,section,sort,active,product_packs(id,name,sid,outer_multiple,available,sort)');
  const orders = sb.from('orders').select('*').order('number', { ascending: false });
  if (isAdmin()) {
    const [c, s, p, o, u] = await Promise.all([sb.from('customers').select('*'), sb.from('suppliers').select('*'), prods, orders, sb.from('profiles').select('*').order('created_at')]);
    for (const r of [c, s, p, o, u]) if (r.error) toast(friendly(r.error));
    S.customers = c.data || []; S.suppliers = s.data || []; S.products = p.data || []; S.orders = o.data || []; S.profiles = u.data || [];
  } else {
    const [c, p, o] = await Promise.all([sb.from('customers').select('id,cid,name'), prods.eq('active', true), orders]);
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
      toast(`New order ${orderNo(after.number)} from ${custOf(after.customer_id)?.name || 'a customer'}`);
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
  if (!profile || !profile.approved || (!isAdmin() && !profile.customer_id)) { $('#top').hidden = true; return renderPending(); }
  $('#top').hidden = false;
  $('#whoami').textContent = (profile.full_name || profile.email) + (isAdmin() ? ' · Admin' : '');
  await loadAll();
  listenForOrders();
  if (!view) view = isAdmin() ? 'inbox' : 'mine';
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
  app.innerHTML = `<div class="auth card">${forms[authMode]}</div>`;
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
      if (!error) { authMode = 'signin'; authMsg = ''; toast('Password saved'); return enter(); }
    }
    btn.disabled = false;
    if (error) { authMsg = '!' + (error.message === 'Invalid login credentials' ? 'That email and password don’t match an account.' : error.message); renderAuth(); }
  };
}
function renderPending() {
  $('#app').innerHTML = `<div class="auth card"><h1>Almost there</h1>
    <p>Thanks${profile?.full_name ? ', ' + esc(profile.full_name) : ''}. Your account is waiting for SMFW to link it to your business. You’ll be able to order as soon as that’s done.</p>
    <p class="muted">Signed in as ${esc(session.user.email)}</p>
    <div class="row"><button id="recheck" class="primary">Check again</button><button id="so2">Sign out</button></div></div>`;
  $('#recheck').onclick = () => enter();
  $('#so2').onclick = () => sb.auth.signOut();
}

// ---------- navigation ----------
function navItems() {
  return isAdmin()
    ? [['inbox', 'Inbox'], ['orders', 'Orders'], ['entry', 'New order'], ['customers', 'Customers'], ['products', 'Products'], ['suppliers', 'Suppliers'], ['users', 'Logins']]
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
  const views = { inbox: viewInbox, orders: viewOrders, mine: viewMine, entry: viewEntry, customers: viewCustomers, products: viewProducts, suppliers: viewSuppliers, users: viewUsers };
  if (!views[view] || (!isAdmin() && !['mine', 'entry'].includes(view))) view = isAdmin() ? 'inbox' : 'mine';
  if (view === 'entry' && !draft) draft = blankOrder();
  $('#app').innerHTML = views[view]();
  if (view === 'entry') wireEntry();
  if (view === 'orders') wireOrderSearch();
}

// ---------- order lists ----------
function orderRow(o, opts = {}) {
  const c = custOf(o.customer_id);
  return `<tr>
    <td class="mono">${esc(orderNo(o.number))}</td>
    ${opts.customer === false ? '' : `<td>${c?.cid != null ? `<span class="mono muted">${esc(c.cid)}</span> ` : ''}${esc(c?.name || 'Unknown customer')}</td>`}
    <td>${esc(fmtDate(o.required_date))}</td>
    ${opts.sent ? `<td>${esc(fmtWhen(o.submitted_at))}</td>` : ''}
    ${opts.source ? `<td>${o.source === 'customer' ? 'Customer' : 'SMFW'}</td>` : ''}
    <td class="num">${(o.lines || []).length}</td>
    <td><span class="pill ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></td>
    <td class="num"><button class="ghost" onclick="openOrder('${o.id}')">Open</button></td></tr>`;
}
function viewInbox() {
  const os = S.orders.filter(o => o.status === 'submitted').sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
  return `<h1>Inbox</h1><p class="sub">Orders customers have sent that still need processing. Open one to check it and mark it complete.</p>
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>Sent</th><th>From</th><th class="num">Lines</th><th>Status</th><th></th></tr></thead><tbody>${os.map(o => orderRow(o, { sent: true, source: true })).join('')}</tbody></table></div>`
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
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Required</th><th>From</th><th class="num">Lines</th><th>Status</th><th></th></tr></thead><tbody>${os.map(o => orderRow(o, { source: true })).join('')}</tbody></table></div>`
      : `<div class="card empty">${S.orders.length ? 'No orders match this filter.' : 'No orders yet.'}</div>`}`;
}
function wireOrderSearch() { const i = $('#osearch'); if (!i) return; i.oninput = () => { search = i.value; render(); const j = $('#osearch'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; }
function viewMine() {
  const os = S.orders;
  const me = custOf(profile.customer_id);
  return `<div class="row spread"><div><h1>My orders</h1><p class="sub">${esc(me?.name || '')}${me?.cid != null ? ` · CID ${esc(me.cid)}` : ''}</p></div><button class="primary" onclick="go('entry')">New order</button></div>
    ${os.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Required</th><th class="num">Lines</th><th>Status</th><th></th></tr></thead><tbody>${os.map(o => orderRow(o, { customer: false })).join('')}</tbody></table></div>`
      : `<div class="card empty">You haven’t placed any orders yet. Press <b>New order</b> to start one.</div>`}`;
}
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  draft = { id, number: o.number, customer_id: o.customer_id, order_date: o.order_date, required_date: o.required_date || '', special: o.special || '', status: o.status, source: o.source, submitted_at: o.submitted_at, qty: {} };
  (o.lines || []).forEach(l => { if (l.pack_id) draft.qty[l.pack_id] = l.qty; });
  draft.missing = (o.lines || []).filter(l => !packOf(l.pack_id));
  go('entry', false);
}

// ---------- order entry ----------
function blankOrder() { return { id: null, number: null, customer_id: isAdmin() ? '' : profile?.customer_id, order_date: today(), required_date: '', special: '', status: 'draft', source: isAdmin() ? 'admin' : 'customer', qty: {}, missing: [] }; }
const outerOf = k => Number(k.outer_multiple) || 1;
const offMultiple = (q, k) => +q > 0 && +q % outerOf(k) !== 0;
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
      return `<td class="q"><input inputmode="numeric" ${dis} aria-label="${esc(p.name)}, ${esc(pk)}" title="SID ${esc(k.sid)}${outerOf(k) > 1 ? ' · order in multiples of ' + outerOf(k) : ''}" data-outer="${outerOf(k)}" data-k="${k.id}" value="${esc(q || '')}" class="${q ? 'has' : ''} ${offMultiple(q, k) ? 'off' : ''}"></td>`;
    }).join('')}</tr>`).join('')}
  </tbody></table></div>`).join('');
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
    blocks = S.suppliers.slice().sort(byName).map(s => {
      const secs = sectionsFor(S.products.filter(p => p.supplier_id === s.id)); if (!secs.length) return '';
      return `<section class="supplier-block"><div class="supplier-head"><h2>${esc(s.name)}</h2><span>${esc(s.cutoff || '')}</span></div><div class="sections">${gridHtml(secs, dis)}</div></section>`;
    }).join('');
  } else {
    const secs = sectionsFor(S.products);
    blocks = secs.length ? `<section class="supplier-block"><div class="supplier-head"><h2>Order form</h2><span>Fill in the boxes you need. Grey boxes aren’t available.</span></div><div class="sections">${gridHtml(secs, dis)}</div></section>` : '';
  }
  const custField = admin
    ? `<label class="f">Customer<select id="e-cust" ${dis}><option value="">Choose a customer…</option>${S.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === d.customer_id ? 'selected' : ''}>${c.cid != null ? esc(c.cid) + ' · ' : ''}${esc(c.name)}</option>`).join('')}</select></label>
       <label class="f">Contact phone<input id="e-phone" disabled value="${esc(custOf(d.customer_id)?.phone || '')}"></label>`
    : `<label class="f">Customer<input disabled value="${esc(custOf(d.customer_id)?.name || '')}"></label>`;
  const note = d.status === 'complete' ? (admin ? 'This order is complete. Reopen it to make changes.' : 'SMFW has processed this order.')
    : d.status === 'submitted' ? (admin ? `Sent by the customer ${esc(fmtWhen(d.submitted_at))}. Check it, make any changes, then mark it complete.` : 'You’ve sent this order to SMFW. Contact SMFW if anything needs to change.')
    : 'Fill in the quantities needed. Empty boxes are ignored.';
  const missing = d.missing?.length ? `<div class="banner">${d.missing.length} line${d.missing.length > 1 ? 's refer' : ' refers'} to a pack type that no longer exists: ${d.missing.map(l => esc(`${l.product_name} (${l.pack_name}) × ${l.qty}`)).join(', ')}. Saving will drop ${d.missing.length > 1 ? 'them' : 'it'}.</div>` : '';
  return `<div class="row spread"><div><h1>${d.id ? 'Order ' + esc(orderNo(d.number)) : 'New order'}</h1><p class="sub">${note}</p></div>
      <span class="pill ${d.status}">${STATUS[d.status]}</span></div>${missing}
    <div class="entry"><div>
      <div class="card grid g2">
        ${custField}
        <label class="f">Today’s date<input type="date" id="e-date" ${dis} value="${esc(d.order_date)}"></label>
        <label class="f">Day / date required<input type="date" id="e-req" ${dis} value="${esc(d.required_date)}"></label>
        <label class="f" style="grid-column:1/-1">Special requirements<textarea id="e-special" ${dis}>${esc(d.special)}</textarea></label>
      </div>
      <div class="row" style="margin-top:16px"><input class="search" id="e-find" placeholder="Find a product by name or code"></div>
      ${blocks || '<div class="card empty" style="margin-top:16px">No products are set up yet.</div>'}
    </div>
    <aside class="card summary" id="summary">${summaryHtml()}</aside></div>`;
}
function draftLines() {
  return Object.entries(draft.qty).filter(([, q]) => +q > 0).map(([packId, q]) => {
    const f = packOf(packId); if (!f || !f.k.available) return null;
    return { pack_id: f.k.id, product_id: f.p.id, sid: f.k.sid, code: f.p.code || '', product_name: f.p.name, pack_name: f.k.name, outer: outerOf(f.k), qty: +q };
  }).filter(Boolean);
}
function summaryHtml() {
  const d = draft, admin = isAdmin(), lines = draftLines();
  const groups = {};
  lines.forEach(l => { const p = prodOf(l.product_id); const g = admin ? (S.suppliers.find(s => s.id === p?.supplier_id)?.name || 'Other') : (p?.section || 'Other'); (groups[g] ||= []).push(l); });
  const body = Object.entries(groups).map(([g, ls]) => `<div class="sumsup">${esc(g)}</div><ul class="sumlist">${ls.map(l => `<li><span>${esc(l.product_name)} <span class="muted">· ${esc(l.pack_name)}</span></span><b class="mono"${l.qty % l.outer ? ` style="color:var(--danger)" title="Not a multiple of ${l.outer}"` : ''}>${l.qty}</b></li>`).join('')}</ul>`).join('');
  const total = lines.reduce((a, l) => a + l.qty, 0);
  const offs = lines.filter(l => l.qty % l.outer);
  let btns = '';
  if (admin) {
    if (d.status === 'complete') btns = `<button onclick="reopenOrder()">Reopen to edit</button>`;
    else btns = `<button onclick="saveOrder('${d.status === 'submitted' ? 'submitted' : 'draft'}')">${d.status === 'submitted' ? 'Save changes' : 'Save draft'}</button><button class="primary" onclick="saveOrder('complete')">Mark complete</button>`;
  } else if (d.status === 'draft') btns = `<button onclick="saveOrder('draft')">Save draft</button><button class="primary" onclick="saveOrder('submitted')">Send order</button>`;
  const del = d.id && (admin || d.status === 'draft') ? `<div class="row" style="margin-top:8px"><button class="danger" onclick="deleteOrder(this)">Delete order</button></div>` : '';
  return `<h2>Order summary</h2>
    <p class="muted" style="margin:4px 0 0">${esc(custOf(d.customer_id)?.name || 'No customer chosen')}${d.required_date ? ' · needed ' + esc(fmtDate(d.required_date)) : ''}</p>
    ${lines.length ? body + `<p style="margin:12px 0 0"><b>${lines.length}</b> line${lines.length > 1 ? 's' : ''} · <b>${total}</b> in total</p>` + (offs.length ? `<p class="err" style="margin:8px 0 0">${offs.length} line${offs.length > 1 ? 's aren’t' : ' isn’t'} a multiple of the pack’s outer. Check the red quantities.</p>` : '') : '<p class="muted">No quantities entered yet.</p>'}
    <div class="row" style="margin-top:16px">${btns}</div>${del}`;
}
function wireEntry() {
  const sync = () => { $('#summary').innerHTML = summaryHtml(); };
  $('#e-cust')?.addEventListener('change', e => { draft.customer_id = e.target.value; $('#e-phone').value = custOf(draft.customer_id)?.phone || ''; sync(); });
  $('#e-date')?.addEventListener('change', e => draft.order_date = e.target.value);
  $('#e-req')?.addEventListener('change', e => { draft.required_date = e.target.value; sync(); });
  $('#e-special')?.addEventListener('input', e => draft.special = e.target.value);
  document.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
    const v = inp.value.replace(/[^\d]/g, ''); if (v !== inp.value) inp.value = v;
    if (+v > 0) draft.qty[inp.dataset.k] = +v; else delete draft.qty[inp.dataset.k];
    inp.classList.toggle('has', +v > 0); inp.classList.toggle('off', +v > 0 && +v % (+inp.dataset.outer || 1) !== 0); sync();
  }));
  $('#e-find')?.addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('.sec tbody tr').forEach(tr => tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q)); });
}
let saving = false;
async function saveOrder(status) {
  if (saving) return;
  const lines = draftLines();
  if (status !== 'draft') {
    if (!draft.customer_id) return toast('Choose a customer first.');
    if (!lines.length) return toast('Enter at least one quantity first.');
    if (!draft.required_date) return toast('Add the day/date required first.');
  } else if (!draft.customer_id) return toast('Choose a customer first.');
  const row = { customer_id: draft.customer_id, order_date: draft.order_date || today(), required_date: draft.required_date || null, special: draft.special || null, status, lines };
  saving = true;
  const q = draft.id ? sb.from('orders').update(row).eq('id', draft.id).select().single() : sb.from('orders').insert({ ...row, source: isAdmin() ? 'admin' : 'customer' }).select().single();
  const { data, error } = await q;
  saving = false;
  if (error) return toast(friendly(error));
  if (!data) return toast('This order can no longer be changed.');
  const msg = status === 'complete' ? `Order ${orderNo(data.number)} completed` : status === 'submitted' ? (isAdmin() ? `Order ${orderNo(data.number)} saved` : `Order ${orderNo(data.number)} sent to SMFW`) : `Draft ${orderNo(data.number)} saved`;
  toast(msg);
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
  return `<div class="row spread"><div><h1>Customers</h1><p class="sub">The businesses who order from you. Link a login to a customer under <b>Logins</b>.</p></div><button class="primary" onclick="editCustomer()">Add customer</button></div>
  ${cs.length ? `<div class="tablewrap"><table><thead><tr><th class="num">CID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th class="num">Logins</th><th class="num">Orders</th><th></th></tr></thead><tbody>
    ${cs.map(c => `<tr><td class="num mono">${esc(c.cid)}</td><td><b>${esc(c.name)}</b>${c.notes ? `<div class="muted" style="font-size:12px">${esc(c.notes)}</div>` : ''}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td class="num">${S.profiles.filter(u => u.customer_id === c.id).length}</td><td class="num">${S.orders.filter(o => o.customer_id === c.id).length}</td><td class="num"><button class="ghost" onclick="editCustomer('${c.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No customers yet.</div>`}`;
}
function viewSuppliers() {
  const ss = S.suppliers.slice().sort(byName);
  return `<div class="row spread"><div><h1>Suppliers</h1><p class="sub">Who you buy from. Customers never see this list.</p></div><button class="primary" onclick="editSupplier()">Add supplier</button></div>
  ${ss.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Order emails</th><th>Cut-off</th><th class="num">Products</th><th></th></tr></thead><tbody>
    ${ss.map(s => `<tr><td><b>${esc(s.name)}</b>${s.notes ? `<div class="muted" style="font-size:12px">${esc(s.notes)}</div>` : ''}</td><td class="mono">${(s.emails || []).map(esc).join('<br>')}</td><td>${esc(s.cutoff)}</td><td class="num">${S.products.filter(p => p.supplier_id === s.id).length}</td><td class="num"><button class="ghost" onclick="editSupplier('${s.id}')">Edit</button></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty">No suppliers yet.</div>`}`;
}
function viewProducts() {
  const blocks = S.suppliers.slice().sort(byName).map(s => {
    const ps = S.products.filter(p => p.supplier_id === s.id).sort(bySort); if (!ps.length) return '';
    return `<h2 style="margin:20px 0 8px">${esc(s.name)}</h2><div class="tablewrap"><table><thead><tr><th>Code</th><th>Product</th><th>Section</th><th>Pack types · SID · outer</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr${p.active === false ? ' class="muted"' : ''}><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}${p.active === false ? ' <span class="pill">Hidden</span>' : ''}</td><td>${esc(p.section)}</td>
      <td>${(p.product_packs || []).map(k => `<div><span class="mono muted">SID ${esc(k.sid)}</span> ${esc(k.name)} <span class="mono muted">· outer ${outerOf(k)}</span>${k.available ? '' : ' <span class="pill">Not available</span>'}</div>`).join('')}</td>
      <td class="num"><button class="ghost" onclick="editProduct('${p.id}')">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }).join('');
  return `<div class="row spread"><div><h1>Products</h1><p class="sub">Grouped by supplier, in the same sections as their order forms.</p></div>${S.suppliers.length ? `<button class="primary" onclick="editProduct()">Add product</button>` : ''}</div>
  ${blocks || `<div class="card empty">No products yet.${S.suppliers.length ? '' : ' Add a supplier first.'}</div>`}`;
}
function viewUsers() {
  const us = S.profiles.slice().sort((a, b) => (a.approved - b.approved) || (a.email || '').localeCompare(b.email || ''));
  const waiting = us.filter(u => !u.approved).length;
  const link = location.origin + location.pathname;
  return `<h1>Logins</h1><p class="sub">Customers create their own account at <span class="mono">${esc(link)}</span>. Link each new account to its customer so they can start ordering.${waiting ? ` <b>${waiting} waiting.</b>` : ''}</p>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Business they gave</th><th>Role</th><th>Linked customer</th><th>Access</th><th></th></tr></thead><tbody>
  ${us.map(u => `<tr><td>${esc(u.full_name)}</td><td class="mono">${esc(u.email)}</td><td>${esc(u.business || '')}</td><td>${u.role === 'admin' ? 'Admin' : 'Customer'}</td>
    <td>${u.role === 'admin' ? '<span class="muted">All customers</span>' : esc(custOf(u.customer_id)?.name || '')}</td>
    <td>${u.approved ? '<span class="pill complete">Active</span>' : '<span class="pill draft">Waiting</span>'}</td>
    <td class="num">${u.id === profile.id ? '<span class="muted">You</span>' : `<button class="ghost" onclick="editLogin('${u.id}')">${u.approved ? 'Edit' : 'Approve'}</button>`}</td></tr>`).join('')}
  </tbody></table></div>`;
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
     <div class="grid g2">${fld('contact', 'Contact person', c.contact)}${fld('phone', 'Contact phone', c.phone)}</div>${fld('email', 'Email', c.email, 'email')}
     <label class="f">Notes<textarea name="notes" id="f-notes">${esc(c.notes)}</textarea></label>`,
    f => {
      const row = { cid: Number(f.get('cid')), name: f.get('name').trim(), contact: f.get('contact').trim(), phone: f.get('phone').trim(), email: f.get('email').trim(), notes: f.get('notes').trim() };
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
    `<label class="f">Order email addresses (one per line)<textarea name="emails" id="f-emails">${esc((s.emails || []).join('\n'))}</textarea></label>` +
    fld('cutoff', 'Order cut-off', s.cutoff, 'text', 'placeholder="e.g. Orders by 9am for same-day processing"') +
    `<label class="f">Notes<textarea name="notes" id="f-notes">${esc(s.notes)}</textarea></label>`,
    f => {
      const emails = f.get('emails').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
      const bad = emails.find(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)); if (bad) { toast('Check this email address: ' + bad); return false; }
      const row = { name: f.get('name').trim(), emails, cutoff: f.get('cutoff').trim(), notes: f.get('notes').trim() };
      return run(id ? sb.from('suppliers').update(row).eq('id', id) : sb.from('suppliers').insert(row), 'Supplier saved');
    },
    id && !S.products.some(p => p.supplier_id === id) ? () => run(sb.from('suppliers').delete().eq('id', id), 'Supplier deleted') : null);
}
function packRow(k = {}) {
  const key = k.id || 'new-' + Math.random().toString(36).slice(2, 8);
  return `<div class="packrow" data-row="${esc(key)}"><input name="psid" type="number" min="1" step="1" placeholder="SID" aria-label="SID" value="${esc(k.sid ?? '')}">
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
    <label class="f">Section on the form<input name="section" id="f-section" list="seclist" value="${esc(p.section)}"><datalist id="seclist">${secs.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="grid" style="gap:6px"><div class="packrow packhead"><span>SID</span><span>Pack type (match the form’s column heading)</span><span>Outer</span><span>Availability</span><span></span></div>
      <div class="grid" style="gap:6px" id="packrows">${packs.map(packRow).join('')}</div>
      <div><button type="button" class="ghost" onclick="addPackRow()">+ Add pack type</button></div></div>
    <div class="grid g2">${fld('sort', 'Position on the form', p.sort ?? '', 'number')}
    <label class="f">Show on order forms<select name="active" id="f-active"><option value="1" ${p.active !== false ? 'selected' : ''}>Yes</option><option value="0" ${p.active === false ? 'selected' : ''}>No, hide it</option></select></label></div>`,
    async f => {
      const name = f.get('name').trim(); if (!name) { toast('Enter a product name.'); return false; }
      const names = f.getAll('pname').map(x => x.trim()), sids = f.getAll('psid'), outs = f.getAll('pouter'), avail = f.getAll('pavail'), pids = f.getAll('pid');
      const rows = []; const others = S.products.filter(x => x.id !== id).flatMap(x => (x.product_packs || []).map(k => ({ sid: k.sid, label: `${x.name} (${k.name})` })));
      for (let i = 0; i < names.length; i++) {
        if (!names[i]) continue;
        const sid = Number(sids[i]), outer = Number(outs[i]);
        if (rows.some(r => r.name === names[i])) { toast(`Pack type "${names[i]}" is listed twice.`); return false; }
        if (!Number.isInteger(sid) || sid < 1) { toast(`Give "${names[i]}" a SID that is a whole number above 0.`); return false; }
        if (rows.some(r => r.sid === sid)) { toast(`SID ${sid} is used twice on this product.`); return false; }
        const clash = others.find(o => o.sid === sid); if (clash) { toast(`SID ${sid} is already used by ${clash.label}.`); return false; }
        if (!Number.isInteger(outer) || outer < 1) { toast(`Outer multiple for "${names[i]}" must be a whole number of 1 or more.`); return false; }
        rows.push({ id: pids[i] || undefined, name: names[i], sid, outer_multiple: outer, available: avail[i] === '1', sort: rows.length });
      }
      if (!rows.length) { toast('Add at least one pack type.'); return false; }
      const prow = { supplier_id: f.get('supplier_id'), code: f.get('code').trim(), name, section: f.get('section').trim(), sort: f.get('sort') === '' ? 999 : +f.get('sort'), active: f.get('active') === '1' };
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
      }
      for (const r of rows) {
        const body = { product_id: pid, name: r.name, sid: r.sid, outer_multiple: r.outer_multiple, available: r.available, sort: r.sort };
        if (!await run(r.id ? sb.from('product_packs').update(body).eq('id', r.id) : sb.from('product_packs').insert(body))) return false;
      }
      toast('Product saved'); return true;
    },
    id ? () => run(sb.from('products').delete().eq('id', id), 'Product deleted') : null);
}
function editLogin(uid) {
  const u = S.profiles.find(x => x.id === uid);
  openDialog(u.approved ? 'Edit login' : 'Approve login',
    `<p style="margin:0"><b>${esc(u.full_name || u.email)}</b><br><span class="mono muted">${esc(u.email)}</span>${u.business ? `<br>Business they gave: ${esc(u.business)}` : ''}</p>
    <label class="f">Role<select name="role" id="f-role" onchange="document.getElementById('custpick').hidden = this.value==='admin'"><option value="customer" ${u.role !== 'admin' ? 'selected' : ''}>Customer: orders for one business</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin: full access, like you</option></select></label>
    <label class="f" id="custpick" ${u.role === 'admin' ? 'hidden' : ''}>Customer this login orders for<select name="customer_id" id="f-customer_id"><option value="">Choose a customer…</option>${S.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === u.customer_id ? 'selected' : ''}>${esc(c.cid)} · ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f">Access<select name="approved" id="f-approved"><option value="1" ${u.approved || !u.customer_id ? 'selected' : ''}>Allowed to sign in and order</option><option value="0" ${!u.approved && u.customer_id ? 'selected' : ''}>Blocked</option></select></label>`,
    f => {
      const role = f.get('role'), customer_id = f.get('customer_id') || null, approved = f.get('approved') === '1';
      if (role === 'customer' && approved && !customer_id) { toast('Choose which customer this login orders for.'); return false; }
      return run(sb.from('profiles').update({ role, customer_id: role === 'admin' ? null : customer_id, approved }).eq('id', uid), 'Login saved');
    });
}

start();
