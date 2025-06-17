const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use a file-based database in the db folder; it will be created if it doesn't exist.
const DB_SOURCE = path.join(__dirname, 'quillarto.db');

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

// Initialize the database and table
createUsersTable();
createReposTable();

module.exports = db;