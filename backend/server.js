// server.js — Email Tracker backend. ZERO dependencies (Node built-in http + node:sqlite).
// Run: node server.js   (Node 22.5+)
//
// Endpoints:
//   GET  /p/:id.png       -> tracking pixel (open log)
//   GET  /r/:id?u=<url>    -> link redirect (click log -> asli url)
//   POST /api/register     -> the extension registers an email
//   POST /api/delivered    -> delivered/bounced status
//   GET  /api/emails       -> list + counts (?owner= &limit=)
//   GET  /api/emails/:id   -> details of one email
//   GET  /api/stats        -> summary (?owner=)
//   PATCH /api/emails/:id  -> tags / remind_days / replied / thread_id
//   DELETE /api/emails/:id -> (localhost only)
//   POST /api/replied      -> extension: reply mila
//   GET  /api/opens        -> all opens, for the chart
//   GET  /api/reminders/due-> follow-up reminders
//   GET/POST/DELETE /api/templates
//   GET  /api/events       -> live update (SSE)
//   GET  /api/health
//   /dashboard/*           -> static dashboard

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { stmts } = require('./db');

const PORT = process.env.PORT || 3000;
const SELF_OPEN_GUARD_MS = 15 * 1000; // send ke 15 sec tak ke opens ignore (self-open)
const DASH_DIR = path.join(__dirname, '..', 'dashboard');

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

// start.ps1 writes the tunnel URL here. If the file is missing, PUBLIC_URL env is used,
// otherwise empty — in which case the extension just uses localhost.
const PUBLIC_URL_FILE = path.join(__dirname, 'public-url.txt');
function publicUrl() {
  try {
    // ﻿ = BOM, in case the file was written with a BOM on Windows
    const v = fs.readFileSync(PUBLIC_URL_FILE, 'utf8').replace(/^﻿/, '').trim();
    if (v) return v.replace(/\/+$/, '');
  } catch {}
  return (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
}

// The sender opened their own email (the extension tells us) — a pixel hit around that
// time is not a real "open". The pixel request can arrive either before or after the
// extension's message, so we keep a window on both sides.
const SELF_VIEW_WINDOW_MS = 30 * 1000;
const selfViews = new Map(); // id -> last self-view time
function recentSelfView(id, now) {
  const t = selfViews.get(id);
  return t != null && now - t < SELF_VIEW_WINDOW_MS;
}

// ---------- Live update (Server-Sent Events) ----------
// Dashboard /api/events se juda rehta hai; open/click/nayi email par foran khabar.
const sseClients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch (_) {} }
}
setInterval(() => { for (const res of sseClients) { try { res.write(': ping\n\n'); } catch (_) {} } }, 25000);

// For subject comparison: "Re: Fwd: Hello" -> "hello"
function normSubject(s) {
  return String(s || '').toLowerCase().replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
}

function looksLikeProxy(ua = '') {
  const u = ua.toLowerCase();
  return u.includes('googleimageproxy') || u.includes('ggpht') || u.includes('google-read-aloud') || (u.includes('applemail') && u.includes('maskedip'));
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathn = u.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
    return res.end();
  }

  // ---------- PIXEL ----------
  if (method === 'GET' && /^\/p\/[\w-]+\.png$/.test(pathn)) {
    const id = pathn.slice(3, -4); // /p/<id>.png
    const ua = req.headers['user-agent'] || '';
    try {
      const email = stmts.getEmail.get(id);
      if (email) {
        const now = Date.now();
        const since = now - email.sent_at;
        const isSelf = (since >= 0 && since < SELF_OPEN_GUARD_MS) || recentSelfView(id, now);
        if (!isSelf) {
          stmts.insertOpen.run(id, now, ua, clientIp(req), looksLikeProxy(ua) ? 1 : 0);
          broadcast('open', { id, subject: email.subject, recipient: email.recipient, owner: email.owner });
        }
      }
    } catch (e) { console.error('pixel:', e.message); }
    res.writeHead(200, {
      'Content-Type': 'image/png', 'Content-Length': PIXEL.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'Pragma': 'no-cache', 'Expires': '0',
    });
    return res.end(PIXEL);
  }

  // ---------- LINK REDIRECT ----------
  if (method === 'GET' && /^\/r\/[\w-]+$/.test(pathn)) {
    const id = pathn.slice(3);
    const target = u.searchParams.get('u');
    let safe = null;
    try { const p = new URL(target); if (p.protocol === 'http:' || p.protocol === 'https:') safe = p.toString(); } catch {}
    if (!safe) { res.writeHead(400); return res.end('Invalid link'); }
    try {
      const em = stmts.getEmail.get(id);
      if (em) {
        stmts.insertClick.run(id, safe, Date.now(), req.headers['user-agent'] || '', clientIp(req));
        broadcast('click', { id, subject: em.subject, recipient: em.recipient, url: safe });
      }
    } catch (e) { console.error('click:', e.message); }
    res.writeHead(302, { Location: safe });
    return res.end();
  }

  // ---------- API ----------
  if (pathn === '/api/register' && method === 'POST') {
    const b = await readBody(req);
    if (!b.id) return sendJson(res, 400, { error: 'id required' });
    try {
      const tags = String(b.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10).join(', ') || null;
      const rd = Number(b.remind_days);
      stmts.insertEmail.run(b.id, b.owner || null, b.subject || '(no subject)', b.recipient || null, Date.now(),
        b.scheduled ? 1 : 0, tags, b.template ? String(b.template).slice(0, 100) : null, rd > 0 ? Date.now() + rd * 86400000 : null);
      broadcast('register', { id: b.id });
      return sendJson(res, 200, { ok: true, id: b.id });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return sendJson(res, 200, { ok: true, id: b.id, note: 'already' });
      return sendJson(res, 500, { error: e.message });
    }
  }

  // Extension ke debug logs -> .run/ext.log
  if (pathn === '/api/log' && method === 'POST') {
    const b = await readBody(req);
    const line = `${new Date().toISOString()} ${String(b.msg || '').slice(0, 500)}\n`;
    fs.appendFile(path.join(__dirname, '..', '.run', 'ext.log'), line, () => {});
    return sendJson(res, 200, { ok: true });
  }

  if (pathn === '/api/selfview' && method === 'POST') {
    const b = await readBody(req);
    if (!b.id) return sendJson(res, 400, { error: 'id required' });
    const now = Date.now();
    selfViews.set(b.id, now);
    // if a pixel hit already arrived, remove that open
    try {
      const r = stmts.deleteRecentOpens.run(b.id, now - SELF_VIEW_WINDOW_MS);
      if (r && r.changes) broadcast('update', { id: b.id });
    } catch (e) { console.error('selfview:', e.message); }
    return sendJson(res, 200, { ok: true });
  }

  // Delete an email (and its opens/clicks) — from localhost only (not the tunnel)
  if (pathn.startsWith('/api/emails/') && method === 'DELETE') {
    const fromTunnel = !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
    if (fromTunnel) return sendJson(res, 403, { error: 'localhost only' });
    const id = decodeURIComponent(pathn.slice('/api/emails/'.length));
    try { stmts.deleteOpens.run(id); stmts.deleteClicks.run(id); stmts.deleteEmail.run(id); broadcast('update', { id }); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // Tags / reminder / reply status badlo (dashboard se)
  if (pathn.startsWith('/api/emails/') && method === 'PATCH') {
    const id = decodeURIComponent(pathn.slice('/api/emails/'.length));
    const b = await readBody(req);
    try {
      if (!stmts.getEmail.get(id)) return sendJson(res, 404, { error: 'not found' });
      if (b.tags !== undefined) {
        const tags = String(b.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10).join(', ');
        stmts.setTags.run(tags || null, id);
      }
      if (b.remind_days !== undefined) {
        const d = Number(b.remind_days);
        stmts.setRemind.run(d > 0 ? Date.now() + d * 86400000 : null, id);
      }
      if (b.replied !== undefined) stmts.setReplied.run(b.replied ? 1 : 0, b.replied ? Date.now() : null, id);
      if (b.thread_id) stmts.setThread.run(String(b.thread_id).slice(0, 100), id);
      broadcast('update', { id });
      return sendJson(res, 200, { ok: true, email: stmts.getEmail.get(id) });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // The extension sees "Re: <subject>" in the inbox and reports it here
  if (pathn === '/api/replied' && method === 'POST') {
    const b = await readBody(req);
    const from = String(b.from || '').toLowerCase().trim();
    const subj = normSubject(b.subject);
    if (!from || !subj) return sendJson(res, 400, { error: 'from + subject required' });
    try {
      const cands = stmts.replyCandidates.all(`%${from}%`);
      const hit = cands.find((c) => normSubject(c.subject) === subj && (!b.owner || !c.owner || c.owner === b.owner));
      if (!hit) return sendJson(res, 200, { ok: true, matched: false });
      stmts.setReplied.run(1, Date.now(), hit.id);
      broadcast('replied', { id: hit.id, subject: hit.subject, recipient: hit.recipient });
      return sendJson(res, 200, { ok: true, matched: true, id: hit.id });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // Templates
  if (pathn === '/api/templates' && method === 'GET') {
    try { return sendJson(res, 200, { templates: stmts.listTemplates.all() }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  if (pathn === '/api/templates' && method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 100);
    if (!name) return sendJson(res, 400, { error: 'name required' });
    try {
      stmts.insertTemplate.run(name, String(b.subject || '').slice(0, 300), String(b.body || '').slice(0, 50000), Date.now());
      broadcast('templates', {});
      return sendJson(res, 200, { ok: true });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  if (pathn.startsWith('/api/templates/') && method === 'DELETE') {
    const id = Number(pathn.slice('/api/templates/'.length));
    try { stmts.deleteTemplate.run(id); broadcast('templates', {}); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // All opens — for the chart (day/hour)
  if (pathn === '/api/opens' && method === 'GET') {
    try { return sendJson(res, 200, { opens: stmts.allOpens.all() }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // Follow-up reminders that are now due (and the email is still unopened)
  if (pathn === '/api/reminders/due' && method === 'GET') {
    try {
      const due = stmts.dueReminders.all(Date.now());
      due.forEach((e) => stmts.markReminded.run(e.id));
      if (due.length) broadcast('reminder', { emails: due.map((e) => ({ id: e.id, subject: e.subject, recipient: e.recipient })) });
      return sendJson(res, 200, { emails: due });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // Live update stream
  if (pathn === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (pathn === '/api/delivered' && method === 'POST') {
    const b = await readBody(req);
    if (!b.id) return sendJson(res, 400, { error: 'id required' });
    try { stmts.setDelivered.run(b.delivered ? 1 : 0, b.bounced ? 1 : 0, b.id); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathn === '/api/emails' && method === 'GET') {
    const owner = u.searchParams.get('owner');
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '200', 10), 1000);
    try {
      const rows = owner ? stmts.listEmailsOwner.all(owner, limit) : stmts.listEmailsAll.all(limit);
      return sendJson(res, 200, { emails: rows });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathn.startsWith('/api/emails/') && method === 'GET') {
    const id = pathn.slice('/api/emails/'.length);
    try {
      const email = stmts.getEmail.get(id);
      if (!email) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { email, opens: stmts.emailOpens.all(id), clicks: stmts.emailClicks.all(id) });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathn === '/api/stats' && method === 'GET') {
    const owner = u.searchParams.get('owner');
    try {
      const s = owner ? stmts.statsOwner.get(owner) : stmts.statsAll.get();
      const sent = s.total_sent || 0;
      return sendJson(res, 200, {
        total_sent: sent, total_opened: s.total_opened || 0, total_clicked: s.total_clicked || 0, total_bounced: s.total_bounced || 0,
        open_rate: sent ? Math.round((s.total_opened / sent) * 100) : 0,
        click_rate: sent ? Math.round((s.total_clicked / sent) * 100) : 0,
      });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // Public URL — for pixel and link tracking. The extension asks for it here,
  // so there's no need to touch the options when the tunnel restarts.
  // The file is read fresh on every request, so a server restart isn't needed either.
  if (pathn === '/api/config' && method === 'GET') {
    return sendJson(res, 200, { publicUrl: publicUrl() });
  }

  if (pathn === '/api/health') return sendJson(res, 200, { ok: true, ts: Date.now() });

  // ---------- DASHBOARD static ----------
  if (pathn === '/dashboard' || pathn === '/dashboard/') {
    return serveStatic(res, path.join(DASH_DIR, 'index.html'));
  }
  if (pathn.startsWith('/dashboard/')) {
    const rel = pathn.slice('/dashboard/'.length).replace(/\.\./g, '');
    return serveStatic(res, path.join(DASH_DIR, rel));
  }

  if (pathn === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h2>Email Tracker backend is running ✓</h2><p><a href="/dashboard">Open dashboard</a></p>');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

function serveStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`\n  Email Tracker backend -> http://localhost:${PORT}`);
  console.log(`  Dashboard             -> http://localhost:${PORT}/dashboard`);
  console.log(`  Pixel endpoint        -> http://localhost:${PORT}/p/<id>.png\n`);
});
