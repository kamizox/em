/* popup.js — quick stats + recent tracked emails */

let SERVER = '', OWNER = '';

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60000) return 'abhi';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min pehle';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' ghante pehle';
  return d.toLocaleDateString();
}

async function load() {
  const cfg = await chrome.storage.sync.get(['serverUrl', 'owner']);
  SERVER = (cfg.serverUrl || '').replace(/\/+$/, '');
  OWNER = cfg.owner || '';

  if (!SERVER) {
    document.getElementById('warn').style.display = 'block';
    document.getElementById('list').innerHTML = '<div class="empty">Pehle settings mein server URL daalo.</div>';
    return;
  }

  // stats
  try {
    const s = await (await fetch(`${SERVER}/api/stats` + '')).json();
    document.getElementById('s-sent').textContent = s.total_sent;
    document.getElementById('s-open').textContent = s.total_opened;
    document.getElementById('s-click').textContent = s.total_clicked;
  } catch (_) {}

  // list
  try {
    const url = `${SERVER}/api/emails?limit=25` + '';
    const data = await (await fetch(url)).json();
    const list = document.getElementById('list');
    if (!data.emails || !data.emails.length) {
      list.innerHTML = '<div class="empty">Abhi koi tracked email nahi. Gmail mein email bhejo (Track ON ke sath).</div>';
      return;
    }
    list.innerHTML = data.emails.map((e) => {
      const opened = (e.open_count || 0) > 0;
      let mark, cls, meta;
      if (e.bounced) { mark = '⚠ bounce'; cls = 'm-bounce'; meta = 'deliver nahi hui'; }
      else if (opened) {
        mark = `✓✓ ${e.open_count}×`; cls = 'm-open';
        meta = `kholi ${fmtTime(e.last_open)}` + (e.click_count ? ` · ${e.click_count} click` : '');
      } else { mark = '✓ sent'; cls = 'm-sent'; meta = `bheji ${fmtTime(e.sent_at)}`; }
      return `<div class="row">
        <div>
          <div class="subj">${escapeHtml(e.subject || '(no subject)')}</div>
          <div class="meta">${escapeHtml(e.owner || '?')} → ${escapeHtml(e.recipient || '?')} · ${meta}</div>
        </div>
        <div class="mark ${cls}">${mark}</div>
      </div>`;
    }).join('');
  } catch (err) {
    document.getElementById('list').innerHTML = `<div class="empty">Server se connect nahi ho paya.<br><small>${SERVER}</small></div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('openOpts').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('openOpts2')?.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
document.getElementById('openDash').addEventListener('click', (e) => {
  e.preventDefault();
  if (SERVER) chrome.tabs.create({ url: `${SERVER}/dashboard` });
});

load();
