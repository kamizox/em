/* dashboard.js — emails load karo, stats, search/filter, aur detail timeline */

// Dashboard server ke saath hi serve hota hai, is liye relative paths kaam karenge.
const API = '';

let ALL = [];

function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60000) return 'abhi';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min pehle';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' ghante pehle';
  return d.toLocaleString();
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadStats() {
  try {
    const s = await (await fetch(`${API}/api/stats`)).json();
    document.getElementById('c-sent').textContent = s.total_sent;
    document.getElementById('c-open').textContent = s.total_opened;
    document.getElementById('c-rate').textContent = s.open_rate + '%';
    document.getElementById('c-click').textContent = s.total_clicked;
    document.getElementById('c-bounce').textContent = s.total_bounced;
  } catch (_) {}
}

async function loadEmails() {
  try {
    const data = await (await fetch(`${API}/api/emails?limit=500`)).json();
    ALL = data.emails || [];
    fillSenders();
    render();
  } catch (err) {
    document.getElementById('tbody').innerHTML =
      '<tr><td colspan="9" class="empty">Server se connect nahi ho paya. Backend chal raha hai?</td></tr>';
  }
}

// "Sab accounts" dropdown — jitne bhi sender accounts se email gayi
function fillSenders() {
  const sel = document.getElementById('sender');
  const cur = sel.value;
  const owners = [...new Set(ALL.map((e) => e.owner).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Sab accounts</option>' +
    owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (owners.includes(cur)) sel.value = cur;
}

function statusOf(e) {
  if (e.bounced) return { cls: 'st-bounce', txt: '⚠ Bounce' };
  if ((e.open_count || 0) > 0) return { cls: 'st-open', txt: '✓✓ Kholi' };
  return { cls: 'st-sent', txt: '✓ Sent' };
}

function render() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const f = document.getElementById('filter').value;
  const who = document.getElementById('sender').value;

  let rows = ALL.filter((e) => {
    if (who && e.owner !== who) return false;
    if (q && !((e.subject || '').toLowerCase().includes(q) || (e.recipient || '').toLowerCase().includes(q) || (e.owner || '').toLowerCase().includes(q))) return false;
    if (f === 'opened' && !(e.open_count > 0)) return false;
    if (f === 'unopened' && e.open_count > 0) return false;
    if (f === 'clicked' && !(e.click_count > 0)) return false;
    if (f === 'bounced' && !e.bounced) return false;
    return true;
  });

  const tb = document.getElementById('tbody');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="9" class="empty">Koi email nahi mili.</td></tr>';
    return;
  }

  tb.innerHTML = rows.map((e) => {
    const st = statusOf(e);
    const opened = (e.open_count || 0) > 0;
    return `<tr class="email-row${opened ? ' is-open' : ''}" data-id="${e.id}" data-url="${esc(gmailUrl(e))}" title="Click: Gmail mein ye sent email kholo">
      <td class="subj"><a class="gm" href="${esc(gmailUrl(e))}" target="mt-open-${e.id}">${esc(e.subject)} <span class="ext">↗</span></a></td>
      <td class="recip">${esc(e.owner || '—')}</td>
      <td class="recip">${esc(e.recipient || '—')}</td>
      <td class="status ${st.cls}">${st.txt}</td>
      <td class="recip">${opened ? `<b class="st-open">${fmt(e.last_open)}</b>` : '—'}</td>
      <td>${e.open_count || 0}${e.open_count_all > e.open_count ? ` <span class="badge-proxy">+${e.open_count_all - e.open_count} proxy</span>` : ''}</td>
      <td>${e.click_count || 0}</td>
      <td class="recip">${fmt(e.sent_at)}</td>
      <td><button class="tl-btn" data-id="${e.id}" title="Kab kab kholi — poori timeline">▾</button></td>
    </tr>
    <tr class="detail" id="d-${e.id}" style="display:none"><td colspan="9"><div class="detail-inner" id="di-${e.id}">…</div></td></tr>`;
  }).join('');

  // Row click -> Gmail mein wahi sent email. ▾ button -> open/click timeline.
  document.querySelectorAll('.email-row').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('a, .tl-btn')) return;
      // window name "mt-open-..." -> extension Gmail mein akela result khud khol deti hai
      window.open(row.dataset.url, 'mt-open-' + row.dataset.id);
    });
  });
  document.querySelectorAll('.tl-btn').forEach((b) => {
    b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleDetail(b.dataset.id); });
  });
}

// Gmail search link jo exactly ye email dhoondta hai: sender account (authuser) +
// Sent folder + recipient + subject + bhejne ka waqt (after/before unix seconds).
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
  box.innerHTML = 'Load ho raha hai…';

  try {
    const d = await (await fetch(`${API}/api/emails/${id}`)).json();
    const events = [];
    (d.opens || []).forEach((o) => events.push({ t: o.opened_at, type: o.is_proxy ? 'proxy' : 'open', ua: o.user_agent }));
    (d.clicks || []).forEach((c) => events.push({ t: c.clicked_at, type: 'click', url: c.url, ua: c.user_agent }));
    events.sort((a, b) => a.t - b.t);

    if (!events.length) {
      box.innerHTML = '<p style="color:var(--grey)">Abhi koi open/click nahi. Recipient ne nahi khola (ya images block hain).</p>';
      return;
    }
    box.innerHTML = '<ul class="tl">' + events.map((ev) => {
      if (ev.type === 'click')
        return `<li class="click"><b>🔗 Link click</b> — ${fmt(ev.t)}<br><small style="color:var(--grey)">${esc(ev.url)}</small></li>`;
      if (ev.type === 'proxy')
        return `<li class="proxy">👁 Open (proxy/auto) — ${fmt(ev.t)} <span class="badge-proxy">shayad machine</span></li>`;
      return `<li><b>📬 Kholi gayi</b> — ${fmt(ev.t)}<br><small style="color:var(--grey)">${esc((ev.ua || '').slice(0, 70))}</small></li>`;
    }).join('') + '</ul>';
  } catch (_) {
    box.innerHTML = 'Detail load nahi ho payi.';
  }
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('filter').addEventListener('change', render);
document.getElementById('sender').addEventListener('change', render);
// "Kholi gayi" card par click -> sirf kholi gayi emails
document.getElementById('c-open').closest('.card').addEventListener('click', () => {
  document.getElementById('filter').value = 'opened'; render();
});
document.getElementById('refresh').addEventListener('click', () => { loadStats(); loadEmails(); });

loadStats();
loadEmails();
setInterval(() => { loadStats(); loadEmails(); }, 15000); // auto refresh
