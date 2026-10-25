/* background.js — service worker
 * What it does:
 *  - Keep sent emails in memory (for status polling)
 *  - Poll the server periodically to see if any email was just "opened"
 *    and, if so, send a Chrome notification.
 */

const POLL_ALARM = 'mt-poll';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});

// Server base URL (without trailing slash)
async function serverBase() {
  const cfg = await chrome.storage.sync.get(['serverUrl']);
  return (cfg.serverUrl || '').replace(/\/+$/, '');
}

// Register the email + add it to the local list.
// NOTE: this call happens here (in the service worker), not in the content script.
// Chrome blocks a request from the Gmail https page to http://localhost
// (CORS + Private Network Access), while the service worker has host_permissions.
async function registerEmail(data) {
  const base = await serverBase();
  if (!base) return { ok: false, error: 'server URL is not set' };

  try {
    const res = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: data.id, owner: data.owner || '', subject: data.subject, recipient: data.recipient,
        scheduled: data.scheduled || 0, tags: data.tags || '', template: data.template || '', remind_days: data.remind_days || 0,
      }),
    });
    if (!res.ok) return { ok: false, error: `server returned ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const d = await chrome.storage.local.get(['sent']);
  const sent = d.sent || {};
  sent[data.id] = { ...data, notifiedOpen: false };
  await chrome.storage.local.set({ sent });
  return { ok: true };
}

// Ask the server for the public URL (for pixel/link). A short cache so every
// compose doesn't hit the network, but a tunnel change is noticed quickly.
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

// messages from content.js
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
  if (msg.type === 'MT_TEMPLATES') {
    serverBase().then(async (base) => {
      if (!base) return sendResponse({ templates: [] });
      try { sendResponse(await (await fetch(`${base}/api/templates`)).json()); }
      catch (_) { sendResponse({ templates: [] }); }
    });
    return true;
  }
  if (msg.type === 'MT_PATCH') {
    serverBase().then((base) => {
      if (!base) return sendResponse({ ok: false });
      fetch(`${base}/api/emails/${encodeURIComponent(msg.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.data || {}),
      }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }
  if (msg.type === 'MT_REPLIED') {
    serverBase().then((base) => {
      if (!base) return sendResponse({ ok: false });
      fetch(`${base}/api/replied`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.data || {}),
      }).then((r) => r.json()).then(sendResponse).catch(() => sendResponse({ ok: false }));
    });
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
    if (!local) continue; // only emails sent from this browser
    if ((e.open_count || 0) > 0 && !local.notifiedOpen) {
      // opened for the first time — notify!
      chrome.notifications.create(`open-${e.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '📬 Email opened!',
        message: `"${(e.subject || '').slice(0, 50)}" was opened by ${e.recipient || 'recipient'}.`,
        priority: 2,
      });
      local.notifiedOpen = true;
      changed = true;
    }
  }
  // replied? (the server can set this from either the extension or dashboard)
  for (const e of emails) {
    const local = sent[e.id];
    if (!local) continue;
    if (e.replied && !local.notifiedReply) {
      chrome.notifications.create(`reply-${e.id}`, {
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: '↩ Reply received!', message: `"${(e.subject || '').slice(0, 50)}" got a reply.`, priority: 2,
      });
      local.notifiedReply = true; changed = true;
    }
  }
  if (changed) chrome.storage.local.set({ sent });

  // follow-up reminders — the server returns what's due, we notify
  try {
    const due = await (await fetch(`${serverUrl}/api/reminders/due`)).json();
    (due.emails || []).forEach((e) => {
      chrome.notifications.create(`remind-${e.id}-${Date.now()}`, {
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: '⏰ Follow up', message: `"${(e.subject || '').slice(0, 50)}" has not been opened yet.`, priority: 2,
      });
    });
  } catch (_) {}
}
