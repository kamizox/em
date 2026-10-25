/* popup.js — quick stats + recent tracked emails */

let SERVER = '', OWNER = '';

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
  return d.toLocaleDateString();
}

async function load() {
  const cfg = await chrome.storage.sync.get(['serverUrl', 'owner']);
  SERVER = (cfg.serverUrl || '').replace(/\/+$/, '');
  OWNER = cfg.owner || '';

  if (!SERVER) {
    document.getElementById('warn').style.display = 'block';
    document.getElementById('list').innerHTML = '<div class="empty">First set the server URL in settings.</div>';
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
      list.innerHTML = '<div class="empty">No tracked emails yet. Send an email in Gmail (with Track ON).</div>';
      return;
    }
    list.innerHTML = data.emails.map((e) => {
      const opened = (e.open_count || 0) > 0;
      let mark, cls, meta;
      if (e.bounced) { mark = '⚠ bounce'; cls = 'm-bounce'; meta = 'not delivered'; }
      else if (opened) {
        mark = `✓✓ ${e.open_count}×`; cls = 'm-open';
        meta = `opened ${fmtTime(e.last_open)}` + (e.click_count ? ` · ${e.click_count} click` : '');
      } else { mark = '✓ sent'; cls = 'm-sent'; meta = `sent ${fmtTime(e.sent_at)}`; }
      return `<div class="row">
        <div>
          <div class="subj">${escapeHtml(e.subject || '(no subject)')}</div>
          <div class="meta">${escapeHtml(e.owner || '?')} → ${escapeHtml(e.recipient || '?')} · ${meta}</div>
        </div>
        <div class="mark ${cls}">${mark}</div>
      </div>`;
    }).join('');
  } catch (err) {
    document.getElementById('list').innerHTML = `<div class="empty">Could not connect to the server.<br><small>${SERVER}</small></div>`;
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
