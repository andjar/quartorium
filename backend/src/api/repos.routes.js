const express = require('express');
const axios = require('axios');
const db = require('../db/sqlite');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const router = express.Router();
// Create a directory to store cloned repos in the backend folder
const REPOS_DIR = path.join(__dirname, '../../repos');

// Ensure the repos directory exists when the server starts
if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}

// Middleware to ensure user is authenticated for all repo routes
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'User not authenticated' });
};

router.use(isAuthenticated);

// GET /api/repos - List all repositories for the logged-in user
router.get('/', (req, res) => {
  db.all('SELECT * FROM repositories WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) {
      console.error('DB error listing repos:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST /api/repos - Connect a new repository
router.post('/', async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) {
    return res.status(400).json({ error: 'repo_url is required' });
  }

  try {
    const url = new URL(repo_url);
    if (url.hostname !== 'github.com') {
      throw new Error('Not a GitHub URL');
    }
    // Cleans up path, e.g., /user/repo.git -> user/repo
    const full_name = url.pathname.slice(1).replace(/\.git$/, '');

    // Use the user's saved token to fetch repo details from the GitHub API
    const githubResponse = await axios.get(`https://api.github.com/repos/${full_name}`, {
      headers: { Authorization: `token ${req.user.github_token}` },
    });

    const repoData = githubResponse.data;
    const { id, name, private: is_private } = repoData;
    
    const sql = 'INSERT INTO repositories (user_id, github_repo_id, name, full_name, is_private) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [req.user.id, id, name, full_name, is_private], function(err) {
      if (err) {
        // This is likely a UNIQUE constraint violation if the repo is already added
        console.error('DB error inserting repo:', err);
        return res.status(409).json({ error: 'Repository has already been added.' });
      }
      res.status(201).json({ id: this.lastID, name, full_name });
    });
  } catch (error) {
    console.error("Error adding repo:", error.response ? error.response.data : error.message);
    res.status(404).json({ error: 'Repository not found or you do not have access.' });
  }
});

// GET /api/repos/:repoId/qmd-files - List .qmd files in a repo
router.get('/:repoId/qmd-files', async (req, res) => {
  db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [req.params.repoId, req.user.id], async (err, repo) => {
    if (err) {
      console.error('DB error finding repo:', err);
      return res.status(500).json({ error: err.message });
    }
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    const dir = path.join(REPOS_DIR, repo.full_name);
    const url = `https://github.com/${repo.full_name}.git`;

    try {
      // Clone or pull the latest changes.
      // The `onAuth` callback provides the user's token for private repos.
      await git.clone({
        fs,
        http,
        dir,
        url,
        singleBranch: true,
        depth: 1,
        onAuth: () => ({
          username: req.user.github_token, // For GitHub, the token is used as the username
          password: '' // Password can be empty when using a token
        }),
      });
      console.log(`Successfully cloned or updated ${repo.full_name}`);

      // Recursively find all .qmd files in the cloned directory
      const findQmdFiles = (startPath) => {
        let results = [];
        if (!fs.existsSync(startPath)) return results;
        
        const files = fs.readdirSync(startPath);
        for (const file of files) {
          const filename = path.join(startPath, file);
          if (file === '.git') continue; // Skip the git metadata directory
          
          const stat = fs.lstatSync(filename);
          if (stat.isDirectory()) {
            results = results.concat(findQmdFiles(filename));
          } else if (filename.endsWith('.qmd')) {
            // Return a path relative to the repo root, with normalized slashes
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