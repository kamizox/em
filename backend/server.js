// server.js — Email Tracker backend. ZERO dependencies (Node built-in http + node:sqlite).
// Run: node server.js   (Node 22.5+)
//
// Endpoints:
//   GET  /p/:id.png       -> tracking pixel (open log)
//   GET  /r/:id?u=<url>    -> link redirect (click log -> asli url)
//   POST /api/register     -> extension email register karti hai
//   POST /api/delivered    -> delivered/bounced status
//   GET  /api/emails       -> list + counts (?owner= &limit=)
//   GET  /api/emails/:id   -> ek email ki detail
//   GET  /api/stats        -> summary (?owner=)
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

// start.ps1 tunnel ka URL yahan likhta hai. Agar file nahi hai to PUBLIC_URL env,
// warna khaali — us soorat mein extension localhost hi use karegi.
const PUBLIC_URL_FILE = path.join(__dirname, 'public-url.txt');
function publicUrl() {
  try {
    // ﻿ = BOM, agar file Windows se BOM ke sath likhi gayi ho
    const v = fs.readFileSync(PUBLIC_URL_FILE, 'utf8').replace(/^﻿/, '').trim();
    if (v) return v.replace(/\/+$/, '');
  } catch {}
  return (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
}

// Sender ne apni hi email kholi (extension batati hai) — us waqt ke aas paas ka
// pixel hit "open" nahi hai. Pixel request extension ke message se pehle ya baad,
// dono tarah aa sakti hai, is liye dono taraf window rakhte hain.
const SELF_VIEW_WINDOW_MS = 30 * 1000;
const selfViews = new Map(); // id -> last self-view time
function recentSelfView(id, now) {
  const t = selfViews.get(id);
  return t != null && now - t < SELF_VIEW_WINDOW_MS;
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
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' });
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
      if (stmts.getEmail.get(id)) stmts.insertClick.run(id, safe, Date.now(), req.headers['user-agent'] || '', clientIp(req));
    } catch (e) { console.error('click:', e.message); }
    res.writeHead(302, { Location: safe });
    return res.end();
  }

  // ---------- API ----------
  if (pathn === '/api/register' && method === 'POST') {
    const b = await readBody(req);
    if (!b.id) return sendJson(res, 400, { error: 'id required' });
    try {
      stmts.insertEmail.run(b.id, b.owner || null, b.subject || '(no subject)', b.recipient || null, Date.now());
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
    // agar pixel hit pehle aa chuka tha to wo open hata do
    try { stmts.deleteRecentOpens.run(b.id, now - SELF_VIEW_WINDOW_MS); } catch (e) { console.error('selfview:', e.message); }
    return sendJson(res, 200, { ok: true });
  }

  // Email (aur us ke opens/clicks) delete — sirf localhost se (tunnel se nahi)
  if (pathn.startsWith('/api/emails/') && method === 'DELETE') {
    const fromTunnel = !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
    if (fromTunnel) return sendJson(res, 403, { error: 'sirf localhost se' });
    const id = decodeURIComponent(pathn.slice('/api/emails/'.length));
    try { stmts.deleteOpens.run(id); stmts.deleteClicks.run(id); stmts.deleteEmail.run(id); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
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

  // Public URL — pixel aur link tracking ke liye. Extension ye yahan se puchti hai,
  // taake tunnel restart hone par options mein haath lagane ki zaroorat na pade.
  // File har request par fresh padhi jati hai, is liye server restart bhi nahi chahiye.
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
    return res.end('<h2>Email Tracker backend chal raha hai ✓</h2><p><a href="/dashboard">Dashboard kholo</a></p>');
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
