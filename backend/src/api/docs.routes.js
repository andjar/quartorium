const express = require('express');
const db = require('../db/sqlite');
const fs = require('fs/promises');
const path = require('path');
const { qmdToProseMirror } = require('../core/quartoParser');
const { renderToAST, pandocAST_to_proseMirrorJSON } = require('../core/astParser');

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
      return res.status(400).json({ error: 'repoId and filepath are required.' });
    }
  
    try {
      // 1. Verify user has access to this repo
      const repo = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [repoId, req.user.id], (err, row) => {
          if (err || !row) return reject(new Error('Repo not found or access denied.'));
          resolve(row);
        });
      });
  
      const projectDir = path.join(REPOS_DIR, repo.full_name);
      const fullFilepath = path.join(projectDir, filepath);
  
      // 2. Render the document to a Pandoc AST
      const { ast } = await renderToAST(fullFilepath, projectDir);
      
      // 3. Transform the Pandoc AST to ProseMirror JSON
      const proseMirrorJson = pandocAST_to_proseMirrorJSON(ast, repoId);
      
      res.json(proseMirrorJson);
  
    } catch (error) {
      console.error('Error getting document view:', error);
      res.status(500).json({ error: error.message });
    }
  });

module.exports = router;