const express = require('express');
const db = require('../db/sqlite');
const fs = require('fs/promises');
const path = require('path');
const { qmdToProseMirror } = require('../core/quartoParser');

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

// Middleware to ensure user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'User not authenticated' });
};
router.use(isAuthenticated);

// GET /api/docs/view?repoId=1&filepath=path/to/doc.qmd
router.get('/view', async (req, res) => {
  const { repoId, filepath } = req.query;
  if (!repoId || !filepath) {
    return res.status(400).json({ error: 'repoId and filepath are required query parameters.' });
  }

  try {
    // 1. Verify user has access to this repo
    const repo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [repoId, req.user.id], (err, row) => {
        if (err) return reject(new Error('Database error'));
        if (!row) return reject(new Error('Repository not found or access denied'));
        resolve(row);
      });
    });

    // 2. Construct the full file path and read the file
    const fullFilepath = path.join(REPOS_DIR, repo.full_name, filepath);
    const qmdContent = await fs.readFile(fullFilepath, 'utf8');

    // 3. Parse the content into ProseMirror JSON
    const proseMirrorJson = await qmdToProseMirror(qmdContent);
    
    res.json(proseMirrorJson);

  } catch (error) {
    console.error('Error getting document view:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;