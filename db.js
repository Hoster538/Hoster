'use strict';
/* SQLite persistence: users (GitHub identities), sessions, deployments. */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'devhoster.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id     INTEGER NOT NULL UNIQUE,
  login         TEXT    NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  access_token  TEXT    NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name     TEXT NOT NULL,
  repo_url           TEXT NOT NULL,
  branch             TEXT NOT NULL,
  name               TEXT NOT NULL,
  provider_service_id TEXT NOT NULL,
  service_url        TEXT,
  status             TEXT NOT NULL DEFAULT 'deploying',
  kind               TEXT NOT NULL DEFAULT 'web',
  runtime            TEXT,
  uptime_monitor_id  TEXT,
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deployments_user ON deployments(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (github_id, login, name, avatar_url, access_token)
    VALUES (@github_id, @login, @name, @avatar_url, @access_token)
    ON CONFLICT(github_id) DO UPDATE SET
      login = excluded.login,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      access_token = excluded.access_token,
      last_login_at = datetime('now')
  `),
  getUserByGithubId: db.prepare('SELECT * FROM users WHERE github_id = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),

  createSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  createDeployment: db.prepare(`
    INSERT INTO deployments
      (user_id, repo_full_name, repo_url, branch, name, provider_service_id, service_url, status, kind, runtime)
    VALUES
      (@user_id, @repo_full_name, @repo_url, @branch, @name, @provider_service_id, @service_url, @status, @kind, @runtime)
  `),
  getDeployment: db.prepare('SELECT * FROM deployments WHERE id = ?'),
  listDeployments: db.prepare('SELECT * FROM deployments WHERE user_id = ? ORDER BY created_at DESC, id DESC'),
  countDeployments: db.prepare('SELECT COUNT(*) AS n FROM deployments WHERE user_id = ?'),
  deleteDeployment: db.prepare('DELETE FROM deployments WHERE id = ?'),
  pendingDeployments: db.prepare(`SELECT * FROM deployments WHERE status IN ('queued', 'building')`),

  sweepOrphanSessions: db.prepare(`DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)`),
};

function upsertGithubUser(gh, token) {
  stmts.upsertUser.run({
    github_id: gh.id,
    login: gh.login,
    name: gh.name || gh.login,
    avatar_url: gh.avatar_url || '',
    access_token: token,
  });
  return stmts.getUserByGithubId.get(gh.id);
}

function getSession(sid) {
  const s = stmts.getSession.get(sid);
  if (!s) return null;
  if (s.expires_at < Date.now()) { stmts.deleteSession.run(sid); return null; }
  return s;
}

function updateDeployment(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE deployments SET ${set}, updated_at = datetime('now') WHERE id = @__id`)
    .run({ ...fields, __id: id });
}

module.exports = {
  upsertGithubUser,
  getUserById: (id) => stmts.getUserById.get(id),
  createSession: (sid, userId, expiresAt) => stmts.createSession.run(sid, userId, expiresAt),
  getSession,
  deleteSession: (sid) => stmts.deleteSession.run(sid),
  cleanupSessions: () => { stmts.deleteExpiredSessions.run(Date.now()); stmts.sweepOrphanSessions.run(); },
  createDeployment: (row) => {
    const info = stmts.createDeployment.run(row);
    return stmts.getDeployment.get(info.lastInsertRowid);
  },
  getDeployment: (id) => stmts.getDeployment.get(Number(id)),
  listDeployments: (userId) => stmts.listDeployments.all(userId),
  countDeployments: (userId) => stmts.countDeployments.get(userId).n,
  deleteDeployment: (id) => stmts.deleteDeployment.run(Number(id)),
  pendingDeployments: () => stmts.pendingDeployments.all(),
  updateDeployment,
};
