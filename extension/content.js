/* content.js — Gmail ke andar chalta hai.
 *
 * Kaam:
 *  1. Compose window dhoondo (DOM observe kar ke).
 *  2. Har compose mein ek toolbar toggle lagao: "Track" ON/OFF.
 *  3. Send ke waqt (agar Track ON): unique id banao, body ke links wrap karo,
 *     body ke aakhir mein 1x1 pixel lagao, aur server par email register karo.
 *  4. Sent emails ki list mein ✓ / ✓✓ / open-count badge dikhao.
 *
 * NOTE: Gmail apni classes aksar badalta hai. Is liye hum robust selectors
 *       (role attributes, aria-labels) use karte hain, class names par kam depend karte hain.
 */

(function () {
  'use strict';
  const VERSION = '1.5';

  const STATE = {
    serverUrl: '',   // API base — localhost bhi chalega, ye extension hi use karti hai
    publicUrl: '',   // pixel/link base — tunnel ya deployed URL, server se aata hai
    owner: '',
    trackDefault: true,
  };

  // Email ke andar jo URL jata hai. Public URL zaroori hai: pixel Gmail ke
  // image proxy (Google ke server) se load hota hai, wo localhost tak nahi pohanch sakta.
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
    setTimeout(boot, 0); // IIFE poora load hone ke baad
  });

  function boot() {
    rlog('boot', { v: VERSION, server: STATE.serverUrl, owner: STATE.owner, trackDefault: STATE.trackDefault });
    if (!STATE.serverUrl) {
      console.warn('[MailTracker] Server URL set nahi hai. Extension options kholo.');
    }
    refreshConfig();
    setInterval(refreshConfig, 30000); // tunnel badle to khud pakad lega
    observeCompose();
    // Sent list badges har kuch second refresh karo
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

  // ---------- remote log (server ki .run/ext.log mein jata hai, debugging ke liye) ----------
  function rlog(...a) {
    const msg = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    console.log('[MailTracker]', msg);
    try { chrome.runtime.sendMessage({ type: 'MT_LOG', msg }, () => void chrome.runtime.lastError); } catch (_) {}
  }

  // ---------- compose window detect ----------
  // FIX: pehle sirf [role="dialog"] dhoondte the. Gmail ka neeche-right wala compose
  // aur inline reply hamesha role=dialog nahi hote, is liye compose kabhi milta hi nahi tha.
  // Ab seedha editable body dhoondte hain aur upar chadh kar woh container lete hain
  // jis mein Send button ho.
  function observeCompose() {
    scanDialogs();
    setInterval(scanDialogs, 1000);
    // Document level backup: koi bhi Send button dabe (mousedown) to tracking lagao
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest && e.target.closest('[role="button"]');
      if (!btn || !isSendButton(btn)) return;
      const box = composeOf(btn);
      rlog('send mousedown', { haveBox: !!box, ready: box?.dataset.mtReady || null });
      if (box && box._mtHandler) box._mtHandler(e);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'Enter')) return;
      const box = composeOf(e.target);
      rlog('ctrl+enter', { haveBox: !!box });
      if (box && box._mtHandler) box._mtHandler(e);
    }, true);
  }

  function editableBodies() {
    // Sirf asli email body. Gmail ka Gemini "Describe your message" box bhi
    // contenteditable textbox hai — us mein pixel gaya to email mein nahi jata.
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

  // body se upar chalo jab tak aisa element na mile jis mein Send button ho
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

  // Gmail ka Send button — tooltip/aria-label localize ho sakta hai, is liye
  // kayi tareeqe try karte hain. ("Send later"/"More send options" ko chhor ke)
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
    rlog('compose mila, Track chip laga di', { v: VERSION, server: STATE.serverUrl, public: STATE.publicUrl, track: STATE.trackDefault });
    refreshConfig(); // compose khulte hi taaza URL le lo, send se pehle

    // --- Track toggle chip banao ---
    const chip = document.createElement('div');
    chip.className = 'mt-chip';
    chip.dataset.on = STATE.trackDefault ? '1' : '0';
    chip.innerHTML = `<span class="mt-dot"></span><span class="mt-label">Track</span>`;
    chip.title = 'Is email ka open/click track karein';
    chip.addEventListener('click', () => {
      chip.dataset.on = chip.dataset.on === '1' ? '0' : '1';
    });
    const toolbar = sendBtn.parentElement;
    if (toolbar) toolbar.appendChild(chip);

    // --- Send intercept ---
    // FIX: Gmail Send button MOUSEUP par bhej deta hai; 'click' us ke baad aata hai
    // ya aata hi nahi. Is liye document-level mousedown / Ctrl+Enter se ye chalta hai.
    dialog._mtHandler = () => {
      if (chip.dataset.on !== '1') return rlog('skip: track OFF');
      if (!STATE.serverUrl) return rlog('skip: server URL khaali');
      if (dialog.dataset.mtInjected) return; // ek email mein sirf ek dafa
      dialog.dataset.mtInjected = '1';
      try {
        injectTracking(dialog, body);
      } catch (e) {
        rlog('inject fail: ' + (e && e.message));
      }
    };
  }

  // ---------- self-view: apni hi email kholne ko "open" mat gino ----------
  // Jab aap Sent/Inbox mein apni bheji email kholte ho to Gmail pixel load karta hai
  // aur server usay "Kholi" samajh leta. Ye function khuli hui email mein hamara
  // pixel dhoondta hai aur server ko batata hai ke ye view aapka tha.
  const SELF_SEEN = new WeakSet(); // har naya render ki gayi img ek dafa report
  function reportSelfViews() {
    const base = trackBase();
    if (!base) return;
    // Compose ke andar wali img nahi — sirf padhi ja rahi emails (.a3s = message body)
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
      console.log('[MailTracker] self-view ignore:', id);
    });
  }
  setInterval(reportSelfViews, 1500);

  // ---------- dashboard se aaye: sent email seedha kholo ----------
  // Dashboard Gmail ko window name "mt-open-<id>" ke sath kholta hai (search URL).
  // Search mein sirf 1 email mile to us par khud click kar do.
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
        rlog('dashboard se email kholi');
      } else if (tries > 30) {
        clearInterval(t);
        window.name = '';
      }
    }, 500);
  }
  autoOpenFromDashboard();

  // ---------- tracking inject ----------
  function injectTracking(dialog, body) {
    const id = makeId();
    // Send button wala container chhota hota hai — Subject/To us se upar hote hain.
    const root = composeRoot(dialog);
    const subject = (root.querySelector('input[name="subjectbox"]')?.value)
      || (document.querySelector('h2.hP')?.textContent) || '(no subject)';
    const recipient = extractRecipients(root);

    // 1) Links wrap karo (click tracking)
    wrapLinks(body, id);

    // 2) Pixel lagao (body ke sab se aakhir mein)
    const pixel = document.createElement('img');
    pixel.src = `${trackBase()}/p/${id}.png`;
    pixel.width = 1;
    pixel.height = 1;
    pixel.style.cssText = 'width:1px;height:1px;border:0;opacity:0;';
    pixel.alt = '';
    body.appendChild(pixel);

    // 3) Server par register karo — background service worker ke zariye.
    //    Seedha yahan se fetch/sendBeacon kaam nahi karta: Gmail https page hai aur
    //    localhost private network, Chrome usay block kar deta hai.
    chrome.runtime.sendMessage(
      { type: 'MT_REGISTER', data: { id, owner: detectSender(root), subject, recipient, sentAt: Date.now() } },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const why = chrome.runtime.lastError?.message || res?.error || 'unknown';
          rlog('register fail: ' + why);
          toast('⚠ Tracking register nahi hui: ' + why, true);
        } else {
          rlog('tracked', { id, base: trackBase(), subject });
          if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(trackBase())) {
            // localhost pixel Gmail ke proxy se load nahi ho sakta
            toast('⚠ Tracking lagi, par public URL nahi hai — opens record nahi honge', true);
          } else {
            toast('✓ Tracking lag gayi');
          }
        }
      }
    );
  }

  // chhota sa corner toast — taake pata chale tracking lagi ya nahi
  function toast(text, isError) {
    const el = document.createElement('div');
    el.className = 'mt-toast' + (isError ? ' mt-toast-err' : '');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // Kis account se bheji — Gmail khud batata hai (tab title / account button / From field).
  // Is liye har profile/account mein options ka "owner" bharne ki zaroorat nahi.
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

  // Poora compose (Subject + To + body) — [role=dialog], warna upar chadh kar subjectbox dhoondo
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
    // "To" field ke recipients — chips mein email hota hai
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
      // apne hi server ke links double-wrap na karo
      if (orig.includes(trackBase())) return;
      a.href = `${trackBase()}/r/${id}?u=${encodeURIComponent(orig)}`;
      a.dataset.mtWrapped = '1';
    });
  }

  // ---------- sent list badges ----------
  async function decorateSentList() {
    if (!STATE.serverUrl) return;
    // sirf tab chalao jab list view ho
    const rows = document.querySelectorAll('tr[role="row"], div[role="listitem"]');
    if (!rows.length) return;

    // fetch bhi background se — wahi private-network wajah
    let data;
    try {
      data = await chrome.runtime.sendMessage({ type: 'MT_EMAILS', limit: 300 });
    } catch (_) { return; }
    if (!data || !data.emails) return;

    const bySubject = {};
    (data.emails || []).forEach((e) => {
      const key = normalize(e.subject);
      // same subject ki sab se nayi email rakho
      if (!bySubject[key] || e.sent_at > bySubject[key].sent_at) bySubject[key] = e;
    });

    rows.forEach((row) => {
      const subjEl = row.querySelector('[data-thread-id] span, span[data-thread-id], .bog, span');
      const subjText = (row.innerText || '').trim();
      if (!subjText) return;

      // match: koi tracked subject is row ke text mein aata hai?
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
      mark = '⚠'; cls = 'mt-bounced'; title = 'Bounce hui — recipient tak nahi pohanchi';
    } else if (opened) {
      mark = '✓✓'; cls = 'mt-opened';
      title = `Khuli ${e.open_count} dafa` + (clicks ? ` · ${clicks} click` : '');
    } else {
      mark = '✓'; cls = 'mt-sent'; title = 'Bheji gayi — abhi tak nahi kholi';
    }
    badge.textContent = mark + (opened && e.open_count > 1 ? ` ${e.open_count}` : '');
    badge.className = `mt-badge ${cls}`;
    badge.title = title;
  }

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/^(re:|fwd:)\s*/i, '').trim().slice(0, 60);
  }
})();
