const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { renderToAST, pandocAST_to_proseMirrorJSON } = require('../core/astParser'); // Assuming astParser.js exists

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'User not authenticated' });
};

// All doc routes require authentication
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

// POST /api/docs/share - Create a new share link
router.post('/share', async (req, res) => {
  const { repoId, filepath, label } = req.body;
  if (!repoId || !filepath || !label) {
    return res.status(400).json({ error: 'repoId, filepath, and label are required.' });
  }

  try {
    // 1. Verify user owns the repo
    const repo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [repoId, req.user.id], (err, row) => {
        if (err || !row) return reject(new Error('Repo not found or access denied.'));
        resolve(row);
      });
    });

    // 2. Find or create the document record
    let doc = await new Promise((resolve) => {
        db.get('SELECT * FROM documents WHERE repo_id = ? AND filepath = ?', [repoId, filepath], (err, row) => resolve(row));
    });
    if (!doc) {
        doc = await new Promise((resolve, reject) => {
            db.run('INSERT INTO documents (repo_id, filepath) VALUES (?, ?)', [repoId, filepath], function(err) {
                if(err) return reject(err);
                resolve({ id: this.lastID });
            });
        });
    }

    // 3. Create the new collaboration branch in Git
    const now = new Date();
    const branchSuffix = label.toLowerCase().replace(/\s+/g, '-') + '-' + now.toISOString().split('T')[0];
    const collab_branch_name = `quartorium/collab-${branchSuffix}`;
    const projectDir = path.join(REPOS_DIR, repo.full_name);
    
    // Branch from the repo's main branch
    const mainBranchRef = await git.resolveRef({ fs, dir: projectDir, ref: 'HEAD' }); 
    await git.branch({ fs, dir: projectDir, ref: collab_branch_name, checkout: false });

    // 4. Generate a unique token and save the share link to the DB
    const share_token = uuidv4();
    const newShareLink = await new Promise((resolve, reject) => {
        const sql = 'INSERT INTO share_links (doc_id, share_token, collab_branch_name, collaborator_label) VALUES (?, ?, ?, ?)';
        db.run(sql, [doc.id, share_token, collab_branch_name, label], function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, share_token, collaborator_label: label });
        });
    });
    
    res.status(201).json(newShareLink);

  } catch (error) {
    console.error('Error creating share link:', error);
    res.status(500).json({ error: error.message });
  }
});

// TODO: Add GET /api/docs/:docId/shares
// TODO: Add collaborator-facing endpoints (GET/POST /api/collab/:shareToken)

module.exports = router;