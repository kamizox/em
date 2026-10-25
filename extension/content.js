/* content.js — runs inside Gmail.
 *
 * What it does:
 *  1. Detect the compose window (by observing the DOM).
 *  2. Add a toolbar toggle to each compose: "Track" ON/OFF.
 *  3. On send (if Track is ON): make a unique id, wrap the body links,
 *     append a 1x1 pixel at the end of the body, and register the email on the server.
 *  4. Show a ✓ / ✓✓ / open-count badge in the sent-email list.
 *
 * NOTE: Gmail changes its class names often, so we use robust selectors
 *       (role attributes, aria-labels) and rely little on class names.
 */

(function () {
  'use strict';
  const VERSION = '2.0';

  const STATE = {
    serverUrl: '',   // API base — localhost works too; only the extension uses this
    publicUrl: '',   // pixel/link base — tunnel or deployed URL, comes from the server
    owner: '',
    trackDefault: true,
  };

  // The URL that goes inside the email. A public URL is required: the pixel loads via
  // Gmail's image proxy (Google's servers), which cannot reach localhost.
  function trackBase() {
    return STATE.publicUrl || STATE.serverUrl;
  }

  async function refreshConfig() {
    try {
      const cfg = await chrome.runtime.sendMessage({ type: 'MT_CONFIG' });
      STATE.publicUrl = (cfg && cfg.publicUrl) || '';
    } catch (_) {}
  }

  // --- settings load ---
  chrome.storage.sync.get(['serverUrl', 'owner', 'trackDefault'], (cfg) => {
    STATE.serverUrl = (cfg.serverUrl || '').replace(/\/+$/, '');
    STATE.owner = cfg.owner || '';
    STATE.trackDefault = cfg.trackDefault !== false;
    setTimeout(boot, 0); // after the IIFE has fully loaded
  });

  function boot() {
    rlog('boot', { v: VERSION, server: STATE.serverUrl, owner: STATE.owner, trackDefault: STATE.trackDefault });
    if (!STATE.serverUrl) {
      console.warn('[MailTracker] Server URL is not set. Open the extension options.');
    }
    refreshConfig();
    setInterval(refreshConfig, 30000); // auto-detects if the tunnel changes
    observeCompose();
    // Refresh sent-list badges every few seconds
    setInterval(decorateSentList, 4000);
    decorateSentList();
  }

  // ---------- unique id ----------
  function makeId() {
    // 16 char url-safe id
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    const arr = crypto.getRandomValues(new Uint8Array(16));
    for (let i = 0; i < 16; i++) s += chars[arr[i] % chars.length];
    return s;
  }

  // ---------- remote log (goes to server's .run/ext.log, for debugging) ----------
  function rlog(...a) {
    const msg = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    console.log('[MailTracker]', msg);
    try { chrome.runtime.sendMessage({ type: 'MT_LOG', msg }, () => void chrome.runtime.lastError); } catch (_) {}
  }

  // ---------- compose window detection ----------
  // FIX: previously we only looked for [role="dialog"]. Gmail's bottom-right compose
  // and inline replies are not always role=dialog, so the compose was sometimes never found.
  // Now we find the editable body directly and walk up to the container that has a Send button.
  function observeCompose() {
    scanDialogs();
    setInterval(scanDialogs, 1000);
    // Document-level backup: if any Send button is pressed (mousedown), inject tracking
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest && e.target.closest('[role="button"], [role="menuitem"]');
      if (!btn) return;
      // Schedule-send confirm — the email goes later, but the pixel must be in the body now
      if (isScheduleConfirm(btn)) {
        const box = anyReadyCompose();
        rlog('schedule-send', { haveBox: !!box });
        if (box && box._mtHandler) box._mtHandler(true);
        return;
      }
      if (!isSendButton(btn)) return;
      const box = composeOf(btn);
      rlog('send mousedown', { haveBox: !!box, ready: box?.dataset.mtReady || null });
      if (box && box._mtHandler) box._mtHandler(false);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'Enter')) return;
      const box = composeOf(e.target);
      rlog('ctrl+enter', { haveBox: !!box });
      if (box && box._mtHandler) box._mtHandler(false);
    }, true);
  }

  // "Schedule send" confirm button (after the date picker)
  function isScheduleConfirm(b) {
    const t = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
    return t === 'schedule send' || t === 'schedule' || /schedule send/.test(t);
  }
  // Any open, ready compose (at schedule-confirm time the button is outside the compose)
  function anyReadyCompose() {
    const all = [...document.querySelectorAll('[data-mt-ready]')].filter((d) => !d.dataset.mtInjected && d.offsetParent !== null);
    return all[all.length - 1] || [...document.querySelectorAll('[data-mt-ready]')].pop() || null;
  }

  function editableBodies() {
    // Only the real email body. Gmail's Gemini "Describe your message" box is also a
    // contenteditable textbox — a pixel placed there does not end up in the email.
    return [...document.querySelectorAll('div[contenteditable="true"][g_editable="true"], div[contenteditable="true"][role="textbox"]')]
      .filter((b) => b.getAttribute('g_editable') === 'true' || /message body/i.test(b.getAttribute('aria-label') || ''));
  }

  let lastScanSig = '';
  function scanDialogs() {
    const bodies = editableBodies();
    let found = 0;
    bodies.forEach((b) => { const box = containerFor(b); if (box) { found++; setupComposeDialog(box, b); } });
    const sig = bodies.length + '/' + found;
    if (sig !== lastScanSig) { lastScanSig = sig; rlog('scan: bodies/compose =', sig); }
  }

  // walk up from the body until we find an element that contains a Send button
  function containerFor(body) {
    let el = body.parentElement;
    for (let i = 0; el && i < 25; i++, el = el.parentElement) {
      if (findSendButton(el)) return el;
    }
    return null;
  }
  function composeOf(node) {
    let el = node;
    for (let i = 0; el && i < 40; i++, el = el.parentElement) {
      if (el.dataset && el.dataset.mtReady) return el;
    }
    return null;
  }

  function isSendButton(b) {
    const t = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').trim();
    if (/^send\b/i.test(t)) return true;
    if (b.matches('div.T-I.T-I-atl')) return true;
    return (b.textContent || '').trim().toLowerCase() === 'send';
  }

  // Gmail's Send button — its tooltip/aria-label can be localized, so we try
  // several ways. (excluding "Send later"/"More send options")
  function findSendButton(root) {
    const btns = root.querySelectorAll('[role="button"]');
    for (const b of btns) if (isSendButton(b)) return b;
    return null;
  }

  function setupComposeDialog(dialog, body) {
    if (!dialog || dialog.dataset.mtReady) return;
    const sendBtn = findSendButton(dialog);
    if (!body || !sendBtn) return;

    dialog.dataset.mtReady = '1';
    rlog('compose found, Track chip added', { v: VERSION, server: STATE.serverUrl, public: STATE.publicUrl, track: STATE.trackDefault });
    refreshConfig(); // grab a fresh URL as soon as compose opens, before send

    // --- build the Track toggle chip ---
    const chip = document.createElement('div');
    chip.className = 'mt-chip';
    chip.dataset.on = STATE.trackDefault ? '1' : '0';
    chip.innerHTML = `<span class="mt-dot"></span><span class="mt-label">Track</span>`;
    chip.title = 'Track opens / clicks for this email';
    chip.addEventListener('click', () => {
      chip.dataset.on = chip.dataset.on === '1' ? '0' : '1';
    });
    const toolbar = sendBtn.parentElement;
    if (toolbar) toolbar.appendChild(chip);

    // --- Options chip (tags / reminder / template) ---
    dialog._mtOpts = { tags: '', remindDays: 0, template: '' };
    const opt = document.createElement('div');
    opt.className = 'mt-chip mt-chip-opt';
    opt.dataset.on = '0';
    opt.innerHTML = `<span class="mt-label">⚙ More</span>`;
    opt.title = 'Tags, follow-up reminder, template';
    opt.addEventListener('click', (e) => { e.stopPropagation(); openOptsPopover(dialog, opt); });
    if (toolbar) toolbar.appendChild(opt);

    // --- Send intercept ---
    // FIX: Gmail's Send button fires on MOUSEUP; 'click' comes after that, or not at all.
    // So this runs via document-level mousedown / Ctrl+Enter.
    dialog._mtHandler = (scheduled) => {
      if (chip.dataset.on !== '1') return rlog('skip: track OFF');
      if (!STATE.serverUrl) return rlog('skip: server URL empty');
      if (dialog.dataset.mtInjected) return; // only once per email
      dialog.dataset.mtInjected = '1';
      try {
        injectTracking(dialog, body, !!scheduled);
      } catch (e) {
        rlog('inject fail: ' + (e && e.message));
      }
    };
  }

  // ---------- self-view: do NOT count opening your own email as an "open" ----------
  // When you open your own sent email in Sent/Inbox, Gmail loads the pixel and the
  // server would treat it as "Opened". This function finds our pixel in the opened
  // email and tells the server that this view was yours.
  const SELF_SEEN = new WeakSet(); // report each newly rendered img once
  function reportSelfViews() {
    const base = trackBase();
    if (!base) return;
    // not the img inside compose — only emails being read (.a3s = message body)
    document.querySelectorAll('.a3s img, [role="listitem"] img').forEach((img) => {
      if (img.closest('[contenteditable="true"]')) return;
      const src = img.getAttribute('src') || '';
      // Gmail proxy URL: https://ci3.googleusercontent.com/meips/...#https://host/p/<id>.png
      const m = src.match(/\/p\/([\w-]+)\.png/);
      if (!m) return;
      const id = m[1];
      if (SELF_SEEN.has(img)) return;
      SELF_SEEN.add(img);
      chrome.runtime.sendMessage({ type: 'MT_SELFVIEW', id }, () => void chrome.runtime.lastError);
      console.log('[MailTracker] self-view ignored:', id);
    });
  }
  setInterval(reportSelfViews, 1500);

  // ---------- opened from the dashboard: open the sent email directly ----------
  // The dashboard opens Gmail with the window name "mt-open-<id>" (a search URL).
  // If the search returns exactly 1 email, click it automatically.
  function autoOpenFromDashboard() {
    if (!String(window.name).startsWith('mt-open-')) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (!location.hash.startsWith('#search')) { if (tries > 20) clearInterval(t); return; }
      const rows = [...document.querySelectorAll('tr.zA')].filter((r) => r.offsetParent !== null);
      if (rows.length === 1) {
        clearInterval(t);
        window.name = '';
        rows[0].click();
        rlog('opened email from dashboard');
      } else if (tries > 30) {
        clearInterval(t);
        window.name = '';
      }
    }, 500);
  }
  autoOpenFromDashboard();

  // ---------- tracking inject ----------
  function injectTracking(dialog, body, scheduled) {
    const id = makeId();
    const opts = dialog._mtOpts || {};
    // the Send-button container is small — Subject/To are above it.
    const root = composeRoot(dialog);
    const subject = (root.querySelector('input[name="subjectbox"]')?.value)
      || (document.querySelector('h2.hP')?.textContent) || '(no subject)';
    const recipient = extractRecipients(root);

    // 1) Wrap links (click tracking)
    wrapLinks(body, id);

    // 2) Add the pixel (at the very end of the body)
    const pixel = document.createElement('img');
    pixel.src = `${trackBase()}/p/${id}.png`;
    pixel.width = 1;
    pixel.height = 1;
    pixel.style.cssText = 'width:1px;height:1px;border:0;opacity:0;';
    pixel.alt = '';
    body.appendChild(pixel);

    // 3) Register on the server — via the background service worker.
    //    A direct fetch/sendBeacon from here does not work: Gmail is an https page and
    //    localhost is a private network, which Chrome blocks.
    chrome.runtime.sendMessage(
      { type: 'MT_REGISTER', data: {
        id, owner: detectSender(root), subject, recipient, sentAt: Date.now(),
        scheduled: scheduled ? 1 : 0,
        tags: opts.tags || '', template: opts.template || '', remind_days: opts.remindDays || 0,
      } },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const why = chrome.runtime.lastError?.message || res?.error || 'unknown';
          rlog('register fail: ' + why);
          toast('⚠ Could not register tracking: ' + why, true);
        } else {
          rlog('tracked', { id, base: trackBase(), subject });
          if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(trackBase())) {
            // a localhost pixel cannot be loaded via Gmail's proxy
            toast('⚠ Tracking added, but there is no public URL — opens will not be recorded', true);
          } else {
            toast('✓ Tracking added');
          }
        }
      }
    );
  }

  // small corner toast — so you can tell whether tracking was added
  function toast(text, isError) {
    const el = document.createElement('div');
    el.className = 'mt-toast' + (isError ? ' mt-toast-err' : '');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // Which account it was sent from — Gmail tells us (tab title / account button / From field).
  // So there is no need to fill the "owner" option in every profile/account.
  const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  function detectSender(root) {
    const from = root && root.querySelector('input[name="from"]');
    if (from && EMAIL_RE.test(from.value)) return from.value.match(EMAIL_RE)[0];
    const fromSpan = root && root.querySelector('.az2 [email], [name="from"] [email]');
    if (fromSpan) return fromSpan.getAttribute('email');
    const t = document.title.match(EMAIL_RE);
    if (t) return t[0];
    const acc = document.querySelector('a[aria-label*="@"]');
    const m = acc && acc.getAttribute('aria-label').match(EMAIL_RE);
    if (m) return m[0];
    return STATE.owner || '';
  }

  // The full compose (Subject + To + body) — [role=dialog], otherwise walk up to find subjectbox
  function composeRoot(el) {
    const d = el.closest('[role="dialog"]');
    if (d) return d;
    let cur = el;
    for (let i = 0; cur && i < 15; i++, cur = cur.parentElement) {
      if (cur.querySelector('input[name="subjectbox"]')) return cur;
    }
    return el;
  }

  function extractRecipients(dialog) {
    // recipients from the "To" field — chips contain the email
    const chips = dialog.querySelectorAll('[role="listbox"] [data-hovercard-id], [email]');
    const emails = new Set();
    chips.forEach((c) => {
      const e = c.getAttribute('data-hovercard-id') || c.getAttribute('email');
      if (e && e.includes('@')) emails.add(e);
    });
    return Array.from(emails).join(', ');
  }

  function wrapLinks(body, id) {
    const anchors = body.querySelectorAll('a[href^="http"]');
    anchors.forEach((a) => {
      const orig = a.getAttribute('href');
      if (!orig || a.dataset.mtWrapped) return;
      // don't double-wrap our own server links
      if (orig.includes(trackBase())) return;
      a.href = `${trackBase()}/r/${id}?u=${encodeURIComponent(orig)}`;
      a.dataset.mtWrapped = '1';
    });
  }

  // ---------- sent list badges ----------
  async function decorateSentList() {
    if (!STATE.serverUrl) return;
    // only run in list view
    const rows = document.querySelectorAll('tr[role="row"], div[role="listitem"]');
    if (!rows.length) return;

    // fetch via background too — same private-network reason
    let data;
    try {
      data = await chrome.runtime.sendMessage({ type: 'MT_EMAILS', limit: 300 });
    } catch (_) { return; }
    if (!data || !data.emails) return;

    const bySubject = {};
    (data.emails || []).forEach((e) => {
      const key = normalize(e.subject);
      // keep the newest email for the same subject
      if (!bySubject[key] || e.sent_at > bySubject[key].sent_at) bySubject[key] = e;
    });

    rows.forEach((row) => {
      const subjEl = row.querySelector('[data-thread-id] span, span[data-thread-id], .bog, span');
      const subjText = (row.innerText || '').trim();
      if (!subjText) return;

      // match: does any tracked subject appear in this row's text?
      let match = null;
      for (const key in bySubject) {
        if (key && normalize(subjText).includes(key)) { match = bySubject[key]; break; }
      }
      if (!match) return;

      let badge = row.querySelector('.mt-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mt-badge';
        const anchor = row.querySelector('.bog') || row.firstElementChild;
        (anchor || row).appendChild(badge);
      }
      renderBadge(badge, match);
    });
  }

  function renderBadge(badge, e) {
    const opened = (e.open_count || 0) > 0;
    const clicks = e.click_count || 0;
    let mark, cls, title;

    if (e.bounced) {
      mark = '⚠'; cls = 'mt-bounced'; title = 'Bounced — did not reach the recipient';
    } else if (opened) {
      mark = '✓✓'; cls = 'mt-opened';
      title = `Opened ${e.open_count} time(s)` + (clicks ? ` · ${clicks} click` : '');
    } else {
      mark = '✓'; cls = 'mt-sent'; title = 'Sent — not opened yet';
    }
    badge.textContent = mark + (opened && e.open_count > 1 ? ` ${e.open_count}` : '');
    badge.className = `mt-badge ${cls}`;
    badge.title = title;
  }

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/^(re:|fwd:)\s*/i, '').trim().slice(0, 60);
  }

  // ========================================================================
  //  Compose extras: Tags / Reminder / Template popover
  // ========================================================================
  function openOptsPopover(dialog, anchor) {
    document.querySelectorAll('.mt-pop').forEach((p) => p.remove());
    const o = dialog._mtOpts;
    const pop = document.createElement('div');
    pop.className = 'mt-pop';
    pop.innerHTML = `
      <div class="mt-pop-row"><label>Tags (comma separated)</label>
        <input class="mt-in" id="mt-tags" placeholder="Client A, demo" value="${(o.tags || '').replace(/"/g, '&quot;')}"></div>
      <div class="mt-pop-row"><label>Follow-up reminder</label>
        <select class="mt-in" id="mt-remind">
          <option value="0">Off</option><option value="1">1 day</option>
          <option value="2">2 days</option><option value="3">3 days</option><option value="7">7 days</option>
        </select></div>
      <div class="mt-pop-row"><label>Template</label>
        <select class="mt-in" id="mt-tpl"><option value="">— load —</option></select></div>
      <div class="mt-pop-foot"><button class="mt-btn" id="mt-opt-save">OK</button></div>`;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - 60) + 'px';
    pop.style.top = (r.top - 200) + 'px';
    document.body.appendChild(pop);
    pop.querySelector('#mt-remind').value = String(o.remindDays || 0);

    // templates fill
    chrome.runtime.sendMessage({ type: 'MT_TEMPLATES' }, (res) => {
      if (chrome.runtime.lastError) return;
      const sel = pop.querySelector('#mt-tpl');
      (res && res.templates || []).forEach((t) => {
        const op = document.createElement('option'); op.value = t.id; op.textContent = t.name; sel.appendChild(op);
      });
      sel.addEventListener('change', () => {
        const t = (res.templates || []).find((x) => String(x.id) === sel.value);
        if (!t) return;
        o.template = t.name;
        const sub = dialog.querySelector('input[name="subjectbox"]');
        if (sub && t.subject) sub.value = t.subject;
        const bodyEl = dialog.querySelector('[role="textbox"][contenteditable="true"], [g_editable="true"][contenteditable="true"]');
        if (bodyEl && t.body) bodyEl.innerHTML = t.body + bodyEl.innerHTML;
        toast('Template "' + t.name + '" loaded');
      });
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.querySelector('#mt-opt-save').addEventListener('click', () => {
      o.tags = pop.querySelector('#mt-tags').value.trim();
      o.remindDays = Number(pop.querySelector('#mt-remind').value) || 0;
      anchor.dataset.on = (o.tags || o.remindDays || o.template) ? '1' : '0';
      pop.remove();
    });
    const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  // ========================================================================
  //  Status bar on an opened email  +  reply detection  +  thread id
  // ========================================================================
  let lastThreadKey = '';
  function watchOpenThread() {
    // a thread is open when the subject header (h2.hP) is present
    const h = document.querySelector('h2.hP');
    if (!h) { lastThreadKey = ''; removeStatusBar(); return; }
    const subject = (h.textContent || '').trim();
    const key = location.hash + '|' + subject;

    // --- (a) if this opened email has our pixel, show the status bar ---
    showOpenedStatus(h);

    // --- (b) reply detection: messages in the thread from other people ---
    if (key !== lastThreadKey) {
      lastThreadKey = key;
      detectReplies(subject);
    }
  }

  function showOpenedStatus(h) {
    // find the pixel id (only ours)
    let id = null;
    document.querySelectorAll('.a3s img').forEach((img) => {
      const m = (img.getAttribute('src') || '').match(/\/p\/([\w-]+)\.png/);
      if (m) id = m[1];
    });
    if (!id) { removeStatusBar(); return; }

    chrome.runtime.sendMessage({ type: 'MT_EMAILS', limit: 400 }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      const e = (res.emails || []).find((x) => x.id === id);
      if (!e) { removeStatusBar(); return; }

      // capture the thread id opportunistically (improves reply matching)
      const tEl = document.querySelector('[data-thread-perm-id]');
      const tid = tEl && tEl.getAttribute('data-thread-perm-id');
      if (tid && !e._mtThreadSent) {
        e._mtThreadSent = true;
        chrome.runtime.sendMessage({ type: 'MT_PATCH', id, data: { thread_id: tid } }, () => void chrome.runtime.lastError);
      }

      let bar = document.getElementById('mt-statusbar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'mt-statusbar';
        bar.className = 'mt-statusbar';
        h.parentElement.insertBefore(bar, h.nextSibling);
      }
      const opens = e.open_count || 0;
      const last = e.last_open ? timeAgo(e.last_open) : '';
      if (e.bounced) bar.innerHTML = '⚠ <b>Bounced</b> — did not reach the recipient';
      else if (opens > 0) bar.innerHTML = `✓✓ <b>Opened ${opens} time${opens > 1 ? 's' : ''}</b>${last ? ' · last ' + last : ''}` +
        (e.click_count ? ` · ${e.click_count} link click` : '') + (opens >= 3 ? ' · 🔥 Hot lead' : '') +
        (e.replied ? ' · ↩ replied' : '');
      else bar.innerHTML = '⌛ <b>Not opened yet</b> — the recipient has not seen it';
    });
  }
  function removeStatusBar() { const b = document.getElementById('mt-statusbar'); if (b) b.remove(); }

  function detectReplies(subject) {
    if (!/^\s*re\s*:/i.test(subject)) return; // only check reply threads
    // thread senders (other than me)
    const owner = (detectSender(document) || STATE.owner || '').toLowerCase();
    const senders = new Set();
    document.querySelectorAll('span.gD[email], span[email]').forEach((s) => {
      const em = (s.getAttribute('email') || '').toLowerCase();
      if (em && em !== owner) senders.add(em);
    });
    senders.forEach((from) => {
      chrome.runtime.sendMessage({ type: 'MT_REPLIED', data: { from, subject, owner } }, () => void chrome.runtime.lastError);
    });
  }

  function timeAgo(ms) {
    const d = Date.now() - ms;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + ' min ago';
    if (d < 86400000) return Math.floor(d / 3600000) + ' hr ago';
    return Math.floor(d / 86400000) + ' days ago';
  }

  setInterval(watchOpenThread, 2000);

})();
