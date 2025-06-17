const express = require('express');
const axios = require('axios');
const db = require('../db/sqlite');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const router = express.Router();
// Create a directory to store cloned repos
const REPOS_DIR = path.join(__dirname, '../../repos');

if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}

// Middleware to ensure user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'User not authenticated' });
};

router.use(isAuthenticated);

// GET /api/repos - List all repositories for the logged-in user
router.get('/', (req, res) => {
  db.all('SELECT * FROM repositories WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST /api/repos - Connect a new repository
router.post('/', async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) return res.status(400).json({ error: 'repo_url is required' });

  try {
    const url = new URL(repo_url);
    if (url.hostname !== 'github.com') throw new Error('Not a GitHub URL');
    const full_name = url.pathname.slice(1).replace(/\.git$/, '');

    // Use user's token to fetch repo details from GitHub API
    const githubResponse = await axios.get(`https://api.github.com/repos/${full_name}`, {
      headers: { Authorization: `token ${req.user.github_token}` },
    });

    const repoData = githubResponse.data;
    const { id, name, private: is_private } = repoData;
    
    const sql = 'INSERT INTO repositories (user_id, github_repo_id, name, full_name, is_private) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [req.user.id, id, name, full_name, is_private], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to save repository. It may already be added.' });
      res.status(201).json({ id: this.lastID, name, full_name });
    });
  } catch (error) {
    console.error("Error adding repo:", error.message);
    res.status(404).json({ error: 'Repository not found or you do not have access.' });
  }
});

// GET /api/repos/:repoId/qmd-files - List .qmd files in a repo
router.get('/:repoId/qmd-files', async (req, res) => {
  db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [req.params.repoId, req.user.id], async (err, repo) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const dir = path.join(REPOS_DIR, repo.full_name);
    const url = `https://github.com/${repo.full_name}.git`;

    try {
      // Clone or pull the latest changes. `isomorphic-git` handles this idempotently.
      // We'll clone into a directory named after the repo's full name to avoid collisions.
      await git.clone({ fs, http, dir, url, singleBranch: true, depth: 1, corsProxy: 'https://cors.isomorphic-git.org' });
      console.log(`Cloned or updated ${repo.full_name}`);

      // Recursively find all .qmd files
      const findQmdFiles = (startPath) => {
        let results = [];
        if (!fs.existsSync(startPath)) return results;
        const files = fs.readdirSync(startPath);
        for (const file of files) {
          const filename = path.join(startPath, file);
          if (file === '.git') continue; // Skip the .git directory
          const stat = fs.lstatSync(filename);
          if (stat.isDirectory()) {
            results = results.concat(findQmdFiles(filename));
          } else if (filename.endsWith('.qmd')) {
            // Return a path relative to the repo root
            results.push(path.relative(dir, filename).replace(/\\/g, '/'));
          }
        }
        return results;
      };

      const qmdFiles = findQmdFiles(dir);
      res.json(qmdFiles);
    } catch (error) {
      console.error('Git operation failed:', error);
      res.status(500).json({ error: 'Failed to clone or read repository.' });
    }
  });
});

module.exports = router;