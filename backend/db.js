// db.js — SQLite via Node's built-in node:sqlite (Node 22.5+). ZERO npm install.
//
// Tables:
//   emails  -> har bheji gayi email (tracking id, subject, recipient, sent time)
//   opens   -> har pixel load (open event)
//   clicks  -> har tracked link click

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

const stmts = {
  insertEmail: db.prepare(`INSERT INTO emails (id, owner, subject, recipient, sent_at) VALUES (?, ?, ?, ?, ?)`),
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
