'use strict';
// SQLite via Node's built-in driver (no native modules to compile).
//
// The database holds live state only: drafts being typed right now, links,
// and which changes the lead has accepted or rejected. Everything that matters
// long-term is committed to Git.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  remote_url TEXT NOT NULL,
  username TEXT,
  token TEXT,
  base_branch TEXT NOT NULL,
  push_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_path TEXT NOT NULL,
  title TEXT NOT NULL,
  branch TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  base_text TEXT NOT NULL,                       -- the round's current .qmd, comments included
  prose_version INTEGER NOT NULL DEFAULT 1,      -- bumps when the prose changes
  version INTEGER NOT NULL DEFAULT 1,            -- bumps on any change
  committed_version INTEGER NOT NULL DEFAULT 1,
  dirty_author_id INTEGER,                       -- lead whose edits are not yet committed
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('lead', 'reviewer')),
  token TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  copy_text TEXT,                    -- reviewer's private copy (prose only)
  copy_base TEXT,                    -- the round prose the copy started from
  copy_rev INTEGER NOT NULL DEFAULT 0,
  committed_rev INTEGER NOT NULL DEFAULT 0,
  rebased_onto TEXT,                 -- round commit to record as merge parent on next commit
  resolved TEXT NOT NULL DEFAULT '[]',
  orphans TEXT NOT NULL DEFAULT '[]',
  notices TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  member_id INTEGER,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

// Columns added after the first release; added to existing databases on start.
const ADDED_COLUMNS = {
  members: {
    status: "TEXT NOT NULL DEFAULT 'invited'", // invited | working | done
    done_at: 'TEXT', done_note: 'TEXT', invited_at: 'TEXT',
    seen_prose: 'TEXT', seen_at: 'TEXT', // what the round looked like at the last visit
  },
  rounds: {
    finished_at: 'TEXT', merged_at: 'TEXT', merged_commit: 'TEXT',
    previous_round_id: 'INTEGER', next_round_id: 'INTEGER',
  },
};

const JSON_COLUMNS = ['resolved', 'orphans', 'notices', 'data'];

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'quartorium.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  db.exec(CREATE_EVENTS);
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }

  const parse = (row) => {
    if (!row) return row;
    const out = { ...row };
    for (const c of JSON_COLUMNS) if (c in out) out[c] = JSON.parse(out[c]);
    return out;
  };

  return {
    raw: db,
    get: (sql, ...p) => parse(db.prepare(sql).get(...p)),
    all: (sql, ...p) => db.prepare(sql).all(...p).map(parse),
    run: (sql, ...p) => db.prepare(sql).run(...p),
    /** Update columns of one row. JSON columns are serialized. */
    update(table, id, fields) {
      const keys = Object.keys(fields);
      if (!keys.length) return;
      const vals = keys.map((k) => (JSON_COLUMNS.includes(k) ? JSON.stringify(fields[k]) : fields[k]));
      db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
    },
    now: () => new Date().toISOString(),
    close: () => db.close(),
  };
}

module.exports = { open };
