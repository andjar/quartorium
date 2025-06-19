const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use a file-based database in the db folder; it will be created if it doesn't exist.
const DB_SOURCE = path.join(__dirname, 'quartorium.db');

const db = new sqlite3.Database(DB_SOURCE, (err) => {
  if (err) {
    console.error(err.message);
    throw err;
  }
  console.log('✅ Connected to the SQLite database.');
});

// Create the users table if it doesn't exist
const createUsersTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT,
      github_token TEXT, -- ADD THIS LINE
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('✅ Users table is ready.');
    }
  });
};

const createReposTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      github_repo_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      is_private BOOLEAN NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating repositories table:', err.message);
    } else {
      console.log('✅ Repositories table is ready.');
    }
  });
};

const createDocumentsTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      filepath TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo_id, filepath),
      FOREIGN KEY (repo_id) REFERENCES repositories (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) console.error('Error creating documents table:', err.message);
    else console.log('✅ Documents table is ready.');
  });
};

const createShareLinksTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      collab_branch_name TEXT NOT NULL,
      collaborator_label TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doc_id) REFERENCES documents (id)
    )
  `;
  db.run(sql, (err) => {
    if (err) console.error('Error creating share_links table:', err.message);
    else console.log('✅ Share Links table is ready.');
  });
};

// Initialize the database and table
createUsersTable();
createReposTable();
createDocumentsTable();
createShareLinksTable();

// Create the live_documents table
const createLiveDocumentsTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS live_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER,
      filepath TEXT,
      share_token TEXT UNIQUE,
      prosemirror_json TEXT NOT NULL,
      base_commit_hash TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE (repo_id, filepath)
    )
  `;
  db.run(sql, (err) => {
    if (err) {
      console.error('Error creating live_documents table:', err.message);
    } else {
      console.log('✅ live_documents table is ready.');
      // Add a trigger to update updated_at on row modification
      const triggerSql = `
        CREATE TRIGGER IF NOT EXISTS update_live_documents_updated_at
        AFTER UPDATE ON live_documents
        FOR EACH ROW
        BEGIN
          UPDATE live_documents SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
      `;
      db.run(triggerSql, (triggerErr) => {
        if (triggerErr) {
          console.error('Error creating trigger for live_documents:', triggerErr.message);
        } else {
          console.log('✅ Trigger for live_documents is ready.');
        }
      });
    }
  });
};

createLiveDocumentsTable();

module.exports = db;