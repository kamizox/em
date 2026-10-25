/* background.js — service worker
 * Kaam:
 *  - Sent emails ko memory mein rakho (status polling ke liye)
 *  - Har kuch waqt baad server se poll kar ke dekho koi email abhi "open" hui?
 *    agar haan to Chrome notification bhejo.
 */

const POLL_ALARM = 'mt-poll';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});

// Server ka base URL (bina trailing slash)
async function serverBase() {
  const cfg = await chrome.storage.sync.get(['serverUrl']);
  return (cfg.serverUrl || '').replace(/\/+$/, '');
}

// Email register karo + local list mein daalo.
// NOTE: ye call yahan (service worker mein) hoti hai, content script mein nahi.
// Gmail https page se http://localhost par request Chrome block kar deta hai
// (CORS + Private Network Access), jab ke service worker ke paas host_permissions hain.
async function registerEmail(data) {
  const base = await serverBase();
  if (!base) return { ok: false, error: 'server URL set nahi hai' };

  try {
    const res = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.id, owner: data.owner || '', subject: data.subject, recipient: data.recipient }),
    });
    if (!res.ok) return { ok: false, error: `server ne ${res.status} diya` };
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const d = await chrome.storage.local.get(['sent']);
  const sent = d.sent || {};
  sent[data.id] = { ...data, notifiedOpen: false };
  await chrome.storage.local.set({ sent });
  return { ok: true };
}

// Server se public URL maango (pixel/link ke liye). Short cache taake har
// compose par network hit na ho, lekin tunnel badle to jaldi pata chal jaye.
let cfgCache = { at: 0, publicUrl: '' };
async function fetchConfig() {
  const base = await serverBase();
  if (!base) return { publicUrl: '' };
  if (Date.now() - cfgCache.at < 20000) return { publicUrl: cfgCache.publicUrl };
  try {
    const res = await fetch(`${base}/api/config`);
    const json = await res.json();
    cfgCache = { at: Date.now(), publicUrl: (json.publicUrl || '').replace(/\/+$/, '') };
  } catch (_) {
    cfgCache = { at: Date.now(), publicUrl: '' };
  }
  return { publicUrl: cfgCache.publicUrl };
}

async function fetchEmails(limit = 300) {
  const base = await serverBase();
  if (!base) return { emails: [] };
  const cfg = await chrome.storage.sync.get(['owner']);
  try {
    const url = `${base}/api/emails?limit=${limit}` ;
    const res = await fetch(url);
    return await res.json();
  } catch (_) {
    return { emails: [] };
  }
}

// content.js se messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'MT_REGISTER') {
    registerEmail(msg.data).then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'MT_EMAILS') {
    fetchEmails(msg.limit).then(sendResponse);
    return true;
  }
  if (msg.type === 'MT_LOG') {
    serverBase().then((base) => {
      if (!base) return sendResponse({ ok: false });
      fetch(`${base}/api/log`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: msg.msg }),
      }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }
  if (msg.type === 'MT_SELFVIEW') {
    serverBase().then((base) => {
      if (!base) return sendResponse({ ok: false });
      fetch(`${base}/api/selfview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id }),
      }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }
  if (msg.type === 'MT_CONFIG') {
    fetchConfig().then(sendResponse);
    return true;
  }
  if (msg.type === 'EMAIL_SENT') {
    // purana message — ab MT_REGISTER sab kuch karta hai
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollOpens();
});

async function pollOpens() {
  const cfg = await chrome.storage.sync.get(['serverUrl', 'owner', 'notify']);
  const serverUrl = (cfg.serverUrl || '').replace(/\/+$/, '');
  if (!serverUrl) return;
  if (cfg.notify === false) return;

  let emails = [];
  try {
    const url = `${serverUrl}/api/emails?limit=200` ;
    const res = await fetch(url);
    const json = await res.json();
    emails = json.emails || [];
  } catch (_) { return; }

  const d = await chrome.storage.local.get(['sent']);
  const sent = d.sent || {};
  let changed = false;

  for (const e of emails) {
    const local = sent[e.id];
    if (!local) continue; // sirf is browser se bheji emails
    if ((e.open_count || 0) > 0 && !local.notifiedOpen) {
      // pehli dafa open hui — notify!
      chrome.notifications.create(`open-${e.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '📬 Email kholi gayi!',
        message: `"${(e.subject || '').slice(0, 50)}" ko ${e.recipient || 'recipient'} ne khola.`,
        priority: 2,
      });
      local.notifiedOpen = true;
      changed = true;
    }
  }
  if (changed) chrome.storage.local.set({ sent });
}
