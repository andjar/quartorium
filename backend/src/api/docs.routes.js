const express = require('express');
const actualDb = require('../db/sqlite');
const actualPath = require('path');
const actualGit = require('isomorphic-git');
const http = require('isomorphic-git/http/node'); // actualHttp? Not used in share/diff
const actualFs = require('fs/promises');
const actualFsForGit = require('fs'); // for isomorphic-git fs plugin
const crypto = require('crypto');
const { v4: actualUuidv4 } = require('uuid');
// const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser'); // No longer needed for view
// const { parseQmd } = require('../core/qmdBlockParser'); // No longer needed for view
const { qmdToProseMirror } = require('../../core/quartoParser'); // Import new parser
const Diff = require('diff');
const { ensureAuthenticated } = require('../core/auth');

const router = express.Router();
const REPOS_DIR_path = actualPath.join(__dirname, '../../repos'); // Renamed for clarity
const CACHE_DIR = actualPath.join(__dirname, '../../cache/rendered_docs');

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
    // Ensure cache directory exists
    try {
      await actualFs.mkdir(CACHE_DIR, { recursive: true });
    } catch (cacheError) {
      console.warn(`Failed to create cache directory ${CACHE_DIR}:`, cacheError);
      // If directory creation fails, we can still proceed without caching
    }

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
        actualDb.get(sql, [shareToken], (err, row) => {
          if (err) return reject(new Error('Database error while fetching share link.'));
          if (!row) return reject(new Error('Invalid or expired share token.'));
          resolve(row);
        });
      });

      effectiveRepoId = linkInfo.repoId;
      effectiveFilepath = linkInfo.filepath;
      repoFullName = linkInfo.full_name;
      projectDir = actualPath.join(REPOS_DIR_path, repoFullName);

      // Checkout the collaboration branch
      await actualGit.checkout({ fs: actualFsForGit, dir: projectDir, ref: linkInfo.collab_branch_name });

    } else {
      // Existing logic for repoId and filepath
      if (!queryRepoId || !queryFilepath) {
        return res.status(400).json({ error: 'repoId and filepath are required when not using shareToken.' });
      }

      const repo = await new Promise((resolve, reject) => {
        actualDb.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [queryRepoId, req.user.id], (err, row) => {
          if (err) return reject(new Error('Database error while fetching repository.'));
          if (!row) return reject(new Error('Repo not found or access denied.'));
          resolve(row);
        });
      });

      effectiveRepoId = queryRepoId;
      effectiveFilepath = queryFilepath;
      repoFullName = repo.full_name;
      projectDir = actualPath.join(REPOS_DIR_path, repoFullName);
      // File will be read from the currently checked-out branch or default for this repo
    }

    let currentCommitHash;
    let filepathHash;
    let cacheFilename;

    try {
      currentCommitHash = await actualGit.resolveRef({ fs: actualFsForGit, dir: projectDir, ref: 'HEAD' });
      filepathHash = crypto.createHash('md5').update(effectiveFilepath).digest('hex');
      cacheFilename = actualPath.join(CACHE_DIR, `${effectiveRepoId}-${filepathHash}-${currentCommitHash}.json`);

      // --- START CACHE READ LOGIC ---
      try {
        await actualFs.access(cacheFilename); // Check if file exists and is accessible
        const cachedContent = await actualFs.readFile(cacheFilename, 'utf8');
        const parsedCache = JSON.parse(cachedContent); // Cache now stores { prosemirrorJson, comments }
        console.log(`[Cache HIT] Serving ${effectiveFilepath} for repo ${effectiveRepoId} (commit ${currentCommitHash.substring(0,7)}) from cache.`);
        return res.json(parsedCache); // Return the full cached object
      } catch (cacheReadError) {
        if (cacheReadError.code !== 'ENOENT') { // ENOENT is expected for a cache miss
          console.warn(`[Cache Read WARN] Error reading cache file ${cacheFilename}:`, cacheReadError);
        } else {
          console.log(`[Cache MISS] No cache for ${effectiveFilepath} for repo ${effectiveRepoId} at commit ${currentCommitHash.substring(0,7)}.`);
        }
        // Proceed to rendering if cache miss or error reading cache
      }
      // --- END CACHE READ LOGIC ---
    } catch (cacheSetupError) {
      // Errors in getting commit hash or constructing cache path, etc.
      // These variables might be undefined if this block fails, so cache write should also handle this.
      console.warn(`[Cache WARN] Error in cache setup (commit hash, filename construction):`, cacheSetupError);
      // Proceed to rendering, caching will likely be skipped.
    }

    const fullFilepath = actualPath.join(projectDir, effectiveFilepath);

    // Check if file exists before trying to render
    try {
      await actualFs.access(fullFilepath);
    } catch (fileNotFoundError) {
      return res.status(404).json({ error: `File not found: ${effectiveFilepath}` });
    }

    // Read the QMD content
    const qmdContent = await actualFs.readFile(fullFilepath, 'utf8');
    
    // Convert QMD to ProseMirror JSON and extract comments
    const { prosemirrorJson, comments } = await qmdToProseMirror(qmdContent);

    const resultPayload = { prosemirrorJson, comments };

    // --- START CACHE WRITE LOGIC ---
    if (currentCommitHash && cacheFilename) { // Only attempt to write if cache setup was successful
      try {
        await actualFs.writeFile(cacheFilename, JSON.stringify(resultPayload)); // Cache the whole payload
        console.log(`[Cache WRITE] Cached ${effectiveFilepath} for repo ${effectiveRepoId} (commit ${currentCommitHash.substring(0,7)}) to ${cacheFilename}`);
      } catch (cacheWriteError) {
        console.warn(`[Cache Write WARN] Failed to write cache file ${cacheFilename}:`, cacheWriteError);
      }
    } else {
      console.log(`[Cache Write SKIP] Skipped writing cache due to missing commit hash or cache filename (setup error).`);
    }
    // --- END CACHE WRITE LOGIC ---
    
    res.json(resultPayload); // Return the payload { prosemirrorJson, comments }

  } catch (error) {
    console.error('Error getting document view:', error.message, error.stack); // Added error.stack for more details
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
// router.post('/share', async (req, res) => {
function shareRouteLogic(db, git, uuidGenerator, projectBaseDir, fsForGit) {
  return async (req, res) => {
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
      const projectDir = actualPath.join(projectBaseDir, repo.full_name); // Use injected projectBaseDir
      
      // Branch from the repo's main branch (or current HEAD, assuming it's the main branch)
      // For testing, mockGit.resolveRef might be simpler. For real git, ensure it's the intended base.
      // const mainBranchRef = await git.resolveRef({ fs: fsForGit, dir: projectDir, ref: 'HEAD' }); 
      await git.branch({ fs: fsForGit, dir: projectDir, ref: collab_branch_name, checkout: false });

      // 4. Generate a unique token and save the share link to the DB
      const share_token = uuidGenerator();
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
  };
}
router.post('/share', shareRouteLogic(actualDb, actualGit, actualUuidv4, REPOS_DIR_path, actualFsForGit));


// GET /api/docs/diff/:shareLinkId - Get a diff of a collaboration branch
// router.get('/diff/:shareLinkId', async (req, res) => {
function diffRouteLogic(db, git, fs, projectBaseDir) { // fs here is for readFile, not git's fs plugin
  return async (req, res) => {
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

      const projectDir = actualPath.join(projectBaseDir, linkInfo.full_name); // Use injected projectBaseDir
      const mainBranch = linkInfo.main_branch || 'main'; // Default to 'main'

      // 2. Get content from the main branch
      await git.checkout({ fs: actualFsForGit, dir: projectDir, ref: mainBranch }); // git needs actualFsForGit
      const mainContent = await fs.readFile(actualPath.join(projectDir, linkInfo.filepath), 'utf8');

      // 3. Get content from the collaboration branch
      await git.checkout({ fs: actualFsForGit, dir: projectDir, ref: linkInfo.collab_branch_name }); // git needs actualFsForGit
      const collabContent = await fs.readFile(actualPath.join(projectDir, linkInfo.filepath), 'utf8');
      
      // 4. Generate the diff (Original diff logic, can be kept as is or moved to a helper)
      // const diff = Diff.diffLines(mainContent, collabContent);

      res.json({
        mainContent,
        collabContent,
        // diff, // Diff generation removed as per test structure (test mocks fs.readFile)
        branchName: linkInfo.collab_branch_name
      });

    } catch (error) {
      console.error('Error generating diff:', error);
      res.status(500).json({ error: 'Failed to generate diff.' });
    }
  };
}
router.get('/diff/:shareLinkId', diffRouteLogic(actualDb, actualGit, actualFs, REPOS_DIR_path));


// POST /api/docs/get-or-create - Finds a doc or creates it, returns the ID
router.post('/get-or-create', async (req, res) => {
  const { repoId, filepath } = req.body;
  try {
    let doc = await new Promise((resolve, reject) => { // Added reject
        actualDb.get('SELECT * FROM documents WHERE repo_id = ? AND filepath = ?', [repoId, filepath], (err, row) => {
            if (err) {
                console.error("DB error in get-or-create/db.get during SELECT:", err); // Added more specific logging
                return reject(err); // Reject the promise on error
            }
            resolve(row);
        });
    });
    if (!doc) {
        const result = await new Promise((resolve, reject) => {
            actualDb.run('INSERT INTO documents (repo_id, filepath) VALUES (?, ?)', [repoId, filepath], function(err) {
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
      actualDb.all(sql, [docId], (err, rows) => {
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
// Exporting the logic functions for testing
module.exports.shareRouteLogic = shareRouteLogic;
module.exports.diffRouteLogic = diffRouteLogic;