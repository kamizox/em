/* dashboard.js — Mail Tracker
 * Features: stats, filters (status/date/follow-up/sender), hot-lead, reply status,
 * link-wise clicks, recipient profile, tags, CSV export, heatmap chart,
 * domain/template analytics, weekly summary, live update (SSE) + notifications, templates.
 */

const API = '';
let ALL = [];

/* ---------- helpers ---------- */
function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms), diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' days ago';
  return d.toLocaleDateString();
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function domainOf(email) {
  const m = String(email || '').split(',')[0].trim().match(/@([\w.-]+)/);
  return m ? m[1].toLowerCase() : '';
}
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ---------- load ---------- */
async function loadStats() {
  try {
    const s = await (await fetch(`${API}/api/stats`)).json();
    document.getElementById('c-sent').textContent = s.total_sent;
    document.getElementById('c-open').textContent = s.total_opened;
    document.getElementById('c-rate').textContent = s.open_rate + '%';
    document.getElementById('c-click').textContent = s.total_clicked;
    document.getElementById('c-bounce').textContent = s.total_bounced;
    const replied = ALL.filter((e) => e.replied).length;
    document.getElementById('c-reply').textContent = replied;
  } catch (_) {}
}

async function loadEmails() {
  try {
    const data = await (await fetch(`${API}/api/emails?limit=1000`)).json();
    ALL = data.emails || [];
    fillSenders();
    render();
    loadStats();
  } catch (err) {
    document.getElementById('tbody').innerHTML =
      '<tr><td colspan="10" class="empty">Could not connect to server. Is the backend running?</td></tr>';
  }
}

function fillSenders() {
  const sel = document.getElementById('sender'), cur = sel.value;
  const owners = [...new Set(ALL.map((e) => e.owner).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All accounts</option>' + owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (owners.includes(cur)) sel.value = cur;
}

/* ---------- derived flags ---------- */
function isHot(e) { return (e.open_count || 0) >= 3; }      // 3+ opens = hot lead
function statusOf(e) {
  if (e.bounced) return { cls: 'st-bounce', txt: '⚠ Bounce' };
  if ((e.open_count || 0) > 0) return { cls: 'st-open', txt: '✓✓ Opened' };
  return { cls: 'st-sent', txt: '✓ Sent' };
}

/* ---------- emails table ---------- */
function filtered() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const f = document.getElementById('filter').value;
  const who = document.getElementById('sender').value;
  const dateF = document.getElementById('date').value;
  const fu = document.getElementById('followup').value;
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  return ALL.filter((e) => {
    if (who && e.owner !== who) return false;
    if (q && !([e.subject, e.recipient, e.owner, e.tags].some((v) => (v || '').toLowerCase().includes(q)))) return false;
    if (f === 'opened' && !(e.open_count > 0)) return false;
    if (f === 'unopened' && e.open_count > 0) return false;
    if (f === 'clicked' && !(e.click_count > 0)) return false;
    if (f === 'replied' && !e.replied) return false;
    if (f === 'noreply' && e.replied) return false;
    if (f === 'bounced' && !e.bounced) return false;
    if (dateF === 'today' && e.sent_at < startOfDay.getTime()) return false;
    if (dateF === 'week' && now - e.sent_at > 7 * dayMs) return false;
    if (dateF === 'month' && now - e.sent_at > 30 * dayMs) return false;
    if (fu) {
      // "not opened in X days" + no reply = needs follow-up
      if (e.open_count > 0 || e.replied || e.bounced) return false;
      if (now - e.sent_at < Number(fu) * dayMs) return false;
    }
    return true;
  });
}

function render() {
  const rows = filtered();
  const tb = document.getElementById('tbody');
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">No emails found.</td></tr>'; return; }

  tb.innerHTML = rows.map((e) => {
    const st = statusOf(e), opened = (e.open_count || 0) > 0;
    const hot = isHot(e) ? '<span class="badge badge-hot">🔥 Hot</span>' : '';
    const reply = e.replied ? '<span class="badge badge-reply">↩ Replied</span>' : '';
    const sched = e.scheduled ? '<span class="badge badge-sched">⏱ scheduled</span>' : '';
    const tags = (e.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
      .map((t) => `<span class="badge badge-tag" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
    return `<tr class="email-row${opened ? ' is-open' : ''}" data-id="${e.id}" data-url="${esc(gmailUrl(e))}" title="Click to open this sent email in Gmail">
      <td class="subj"><a class="gm" href="${esc(gmailUrl(e))}" target="mt-open-${e.id}">${esc(e.subject)} <span class="ext">↗</span></a> ${hot}${reply}${sched}</td>
      <td class="recip">${esc(e.owner || '—')}</td>
      <td class="recip">${esc(e.recipient || '—')}</td>
      <td class="status ${st.cls}">${st.txt}</td>
      <td class="recip">${opened ? `<b class="st-open">${fmt(e.last_open)}</b>` : '—'}</td>
      <td>${e.open_count || 0}${e.open_count_all > e.open_count ? ` <span class="badge badge-proxy">+${e.open_count_all - e.open_count} proxy</span>` : ''}</td>
      <td>${e.click_count || 0}</td>
      <td class="recip"><div class="tagcell">${tags}<button class="tagadd" data-id="${e.id}" title="Add / edit tags">+</button></div></td>
      <td class="recip">${fmt(e.sent_at)}</td>
      <td><button class="tl-btn" data-id="${e.id}" title="Timeline + details">▾</button></td>
    </tr>
    <tr class="detail" id="d-${e.id}" style="display:none"><td colspan="10"><div class="detail-inner" id="di-${e.id}">…</div></td></tr>`;
  }).join('');

  tb.querySelectorAll('.email-row').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('a, .tl-btn, .tagadd, .badge-tag')) return;
      window.open(row.dataset.url, 'mt-open-' + row.dataset.id);
    });
  });
  tb.querySelectorAll('.tl-btn').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleDetail(b.dataset.id); }));
  tb.querySelectorAll('.tagadd').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); editTags(b.dataset.id); }));
  tb.querySelectorAll('.badge-tag').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); document.getElementById('search').value = b.dataset.tag; render(); }));
}

// Gmail search link that finds exactly this email (sender account + sent folder + recipient + subject + time)
function gmailUrl(e) {
  const t = Math.floor((e.sent_at || Date.now()) / 1000);
  const parts = ['in:sent', `after:${t - 120}`, `before:${t + 600}`];
  const to = (e.recipient || '').split(',')[0].trim();
  if (to) parts.push(`to:${to}`);
  if (e.subject && e.subject !== '(no subject)') parts.push(`subject:"${e.subject.replace(/"/g, '')}"`);
  const acct = e.owner ? `?authuser=${encodeURIComponent(e.owner)}` : '';
  return `https://mail.google.com/mail/u/${acct}#search/${encodeURIComponent(parts.join(' '))}`;
}

async function toggleDetail(id) {
  const dr = document.getElementById(`d-${id}`);
  if (!dr) return;
  if (dr.style.display === 'table-row') { dr.style.display = 'none'; return; }
  dr.style.display = 'table-row';
  const box = document.getElementById(`di-${id}`);
  box.innerHTML = 'Loading…';
  try {
    const d = await (await fetch(`${API}/api/emails/${id}`)).json();
    // link-wise click count
    const byUrl = {};
    (d.clicks || []).forEach((c) => { byUrl[c.url] = (byUrl[c.url] || 0) + 1; });
    const linkRows = Object.entries(byUrl).sort((a, b) => b[1] - a[1])
      .map(([url, n]) => `<div class="bar"><span class="lab" title="${esc(url)}">🔗 ${esc(url.replace(/^https?:\/\//, ''))}</span><span class="val">${n} click${n > 1 ? 's' : ''}</span></div>`).join('');

    const events = [];
    (d.opens || []).forEach((o) => events.push({ t: o.opened_at, type: o.is_proxy ? 'proxy' : 'open', ua: o.user_agent }));
    (d.clicks || []).forEach((c) => events.push({ t: c.clicked_at, type: 'click', url: c.url, ua: c.user_agent }));
    events.sort((a, b) => a.t - b.t);

    const tl = !events.length
      ? '<p style="color:var(--grey)">No opens or clicks yet. The recipient has not opened it (or images are blocked).</p>'
      : '<ul class="tl">' + events.map((ev) => {
        if (ev.type === 'click') return `<li class="click"><b>🔗 Link click</b> — ${fmt(ev.t)}<br><small style="color:var(--grey)">${esc(ev.url)}</small></li>`;
        if (ev.type === 'proxy') return `<li class="proxy">👁 Open (proxy / auto) — ${fmt(ev.t)} <span class="badge badge-proxy">likely machine</span></li>`;
        return `<li><b>📬 Opened</b> — ${fmt(ev.t)}<br><small style="color:var(--grey)">${esc(deviceOf(ev.ua))} · ${esc((ev.ua || '').slice(0, 60))}</small></li>`;
      }).join('') + '</ul>';

    box.innerHTML = (linkRows ? `<div style="margin-bottom:12px"><b>Link-wise clicks</b>${linkRows}</div>` : '') + tl;
  } catch (_) { box.innerHTML = 'Could not load details.'; }
}

// Device guess from user-agent (works when there is no Gmail proxy, e.g. Outlook)
function deviceOf(ua) {
  ua = (ua || '').toLowerCase();
  if (ua.includes('googleimageproxy') || ua.includes('ggpht')) return '🖼 Gmail (device hidden)';
  if (/iphone|android.*mobile|windows phone/.test(ua)) return '📱 Phone';
  if (/ipad|tablet/.test(ua)) return '📱 Tablet';
  if (/windows|macintosh|linux|cros/.test(ua)) return '💻 Computer';
  return '❔ Unknown';
}

/* ---------- tags edit ---------- */
async function editTags(id) {
  const e = ALL.find((x) => x.id === id);
  const val = prompt('Tags (comma separated), e.g. Client A, demo', e ? (e.tags || '') : '');
  if (val === null) return;
  try {
    await fetch(`${API}/api/emails/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: val }) });
    await loadEmails();
    toast('Tags saved');
  } catch (_) { toast('Could not save'); }
}

/* ---------- card filters ---------- */
document.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
  document.getElementById('filter').value = c.dataset.filter || 'all';
  render();
}));

/* ---------- CSV export ---------- */
function exportCSV() {
  const rows = filtered();
  const head = ['Subject', 'From', 'To', 'Status', 'Opens', 'Clicks', 'Replied', 'Tags', 'Sent', 'First open', 'Last open'];
  const lines = [head.join(',')];
  rows.forEach((e) => {
    const st = e.bounced ? 'Bounced' : (e.open_count > 0 ? 'Opened' : 'Sent');
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    lines.push([e.subject, e.owner, e.recipient, st, e.open_count || 0, e.click_count || 0,
      e.replied ? 'Yes' : 'No', e.tags || '', new Date(e.sent_at).toLocaleString(),
      e.first_open ? new Date(e.first_open).toLocaleString() : '', e.last_open ? new Date(e.last_open).toLocaleString() : ''
    ].map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mail-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`Exported ${rows.length} emails to CSV`);
}

/* ---------- analytics ---------- */
async function loadAnalytics() {
  // heatmap: day (row) x hour (col) — open count
  let opens = [];
  try { opens = (await (await fetch(`${API}/api/opens`)).json()).opens || []; } catch (_) {}
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  opens.filter((o) => !o.is_proxy).forEach((o) => {
    const d = new Date(o.opened_at); const g = grid[d.getDay()][d.getHours()] += 1;
    if (g > max) max = g;
  });
  const heat = document.getElementById('heat');
  let html = '<div class="hc lbl"></div>';
  for (let h = 0; h < 24; h++) html += `<div class="hc lbl top">${h}</div>`;
  for (let d = 0; d < 7; d++) {
    html += `<div class="hc lbl">${days[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = grid[d][h], a = max ? (0.12 + 0.88 * v / max) : 0;
      html += `<div class="hc" style="background:rgba(var(--heat),${v ? a.toFixed(2) : 0.06})" title="${days[d]} ${h}:00 — ${v} opens"></div>`;
    }
  }
  heat.innerHTML = html;

  // by domain
  const dom = {};
  ALL.forEach((e) => { const d = domainOf(e.recipient); if (!d) return; (dom[d] = dom[d] || { sent: 0, open: 0 }); dom[d].sent++; if (e.open_count > 0) dom[d].open++; });
  renderBars('domain-stats', Object.entries(dom).map(([k, v]) => [k, v.sent, Math.round(100 * v.open / v.sent)])
    .sort((a, b) => b[2] - a[2] || b[1] - a[1]).slice(0, 10), (r) => `${r[2]}% open · ${r[1]} sent`);

  // by template
  const tpl = {};
  ALL.forEach((e) => { if (!e.template) return; (tpl[e.template] = tpl[e.template] || { sent: 0, open: 0 }); tpl[e.template].sent++; if (e.open_count > 0) tpl[e.template].open++; });
  const tplRows = Object.entries(tpl).map(([k, v]) => [k, v.sent, Math.round(100 * v.open / v.sent)]).sort((a, b) => b[2] - a[2]);
  renderBars('template-stats', tplRows, (r) => `${r[2]}% open · ${r[1]} sent`,
    tplRows.length ? '' : 'No emails sent with a template yet.');

  // weekly summary
  const now = Date.now(), weekMs = 7 * 86400000;
  const week = ALL.filter((e) => now - e.sent_at <= weekMs);
  const wSent = week.length, wOpen = week.filter((e) => e.open_count > 0).length, wReply = week.filter((e) => e.replied).length;
  // best day/hour
  let bestHour = '—';
  if (max) { let bd = 0, bh = 0; for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (grid[d][h] === max) { bd = d; bh = h; } bestHour = `${days[bd]} ${bh}:00`; }
  document.getElementById('weekly').innerHTML = `
    <div class="bar"><span class="lab">Sent</span><span class="val" style="text-align:left">${wSent}</span></div>
    <div class="bar"><span class="lab">Opened</span><span class="val" style="text-align:left">${wOpen} (${wSent ? Math.round(100 * wOpen / wSent) : 0}%)</span></div>
    <div class="bar"><span class="lab">Replied</span><span class="val" style="text-align:left">${wReply}</span></div>
    <div class="bar"><span class="lab">Best time (opens)</span><span class="val" style="text-align:left">${bestHour}</span></div>`;
}
function renderBars(elId, rows, valFn, emptyMsg) {
  const el = document.getElementById(elId);
  if (!rows.length) { el.innerHTML = `<p style="color:var(--grey);font-size:13px">${emptyMsg || 'No data yet.'}</p>`; return; }
  const maxPct = Math.max(...rows.map((r) => r[2]), 1);
  el.innerHTML = rows.map((r) => `<div class="bar"><span class="lab" title="${esc(r[0])}">${esc(r[0])}</span>
    <span class="track"><span class="fill" style="width:${Math.max(4, 100 * r[2] / maxPct)}%"></span></span>
    <span class="val">${valFn(r)}</span></div>`).join('');
}

/* ---------- recipients profile ---------- */
function recipientList() {
  const map = {};
  ALL.forEach((e) => {
    (e.recipient || '').split(',').map((r) => r.trim()).filter(Boolean).forEach((r) => {
      const k = r.toLowerCase();
      const m = map[k] = map[k] || { email: r, sent: 0, open: 0, reply: 0, last: 0 };
      m.sent++; if (e.open_count > 0) m.open++; if (e.replied) m.reply++;
      m.last = Math.max(m.last, e.last_open || 0, e.sent_at || 0);
    });
  });
  return Object.values(map).sort((a, b) => b.last - a.last);
}
function renderRecipients() {
  const q = document.getElementById('rsearch').value.toLowerCase().trim();
  const list = recipientList().filter((r) => !q || r.email.toLowerCase().includes(q));
  const tb = document.getElementById('rtbody');
  if (!list.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">No recipients.</td></tr>'; return; }
  tb.innerHTML = list.map((r) => `<tr class="email-row" data-email="${esc(r.email)}">
    <td class="subj">${esc(r.email)}</td><td>${r.sent}</td><td>${r.open}</td>
    <td>${Math.round(100 * r.open / r.sent)}%</td><td>${r.reply}</td><td class="recip">${fmt(r.last)}</td></tr>`).join('');
  tb.querySelectorAll('.email-row').forEach((row) => row.addEventListener('click', () => recipientProfile(row.dataset.email)));
}
function recipientProfile(email) {
  const mails = ALL.filter((e) => (e.recipient || '').toLowerCase().includes(email.toLowerCase()))
    .sort((a, b) => b.sent_at - a.sent_at);
  const sent = mails.length, open = mails.filter((e) => e.open_count > 0).length, reply = mails.filter((e) => e.replied).length;
  const rows = mails.map((e) => {
    const st = statusOf(e);
    return `<tr><td class="subj">${esc(e.subject)}</td><td class="status ${st.cls}">${st.txt}</td>
      <td class="recip">${e.open_count || 0} opens</td><td class="recip">${fmt(e.sent_at)}</td></tr>`;
  }).join('');
  openModal(`<h3>${esc(email)}</h3>
    <div class="sub">${sent} sent · ${open} opened (${Math.round(100 * open / sent)}%) · ${reply} replied</div>
    <table><thead><tr><th>Subject</th><th>Status</th><th>Opens</th><th>Sent</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row"><button class="btn-ghost" onclick="closeModal()">Close</button></div>`);
}

/* ---------- templates ---------- */
async function loadTemplates() {
  let list = [];
  try { list = (await (await fetch(`${API}/api/templates`)).json()).templates || []; } catch (_) {}
  const el = document.getElementById('tmpl-list');
  if (!list.length) { el.innerHTML = '<p style="color:var(--grey)">No templates yet. Create one with "+ New template".</p>'; return; }
  el.innerHTML = list.map((t) => `<div class="tmpl-item">
    <div><b>${esc(t.name)}</b><br><small style="color:var(--grey)">${esc(t.subject || '(no subject)')}</small></div>
    <div><button class="btn" data-edit="${t.id}">Edit</button> <button class="btn" data-del="${t.id}">🗑</button></div></div>`).join('');
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this template?')) return;
    await fetch(`${API}/api/templates/${b.dataset.del}`, { method: 'DELETE' }); loadTemplates(); toast('Template deleted');
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const t = list.find((x) => String(x.id) === b.dataset.edit); templateModal(t);
  }));
}
function templateModal(t) {
  t = t || { name: '', subject: '', body: '' };
  openModal(`<h3>${t.id ? 'Edit template' : 'New template'}</h3>
    <label>Name</label><input id="t-name" value="${esc(t.name)}" placeholder="e.g. Intro email" />
    <label>Subject</label><input id="t-subj" value="${esc(t.subject || '')}" />
    <label>Body (HTML or text)</label><textarea id="t-body" rows="7">${esc(t.body || '')}</textarea>
    <div class="row"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="t-save">Save</button></div>`);
  document.getElementById('t-save').addEventListener('click', async () => {
    const name = document.getElementById('t-name').value.trim();
    if (!name) { toast('Name is required'); return; }
    await fetch(`${API}/api/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject: document.getElementById('t-subj').value, body: document.getElementById('t-body').value }) });
    closeModal(); loadTemplates(); toast('Template saved');
  });
}

/* ---------- modal ---------- */
function openModal(html) { document.getElementById('modal').innerHTML = html; document.getElementById('modal-bg').classList.add('show'); }
function closeModal() { document.getElementById('modal-bg').classList.remove('show'); }
document.getElementById('modal-bg').addEventListener('click', (e) => { if (e.target.id === 'modal-bg') closeModal(); });
window.closeModal = closeModal;

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  const v = t.dataset.view;
  ['emails', 'analytics', 'recipients', 'templates'].forEach((name) =>
    document.getElementById('view-' + name).classList.toggle('hide', name !== v));
  if (v === 'analytics') loadAnalytics();
  if (v === 'recipients') renderRecipients();
  if (v === 'templates') loadTemplates();
}));

/* ---------- live update (SSE) + notifications ---------- */
let notifOn = false;
function setupLive() {
  const live = document.getElementById('live'), txt = document.getElementById('live-txt');
  let es;
  function connect() {
    es = new EventSource(`${API}/api/events`);
    es.onopen = () => { live.classList.add('on'); txt.textContent = 'live'; };
    es.onerror = () => { live.classList.remove('on'); txt.textContent = 'reconnecting…'; };
    const refresh = () => { loadEmails(); };
    es.addEventListener('open', (ev) => {
      const d = JSON.parse(ev.data || '{}');
      notify('📬 Email opened!', `"${(d.subject || '').slice(0, 40)}" — ${d.recipient || ''}`);
      toast(`📬 Opened: ${(d.subject || '').slice(0, 30)}`);
      refresh();
    });
    es.addEventListener('click', (ev) => { const d = JSON.parse(ev.data || '{}'); toast(`🔗 Link click: ${(d.subject || '').slice(0, 30)}`); refresh(); });
    es.addEventListener('replied', (ev) => { const d = JSON.parse(ev.data || '{}'); notify('↩ Reply received!', `"${(d.subject || '').slice(0, 40)}"`); toast('↩ Reply received'); refresh(); });
    es.addEventListener('register', refresh);
    es.addEventListener('update', refresh);
    es.addEventListener('reminder', (ev) => {
      const d = JSON.parse(ev.data || '{}'); const n = (d.emails || []).length;
      if (n) { notify('⏰ Follow-up reminder', `${n} email${n > 1 ? 's' : ''} still not opened`); toast(`⏰ ${n} follow-up due`); }
    });
  }
  connect();
}
function notify(title, body) {
  if (!notifOn || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/dashboard/' }); } catch (_) {}
}
document.getElementById('notif-btn').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('This browser does not support notifications'); return; }
  const p = await Notification.requestPermission();
  notifOn = p === 'granted';
  toast(notifOn ? '🔔 Alerts on' : 'Alerts off (permission denied)');
});
// if permission already granted, keep it on
if ('Notification' in window && Notification.permission === 'granted') notifOn = true;

/* ---------- events ---------- */
['search', 'filter', 'sender', 'date', 'followup'].forEach((id) =>
  document.getElementById(id).addEventListener('input', render));
document.getElementById('rsearch').addEventListener('input', renderRecipients);
document.getElementById('csv-btn').addEventListener('click', exportCSV);
document.getElementById('new-tmpl').addEventListener('click', () => templateModal());
document.getElementById('refresh').addEventListener('click', () => { loadEmails(); });

/* ---------- reminders poll (server checks due reminders each minute) ---------- */
setInterval(() => { fetch(`${API}/api/reminders/due`).catch(() => {}); }, 60000);
fetch(`${API}/api/reminders/due`).catch(() => {});

/* ---------- boot ---------- */
loadEmails();
setupLive();
setInterval(loadEmails, 30000); // safety refresh in addition to SSE
