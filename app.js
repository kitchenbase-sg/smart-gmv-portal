/* Smart GMV — licensee portal. One tenant, its own brands, yesterday and back.
   Everything here is scoped by the server: a tenant token can only reach
   /api/tenant/*, every read is filtered to the tenant's brands, and photos are
   served through signed, expiring links the server minted for those rows. A
   correction is a PHOTO, never a number. */
const CONFIG = (() => {
  const q = new URLSearchParams(location.search);
  const local = (q.get('api') || '').match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/) ? q.get('api') : '';
  return { apiBase: local || 'https://smart-gmv-server-production.up.railway.app' };
})();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v === '' || v === null || v === undefined) ? '—' : '$' + Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CH = { grab: 'GrabFood', fp: 'foodpanda', others: 'Others', catering: 'Catering' };
const CH_LOGO = { grab: 'icons/grab-wordmark.svg', fp: 'icons/foodpanda-wordmark.svg' };
const chanLabel = (ch, txt) => (CH_LOGO[ch] ? `<img class="ch-logo" src="${CH_LOGO[ch]}" alt="${esc(CH[ch])}">` : esc(txt || CH[ch] || ch));

const state = { token: '', me: null, date: '', yesterday: '', days: 45, records: [], loading: false };
try { state.token = sessionStorage.getItem('smartgmv.tenant') || ''; } catch (e) {}
function setToken(t) { state.token = t; try { t ? sessionStorage.setItem('smartgmv.tenant', t) : sessionStorage.removeItem('smartgmv.tenant'); } catch (e) {} }

async function api(path, o = {}) {
  o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
  if (state.token) o.headers.Authorization = `Bearer ${state.token}`;
  const r = await fetch(`${CONFIG.apiBase}${path}`, o);
  if (r.status === 401 && state.token) { setToken(''); show('view-login'); toast('Session expired — sign in again'); throw new Error('session expired'); }
  return r;
}
function show(id) { document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== id)); window.scrollTo(0, 0); }
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200); }
const photoSrc = (u) => (u ? `${CONFIG.apiBase}${u}` : '');
const fmtDay = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const shiftDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };

/* ---------- login ---------- */
$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('login-btn'); btn.disabled = true; btn.textContent = 'Signing in…'; $('login-err').classList.add('hidden');
  try {
    const r = await fetch(`${CONFIG.apiBase}/api/tenant/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('login-email').value.trim(), password: $('login-pw').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    setToken(d.token); state.me = { email: $('login-email').value.trim(), account: d.account, brands: d.brands };
    $('login-pw').value = '';
    enter();
  } catch (err) {
    $('login-err').textContent = err.message; $('login-err').classList.remove('hidden');
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
};
$('btn-logout').onclick = () => { setToken(''); state.me = null; show('view-login'); };

async function boot() {
  if (!state.token) { show('view-login'); return; }
  try {
    const r = await api('/api/tenant/me'); if (!r.ok) throw new Error();
    state.me = await r.json(); enter();
  } catch (e) { setToken(''); show('view-login'); }
}

/* ---------- day view ---------- */
function enter() {
  $('acct-name').textContent = state.me.account || state.me.email;
  $('acct-brands').textContent = (state.me.brands || []).join(' · ');
  // Bound the calendar before the first read lands: yesterday by the phone's
  // clock, 45 days back. The server's answer replaces both on the next render,
  // so an out-of-range day is greyed out in the picker, not rejected after a tap.
  const guess = shiftDay(new Date().toISOString().slice(0, 10), -1);
  $('day-pick').max = guess; $('day-pick').min = shiftDay(guess, -(state.days - 1));
  show('view-day');
  loadDay('');
}
async function loadDay(date) {
  state.loading = true; renderDay();
  try {
    const r = await api(`/api/tenant/records${date ? `?date=${date}` : ''}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    state.date = d.date; state.yesterday = d.yesterday; state.days = d.historyDays || 45; state.records = d.records || [];
    state.error = null;
  } catch (e) { state.error = e.message; }
  state.loading = false; renderDay();
}

const minDay = () => shiftDay(state.yesterday, -(state.days - 1));
$('day-prev').onclick = () => state.date && state.date > minDay() && loadDay(shiftDay(state.date, -1));
$('day-next').onclick = () => state.date && state.date < state.yesterday && loadDay(shiftDay(state.date, 1));
$('day-pick').onchange = (e) => {
  const v = e.target.value; if (!v) return;
  const lo = minDay(), hi = state.yesterday;
  loadDay(v < lo ? lo : v > hi ? hi : v);       // browsers that ignore min/max still land inside the window
};

function renderDay() {
  if (state.date) {
    $('day-label').textContent = fmtDay(state.date) + (state.date === state.yesterday ? ' · yesterday' : '');
    $('day-pick').value = state.date; $('day-pick').max = state.yesterday; $('day-pick').min = minDay();
    $('day-next').disabled = state.date >= state.yesterday;
    $('day-prev').disabled = state.date <= minDay();
  }
  const note = $('day-note');
  note.textContent = state.loading ? 'Loading…' : state.error ? `⚠ ${state.error}`
    : state.date === state.yesterday ? 'Yesterday can be edited until midnight tonight: upload a fresh screenshot of the platform\'s summary screen.'
    : 'Past days are read-only. Only yesterday\'s record can be edited.';
  const list = $('day-list');
  if (state.loading) { list.innerHTML = '<div class="card empty"><span class="spinner"></span></div>'; return; }
  if (!state.records.length) { list.innerHTML = '<div class="card empty">No record for your kitchens on this day.</div>'; return; }
  list.innerHTML = state.records.map((r) => {
    const chans = Object.entries(r.channels || {});
    const pend = (r.amendments || []).filter((a) => a.status === 'pending');
    return `<div class="card rec">
      <div class="rec-h"><div><b>${esc(r.brand)}</b><span class="k">${esc(r.kitchen)}</span></div>
        <div class="rec-meta">${r.status === 'Operated' ? `recorded ${esc(r.recordedAt)}` : `<span class="pill muted">${esc(r.status)}</span>`}${r.edited ? ' <span class="pill amber">corrected</span>' : ''}</div></div>
      ${r.status !== 'Operated' ? '' : chans.length ? chans.map(([ch, c]) => `
        <div class="chan">
          <div class="chan-l">${c.photoUrl ? `<img class="thumb" src="${esc(photoSrc(c.photoUrl))}" data-full="${esc(photoSrc(c.photoUrl))}" alt="">` : '<div class="thumb none">no photo</div>'}</div>
          <div class="chan-m"><div class="chan-name">${chanLabel(ch, c.label)}</div>
            ${c.noSales ? '<div class="fig muted">no sales declared</div>' : `<div class="fig"><b>${esc(String(c.orders ?? '—'))}</b> orders · <b>${money(c.gmv)}</b></div>`}
            ${(c.extras || []).length ? `<div class="fine">+ ${c.extras.length} order${c.extras.length > 1 ? 's' : ''} outside the summary</div>` : ''}
            ${(r.amendments || []).filter((a) => a.channel === ch).map((a) => `<div class="req-line ${esc(a.status)}">${statusLabel(a)}${a.status === 'pending' ? ` <button class="link" data-withdraw="${esc(a.id)}">withdraw</button>` : ''}</div>`).join('')}
          </div>
          <div class="chan-r">${r.amendable && (ch === 'grab' || ch === 'fp') && !pend.some((a) => a.channel === ch)
            ? `<button class="btn-ghost" data-amend="${esc(r.recordId)}" data-ch="${esc(ch)}" data-brand="${esc(r.brand)}">Edit</button>` : ''}</div>
        </div>`).join('') : '<div class="fine">Recorded with no platform figures.</div>'}
    </div>`;
  }).join('');
  list.querySelectorAll('.thumb[data-full]').forEach((im) => im.onclick = () => openViewer(im.dataset.full));
  list.querySelectorAll('[data-amend]').forEach((b) => b.onclick = () => openAmend(b.dataset.amend, b.dataset.ch, b.dataset.brand));
  list.querySelectorAll('[data-withdraw]').forEach((b) => b.onclick = () => withdraw(b.dataset.withdraw));
}
function statusLabel(a) {
  return a.status === 'pending' ? '⏳ correction waiting for review'
    : a.status === 'approved' ? `✓ correction approved${a.decidedAt ? ' · ' + esc(a.decidedAt) : ''}`
    : a.status === 'rejected' ? `✗ correction rejected${a.reason ? ' — ' + esc(a.reason) : ''}`
    : a.status === 'withdrawn' ? '↩ correction withdrawn' : esc(a.status);
}

/* ---------- photo viewer ---------- */
function openViewer(src) { $('viewer-img').src = src; $('viewer').classList.remove('hidden'); }
$('viewer-close').onclick = () => { $('viewer').classList.add('hidden'); $('viewer-img').src = ''; };
$('viewer').onclick = (e) => { if (e.target === $('viewer')) $('viewer-close').click(); };

/* ---------- correction sheet ---------- */
const am = { recordId: '', ch: '', dataUrl: '' };
function openAmend(recordId, ch, brand) {
  am.recordId = recordId; am.ch = ch; am.dataUrl = '';
  $('am-title').textContent = `Edit ${brand} · ${CH[ch] || ch}`;
  $('am-sub').textContent = `${fmtDay(state.date)} — upload the ${CH[ch] || ch} summary screen for that day.`;
  $('am-chan').innerHTML = ['grab', 'fp'].map((c) => `<button class="chip ${c === ch ? 'on' : ''}" data-c="${c}"><img class="ch-logo" src="${CH_LOGO[c]}" alt="${CH[c]}"></button>`).join('');
  $('am-chan').querySelectorAll('.chip').forEach((b) => b.onclick = () => { am.ch = b.dataset.c; $('am-chan').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); $('am-title').textContent = `Edit ${brand} · ${CH[am.ch]}`; });
  $('am-preview').classList.add('hidden'); $('am-preview').src = ''; $('am-drop-empty').classList.remove('hidden');
  $('am-err').classList.add('hidden'); $('am-submit').disabled = true; $('am-submit').textContent = 'Submit for review';
  $('amend-overlay').classList.remove('hidden');
}
$('am-close').onclick = () => $('amend-overlay').classList.add('hidden');
$('am-drop').onclick = () => $('am-file').click();
$('am-file').onchange = async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    am.dataUrl = await compress(f);
    $('am-preview').src = am.dataUrl; $('am-preview').classList.remove('hidden'); $('am-drop-empty').classList.add('hidden');
    $('am-submit').disabled = false;
  } catch (err) { $('am-err').textContent = 'Could not read that image — try another photo.'; $('am-err').classList.remove('hidden'); }
  e.target.value = '';
};
function compress(file, max = 1600, q = 0.85) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}
$('am-submit').onclick = async () => {
  if (!am.dataUrl) return;
  const btn = $('am-submit'); btn.disabled = true; btn.textContent = 'Uploading & reading…'; $('am-err').classList.add('hidden');
  try {
    const r = await api('/api/tenant/amend', { method: 'POST', body: JSON.stringify({ recordId: am.recordId, channel: am.ch, photo: am.dataUrl }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    $('amend-overlay').classList.add('hidden');
    toast(`Submitted ✓ — ${d.aiOrders != null ? `we read ${d.aiOrders} orders · ${money(d.aiGmv)}; ` : ''}the facility team will review it`);
    loadDay(state.date);
  } catch (err) { $('am-err').textContent = err.message; $('am-err').classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Submit for review'; }
};
async function withdraw(id) {
  if (!confirm('Withdraw this correction request?')) return;
  try {
    const r = await api(`/api/tenant/amendments/${encodeURIComponent(id)}/withdraw`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    toast('Request withdrawn'); loadDay(state.date);
  } catch (err) { toast(`⚠ ${err.message}`); }
}

/* ---------- my requests ---------- */
$('btn-requests').onclick = async () => {
  show('view-requests'); $('req-list').innerHTML = '<div class="card empty"><span class="spinner"></span></div>';
  try {
    const r = await api('/api/tenant/amendments'); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    const list = d.amendments || [];
    $('req-list').innerHTML = list.length ? list.map((a) => `<div class="card rec">
        <div class="rec-h"><div><b>${esc(a.brand)}</b><span class="k">${esc(a.kitchen)}</span></div><div class="rec-meta">${esc(a.salesDate)} · ${esc(CH[a.channel] || a.channel)}</div></div>
        <div class="req-line ${esc(a.status)}">${statusLabel(a)}</div>
        <div class="fine">submitted ${esc(a.submittedAt)}${a.aiOrders !== '' && a.aiOrders != null ? ` · we read ${esc(String(a.aiOrders))} orders · ${money(a.aiGmv)}` : ''}</div>
        ${a.photoUrl ? `<img class="thumb wide" src="${esc(photoSrc(a.photoUrl))}" alt="">` : ''}
      </div>`).join('') : '<div class="card empty">No correction requests yet.</div>';
  } catch (err) { $('req-list').innerHTML = `<div class="card empty">⚠ ${esc(err.message)}</div>`; }
};
$('req-back').onclick = () => { show('view-day'); };

boot();
