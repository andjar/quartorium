const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser');
const Diff = require('diff');
const { ensureAuthenticated } = require('../core/auth');

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'User not authenticated' });
};

// All doc routes require authentication
router.use(isAuthenticated);

// GET /api/docs/view?repoId=1&filepath=path/to/doc.qmd or GET /api/docs/view?shareToken=TOKEN
router.get('/view', async (req, res) => {
  const { repoId: queryRepoId, filepath: queryFilepath, shareToken } = req.query;

  try {
    let effectiveRepoId;
    let effectiveFilepath;
    let projectDir;
    let repoFullName; // Used for projectDir construction

    if (shareToken) {
      // Logic for handling shareToken
      const linkInfo = await new Promise((resolve, reject) => {
        const sql = `
          SELECT 
            s.collab_branch_name, 
            d.filepath,
            r.id as repoId, 
            r.full_name
          FROM share_links s 
          JOIN documents d ON s.doc_id = d.id 
          JOIN repositories r ON d.repo_id = r.id 
          WHERE s.share_token = ?
        `;
        db.get(sql, [shareToken], (err, row) => {
          if (err) return reject(new Error('Database error while fetching share link.'));
          if (!row) return reject(new Error('Invalid or expired share token.'));
          resolve(row);
        });
      });

      effectiveRepoId = linkInfo.repoId;
      effectiveFilepath = linkInfo.filepath;
      repoFullName = linkInfo.full_name;
      projectDir = path.join(REPOS_DIR, repoFullName);

      // Checkout the collaboration branch
      await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });

    } else {
      // Existing logic for repoId and filepath
      if (!queryRepoId || !queryFilepath) {
        return res.status(400).json({ error: 'repoId and filepath are required when not using shareToken.' });
      }

      const repo = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [queryRepoId, req.user.id], (err, row) => {
          if (err) return reject(new Error('Database error while fetching repository.'));
          if (!row) return reject(new Error('Repo not found or access denied.'));
          resolve(row);
        });
      });

      effectiveRepoId = queryRepoId;
      effectiveFilepath = queryFilepath;
      repoFullName = repo.full_name;
      projectDir = path.join(REPOS_DIR, repoFullName);
      // File will be read from the currently checked-out branch or default for this repo
    }

    const fullFilepath = path.join(projectDir, effectiveFilepath);

    // Check if file exists before trying to render
    try {
      await fs.access(fullFilepath);
    } catch (fileNotFoundError) {
      return res.status(404).json({ error: `File not found: ${effectiveFilepath}` });
    }

    // Render the document to JATS
    const { jatsXml } = await renderToJATS(fullFilepath, projectDir);
    
    // Transform the JATS to ProseMirror JSON
    const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, effectiveRepoId);
    
    res.json(proseMirrorJson);

  } catch (error) {
    console.error('Error getting document view:', error.message);
    if (error.message.includes('share token') || error.message.includes('access denied')) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message.includes('File not found')) {
        return res.status(404).json({ error: error.message});
    }
    res.status(500).json({ error: `Failed to get document view: ${error.message}` });
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

// GET /api/docs/diff/:shareLinkId - Get a diff of a collaboration branch
router.get('/diff/:shareLinkId', async (req, res) => {
  const { shareLinkId } = req.params;

  try {
    // 1. Get all the necessary info for the two branches
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          s.collab_branch_name, 
          d.filepath, 
          r.full_name,
          r.main_branch -- Assuming you have a main_branch column in your repos table
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        WHERE s.id = ?
      `;
      db.get(sql, [shareLinkId], (err, row) => {
        if (err || !row) return reject(new Error('Share link not found.'));
        resolve(row);
      });
    });

    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    const mainBranch = linkInfo.main_branch || 'main'; // Default to 'main'

    // 2. Get content from the main branch
    await git.checkout({ fs, dir: projectDir, ref: mainBranch });
    const mainContent = await fs.readFile(path.join(projectDir, linkInfo.filepath), 'utf8');

    // 3. Get content from the collaboration branch
    await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });
    const collabContent = await fs.readFile(path.join(projectDir, linkInfo.filepath), 'utf8');
    
    // 4. Generate the diff
    const diff = Diff.diffLines(mainContent, collabContent);

    res.json({
      mainContent,
      collabContent,
      diff,
      branchName: linkInfo.collab_branch_name
    });

  } catch (error) {
    console.error('Error generating diff:', error);
    res.status(500).json({ error: 'Failed to generate diff.' });
  }
});

// POST /api/collab/:shareToken - Save changes from a collaborator
router.post('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;
  const proseMirrorDoc = req.body; // The JSON from the editor

  if (!proseMirrorDoc || !proseMirrorDoc.type) {
      return res.status(400).json({ error: 'Invalid document format received.' });
  }

  try {
    // 1. Find the share link and associated document/repo info
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.collab_branch_name, d.filepath, r.full_name 
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        WHERE s.share_token = ?
      `;
      db.get(sql, [shareToken], (err, row) => {
        if (err || !row) return reject(new Error('Invalid share link.'));
        resolve(row);
      });
    });

    // 2. Serialize the ProseMirror JSON back into a .qmd string
    const newQmdContent = proseMirrorJSON_to_qmd(proseMirrorDoc);

    // 3. Write the new content to the file and commit it to the collaboration branch
    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    const fullFilepath = path.join(projectDir, linkInfo.filepath);

    await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });
    await fs.writeFile(fullFilepath, newQmdContent);
    
    await git.add({ fs, dir: projectDir, filepath: linkInfo.filepath });

    await git.commit({
      fs,
      dir: projectDir,
      message: 'Update from collaborator via Quartorium',
      author: {
        name: 'Quartorium Collaborator',
        email: 'collaborator@quartorium.app',
      },
    });

    console.log(`Changes committed to branch: ${linkInfo.collab_branch_name}`);
    // Return a successful status
    res.status(200).json({ status: 'saved' });

  } catch (error) {
    console.error('Error saving collab doc:', error);
    res.status(500).json({ error: 'Failed to save changes.' });
  }
});

// POST /api/docs/get-or-create - Finds a doc or creates it, returns the ID
router.post('/get-or-create', async (req, res) => {
  const { repoId, filepath } = req.body;
  try {
    let doc = await new Promise((resolve, reject) => { // Added reject
        db.get('SELECT * FROM documents WHERE repo_id = ? AND filepath = ?', [repoId, filepath], (err, row) => {
            if (err) {
                console.error("DB error in get-or-create/db.get during SELECT:", err); // Added more specific logging
                return reject(err); // Reject the promise on error
            }
            resolve(row);
        });
    });
    if (!doc) {
        const result = await new Promise((resolve, reject) => {
            db.run('INSERT INTO documents (repo_id, filepath) VALUES (?, ?)', [repoId, filepath], function(err) {
                if(err) return reject(err);
                resolve({ id: this.lastID });
            });
        });
        doc = { id: result.id };
    }
    res.json(doc);
  } catch(e) { res.status(500).json({error: e.message})}
});

// GET /api/docs/:docId/shares - Retrieve all share links for a document
router.get('/:docId/shares', async (req, res) => {
  const { docId } = req.params;

  try {
    const links = await new Promise((resolve, reject) => {
      const sql = 'SELECT id, share_token, collaborator_label, created_at FROM share_links WHERE doc_id = ? ORDER BY created_at DESC';
      db.all(sql, [docId], (err, rows) => {
        if (err) {
          console.error('Database error fetching share links:', err);
          return reject(new Error('Failed to retrieve share links.'));
        }
        resolve(rows);
      });
    });

    res.json(links); // Will return empty array if no links found, which is desired

  } catch (error) {
    console.error('Error getting share links for doc:', docId, error);
    res.status(500).json({ error: error.message });
  }
});

// TODO: Add collaborator-facing endpoints (GET/POST /api/collab/:shareToken)

module.exports = router;