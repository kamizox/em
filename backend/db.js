// db.js — SQLite via Node's built-in node:sqlite (Node 22.5+). ZERO npm install.
//
// Tables:
//   emails  -> every sent email (tracking id, subject, recipient, sent time)
//   opens   -> each pixel load (open event)
//   clicks  -> each tracked link click

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tracker.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS emails (
    id          TEXT PRIMARY KEY,
    owner       TEXT,
    subject     TEXT,
    recipient   TEXT,
    sent_at     INTEGER NOT NULL,
    delivered   INTEGER DEFAULT 0,
    bounced     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS opens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id    TEXT NOT NULL,
    opened_at   INTEGER NOT NULL,
    user_agent  TEXT,
    ip          TEXT,
    is_proxy    INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id    TEXT NOT NULL,
    url         TEXT NOT NULL,
    clicked_at  INTEGER NOT NULL,
    user_agent  TEXT,
    ip          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_opens_email  ON opens(email_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_email ON clicks(email_id);
  CREATE INDEX IF NOT EXISTS idx_emails_owner ON emails(owner);
`);

// New columns (also works on an old DB — ignore the error if a column already exists)
for (const col of [
  'replied INTEGER DEFAULT 0',
  'replied_at INTEGER',
  'tags TEXT',
  'remind_at INTEGER',
  'reminded INTEGER DEFAULT 0',
  'scheduled INTEGER DEFAULT 0',
  'thread_id TEXT',
  'template TEXT',
]) {
  try { db.exec(`ALTER TABLE emails ADD COLUMN ${col}`); } catch (_) {}
}

// Templates — emails sent repeatedly
db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    subject    TEXT,
    body       TEXT,
    created_at INTEGER NOT NULL
  );
`);

const stmts = {
  insertEmail: db.prepare(`INSERT INTO emails (id, owner, subject, recipient, sent_at, scheduled, tags, template, remind_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  setThread:   db.prepare(`UPDATE emails SET thread_id = ? WHERE id = ? AND (thread_id IS NULL OR thread_id = '')`),
  listTemplates:  db.prepare(`SELECT * FROM templates ORDER BY name`),
  insertTemplate: db.prepare(`INSERT INTO templates (name, subject, body, created_at) VALUES (?, ?, ?, ?)
                              ON CONFLICT(name) DO UPDATE SET subject = excluded.subject, body = excluded.body`),
  deleteTemplate: db.prepare(`DELETE FROM templates WHERE id = ?`),
  setTags:     db.prepare(`UPDATE emails SET tags = ? WHERE id = ?`),
  setRemind:   db.prepare(`UPDATE emails SET remind_at = ?, reminded = 0 WHERE id = ?`),
  setReplied:  db.prepare(`UPDATE emails SET replied = ?, replied_at = ? WHERE id = ?`),
  replyCandidates: db.prepare(`SELECT id, owner, subject, recipient, sent_at FROM emails WHERE replied = 0 AND lower(recipient) LIKE ? ORDER BY sent_at DESC LIMIT 50`),
  allOpens:    db.prepare(`SELECT email_id, opened_at, is_proxy FROM opens ORDER BY opened_at ASC`),
  dueReminders: db.prepare(`
    SELECT e.* FROM emails e
    WHERE e.remind_at IS NOT NULL AND e.remind_at <= ? AND e.reminded = 0 AND e.replied = 0
      AND NOT EXISTS (SELECT 1 FROM opens o WHERE o.email_id = e.id)`),
  markReminded: db.prepare(`UPDATE emails SET reminded = 1 WHERE id = ?`),
  getEmail:    db.prepare(`SELECT * FROM emails WHERE id = ?`),
  insertOpen:  db.prepare(`INSERT INTO opens (email_id, opened_at, user_agent, ip, is_proxy) VALUES (?, ?, ?, ?, ?)`),
  insertClick: db.prepare(`INSERT INTO clicks (email_id, url, clicked_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)`),
  setDelivered: db.prepare(`UPDATE emails SET delivered = ?, bounced = ? WHERE id = ?`),
  deleteRecentOpens: db.prepare(`DELETE FROM opens WHERE email_id = ? AND opened_at >= ?`),
  deleteOpens:  db.prepare(`DELETE FROM opens WHERE email_id = ?`),
  deleteClicks: db.prepare(`DELETE FROM clicks WHERE email_id = ?`),
  deleteEmail:  db.prepare(`DELETE FROM emails WHERE id = ?`),

  listEmailsAll: db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM opens  o WHERE o.email_id = e.id)                    AS open_count,
      (SELECT COUNT(*) FROM opens  o WHERE o.email_id = e.id)                    AS open_count_all,
      (SELECT COUNT(*) FROM clicks c WHERE c.email_id = e.id)                    AS click_count,
      (SELECT MIN(opened_at) FROM opens o WHERE o.email_id = e.id) AS first_open,
      (SELECT MAX(opened_at) FROM opens o WHERE o.email_id = e.id) AS last_open
    FROM emails e
    ORDER BY e.sent_at DESC LIMIT ?
  `),
  listEmailsOwner: db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM opens  o WHERE o.email_id = e.id)                    AS open_count,
      (SELECT COUNT(*) FROM opens  o WHERE o.email_id = e.id)                    AS open_count_all,
      (SELECT COUNT(*) FROM clicks c WHERE c.email_id = e.id)                    AS click_count,
      (SELECT MIN(opened_at) FROM opens o WHERE o.email_id = e.id) AS first_open,
      (SELECT MAX(opened_at) FROM opens o WHERE o.email_id = e.id) AS last_open
    FROM emails e
    WHERE e.owner = ?
    ORDER BY e.sent_at DESC LIMIT ?
  `),
  emailOpens:  db.prepare(`SELECT * FROM opens  WHERE email_id = ? ORDER BY opened_at ASC`),
  emailClicks: db.prepare(`SELECT * FROM clicks WHERE email_id = ? ORDER BY clicked_at ASC`),

  statsAll: db.prepare(`
    SELECT COUNT(*) AS total_sent,
      SUM(CASE WHEN (SELECT COUNT(*) FROM opens o WHERE o.email_id = e.id) > 0 THEN 1 ELSE 0 END) AS total_opened,
      SUM(CASE WHEN (SELECT COUNT(*) FROM clicks c WHERE c.email_id = e.id) > 0 THEN 1 ELSE 0 END) AS total_clicked,
      SUM(bounced) AS total_bounced
    FROM emails e
  `),
  statsOwner: db.prepare(`
    SELECT COUNT(*) AS total_sent,
      SUM(CASE WHEN (SELECT COUNT(*) FROM opens o WHERE o.email_id = e.id) > 0 THEN 1 ELSE 0 END) AS total_opened,
      SUM(CASE WHEN (SELECT COUNT(*) FROM clicks c WHERE c.email_id = e.id) > 0 THEN 1 ELSE 0 END) AS total_clicked,
      SUM(bounced) AS total_bounced
    FROM emails e WHERE e.owner = ?
  `),
};

module.exports = { db, stmts };
