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
const { qmdToProseMirror } = require('../core/quartoParser'); // Import new parser
const { extractCommentsAppendix } = require('../core/commentUtils'); // Import comment utilities
const Diff = require('diff');
const { ensureAuthenticated } = require('../core/auth');

const router = express.Router();
const REPOS_DIR_path = actualPath.join(__dirname, '../../repos'); // Renamed for clarity
const CACHE_DIR = actualPath.join(__dirname, '../../cache/rendered_docs');

const isAuthenticated = (req, res, next) => {
  console.log('Auth check:', { 
    isAuthenticated: req.isAuthenticated(), 
    user: req.user, 
    session: req.session,
    cookies: req.headers.cookie 
  });
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
        // Include currentCommitHash in cached response
        const cachedResponse = { 
          ...parsedCache, 
          currentCommitHash: currentCommitHash 
        };
        return res.json(cachedResponse); // Return the full cached object with currentCommitHash
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
    
    // Include currentCommitHash in the response
    const responsePayload = { 
      ...resultPayload, 
      currentCommitHash: currentCommitHash || null 
    };
    
    res.json(responsePayload); // Return the payload { prosemirrorJson, comments, currentCommitHash }

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
    const { repoId, filepath, label, userId, branchName, collaborationMode = 'individual' } = req.body;
    const actualUserId = userId || req.user.id; // Use provided userId or fall back to authenticated user

    if (!repoId || !filepath || !label || !actualUserId || !branchName) {
      return res.status(400).json({ error: 'Missing required fields: repoId, filepath, label, userId, branchName' });
    }

    try {
      // 1. Verify user (from token) owns the repo.
      const repo = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [repoId, req.user.id], (err, row) => {
          if (err || !row) return reject(new Error('Repo not found or access denied for the authenticated user.'));
          resolve(row);
        });
      });

      // 2. Find or create the document record
      let doc = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM documents WHERE repo_id = ? AND filepath = ?', [repoId, filepath], (err, row) => {
            if (err) return reject(err);
            resolve(row);
          });
      });
      if (!doc) {
          doc = await new Promise((resolve, reject) => {
              db.run('INSERT INTO documents (repo_id, filepath) VALUES (?, ?)', [repoId, filepath], function(err) {
                  if(err) return reject(err);
                  resolve({ id: this.lastID });
              });
          });
      }

      // 3. Handle branch creation based on collaboration mode
      const collab_branch_name = branchName;
      const projectDir = actualPath.join(projectBaseDir, repo.full_name);
      
      if (collaborationMode === 'individual') {
        // For individual mode, ensure each collaborator gets a unique branch
        try {
          const existingBranches = await git.listBranches({
            fs: fsForGit,
            dir: projectDir
          });
          
          const branchExists = existingBranches.includes(collab_branch_name);
          
          if (!branchExists) {
            await git.branch({ 
              fs: fsForGit, 
              dir: projectDir, 
              ref: collab_branch_name, 
              checkout: false 
            });
            console.log(`Branch ${collab_branch_name} created locally for repo ${repo.full_name}`);
          } else {
            console.log(`Branch ${collab_branch_name} already exists locally for repo ${repo.full_name}`);
          }
        } catch (branchError) {
          console.warn(`Warning creating branch ${collab_branch_name}: ${branchError.message}`);
        }
      } else if (collaborationMode === 'shared') {
        // For shared mode, check if branch exists and create if needed
        try {
          const existingBranches = await git.listBranches({
            fs: fsForGit,
            dir: projectDir
          });
          
          const branchExists = existingBranches.includes(collab_branch_name);
          
          if (!branchExists) {
            await git.branch({ 
              fs: fsForGit, 
              dir: projectDir, 
              ref: collab_branch_name, 
              checkout: false 
            });
            console.log(`Shared branch ${collab_branch_name} created locally for repo ${repo.full_name}`);
          } else {
            console.log(`Shared branch ${collab_branch_name} already exists locally for repo ${repo.full_name}`);
          }
        } catch (branchError) {
          console.warn(`Warning creating shared branch ${collab_branch_name}: ${branchError.message}`);
        }
      }

      // 4. Generate a unique token and save the share link to the DB
      const share_token = uuidGenerator();
      const newShareLink = await new Promise((resolve, reject) => {
          const sql = 'INSERT INTO share_links (doc_id, user_id, share_token, collab_branch_name, collaborator_label) VALUES (?, ?, ?, ?, ?)';
          db.run(sql, [doc.id, actualUserId, share_token, collab_branch_name, label || ''], function(err) {
              if (err) return reject(err);
              resolve({ 
                id: this.lastID, 
                share_token, 
                collaborator_label: label || '', 
                collab_branch_name,
                collaborationMode 
              });
          });
      });
      
      res.status(201).json(newShareLink);

    } catch (error) {
      console.error('Error creating share link:', error);
      if (error.message && error.message.includes('UNIQUE constraint failed: share_links.share_token')) {
        return res.status(409).json({ error: 'Failed to generate a unique share token. Please try again.' });
      }
      if (error.message && error.message.includes('UNIQUE constraint failed: share_links.collab_branch_name')) {
        return res.status(409).json({ error: `Branch name ${branchName} is already in use for a share link. Choose a different name.` });
      }
      res.status(500).json({ error: error.message || 'An unexpected error occurred while creating the share link.' });
    }
  };
}
router.post('/share', shareRouteLogic(actualDb, actualGit, actualUuidv4, REPOS_DIR_path, actualFsForGit));


// GET /api/docs/diff/:shareToken - Get a diff of a collaboration branch
// router.get('/diff/:shareToken', async (req, res) => {
function diffRouteLogic(db, git, fs, projectBaseDir) { // fs here is for readFile, not git's fs plugin
  return async (req, res) => {
    const { shareToken } = req.params;

    try {
      console.log(`[Diff] Processing shareToken: ${shareToken}`);
      
      // 1. Get all the necessary info for the two branches
      const linkInfo = await new Promise((resolve, reject) => {
        const sql = `
          SELECT 
            s.collab_branch_name, 
            d.filepath, 
            r.full_name
          FROM share_links s 
          JOIN documents d ON s.doc_id = d.id 
          JOIN repositories r ON d.repo_id = r.id 
          WHERE s.share_token = ?
        `;
        console.log(`[Diff] Executing SQL with shareToken: ${shareToken}`);
        db.get(sql, [shareToken], (err, row) => {
          if (err) {
            console.error(`[Diff] Database error:`, err);
            return reject(new Error(`Database error: ${err.message}`));
          }
          if (!row) {
            console.error(`[Diff] No share link found for token: ${shareToken}`);
            return reject(new Error('Share link not found.'));
          }
          console.log(`[Diff] Found link info:`, row);
          resolve(row);
        });
      });

      const projectDir = actualPath.join(projectBaseDir, linkInfo.full_name);
      
      // Get the main branch from the repository
      const repo = await new Promise((resolve, reject) => {
        actualDb.get('SELECT main_branch FROM repositories WHERE full_name = ?', [linkInfo.full_name], (err, row) => {
          if (err) return reject(new Error(`Database error fetching repository: ${err.message}`));
          resolve(row);
        });
      });
      const mainBranch = repo.main_branch || 'main'; // Use the repository's main branch

      console.log(`[Diff] Project directory: ${projectDir}`);
      console.log(`[Diff] Main branch: ${mainBranch}`);
      console.log(`[Diff] Collab branch: ${linkInfo.collab_branch_name}`);
      console.log(`[Diff] Filepath: ${linkInfo.filepath}`);

      // 2. Get content from the main branch
      await git.checkout({ fs: actualFsForGit, dir: projectDir, ref: mainBranch }); // git needs actualFsForGit
      const mainContent = await fs.readFile(actualPath.join(projectDir, linkInfo.filepath), 'utf8');

      // 3. Get content from the collaboration branch
      await git.checkout({ fs: actualFsForGit, dir: projectDir, ref: linkInfo.collab_branch_name }); // git needs actualFsForGit
      const collabContent = await fs.readFile(actualPath.join(projectDir, linkInfo.filepath), 'utf8');
      
      // 4. Generate the diff (Original diff logic, can be kept as is or moved to a helper)
      // const diff = Diff.diffLines(mainContent, collabContent);

      console.log(`[Diff] Successfully read both files, returning diff data`);
      res.json({
        mainContent,
        collabContent,
        // diff, // Diff generation removed as per test structure (test mocks fs.readFile)
        branchName: linkInfo.collab_branch_name
      });

    } catch (error) {
      console.error('Error generating diff:', error);
      res.status(500).json({ error: `Failed to generate diff: ${error.message}` });
    }
  };
}
router.get('/diff/:shareToken', diffRouteLogic(actualDb, actualGit, actualFs, REPOS_DIR_path));


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
      const sql = 'SELECT id, share_token, collaborator_label, collab_branch_name, created_at FROM share_links WHERE doc_id = ? ORDER BY created_at DESC';
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

// POST /api/docs/merge/:shareToken - Merge collaboration branch into main branch
router.post('/merge/:shareToken', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          s.collab_branch_name, 
          d.filepath, 
          r.full_name,
          r.id as repo_id
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        WHERE s.share_token = ?
      `;
      actualDb.get(sql, [shareToken], (err, row) => {
        if (err || !row) return reject(new Error('Share link not found.'));
        resolve(row);
      });
    });

    // 2. Verify user owns the repository
    const repo = await new Promise((resolve, reject) => {
      actualDb.get('SELECT * FROM repositories WHERE id = ? AND user_id = ?', [linkInfo.repo_id, req.user.id], (err, row) => {
        if (err || !row) return reject(new Error('Repository not found or access denied.'));
        resolve(row);
      });
    });

    const projectDir = actualPath.join(REPOS_DIR_path, linkInfo.full_name);
    const mainBranch = repo.main_branch || 'main'; // Use the repository's main branch

    // 3. Checkout main branch
    await actualGit.checkout({ fs: actualFsForGit, dir: projectDir, ref: mainBranch });

    // 4. Merge the collaboration branch into main
    try {
      await actualGit.merge({ 
        fs: actualFsForGit, 
        dir: projectDir, 
        theirs: linkInfo.collab_branch_name,
        author: {
          name: req.user.username || 'Quartorium User',
          email: req.user.email || `${req.user.username || 'user'}@quartorium.app`
        },
        message: `Merge collaboration branch: ${linkInfo.collab_branch_name}`
      });
    } catch (mergeError) {
      // If merge fails due to conflicts, return error
      if (mergeError.message.includes('conflict')) {
        return res.status(409).json({ error: 'Merge conflict detected. Please resolve conflicts manually.' });
      }
      throw mergeError;
    }

    // 5. Optionally delete the collaboration branch after successful merge
    try {
      await actualGit.deleteBranch({ fs: actualFsForGit, dir: projectDir, ref: linkInfo.collab_branch_name });
    } catch (deleteError) {
      console.warn(`Failed to delete collaboration branch ${linkInfo.collab_branch_name}:`, deleteError.message);
      // Don't fail the merge if branch deletion fails
    }

    res.json({ message: 'Merge completed successfully' });

  } catch (error) {
    console.error('Error merging branches:', error);
    res.status(500).json({ error: error.message || 'Failed to merge branches.' });
  }
});

// GET /api/docs/debug/shares - Debug endpoint to list all share links
router.get('/debug/shares', async (req, res) => {
  try {
    const links = await new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          s.id,
          s.share_token,
          s.collab_branch_name,
          s.collaborator_label,
          d.filepath,
          r.full_name
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        ORDER BY s.created_at DESC
      `;
      actualDb.all(sql, [], (err, rows) => {
        if (err) {
          console.error('Database error fetching all share links:', err);
          return reject(new Error('Failed to retrieve share links.'));
        }
        resolve(rows);
      });
    });

    res.json({ 
      message: 'All share links in database',
      count: links.length,
      links 
    });

  } catch (error) {
    console.error('Error getting all share links:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/docs/:docId/suggestions - Get all suggestions from all collaboration branches
router.get('/:docId/suggestions', async (req, res) => {
  const { docId } = req.params;

  console.log('Suggestions endpoint called:', { docId, user: req.user, isAuthenticated: req.isAuthenticated() });

  try {
    // Get all share links for this document
    const shareLinks = await new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          s.share_token,
          s.collab_branch_name,
          s.collaborator_label,
          d.filepath,
          r.full_name,
          r.main_branch
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        WHERE s.doc_id = ?
      `;
      actualDb.all(sql, [docId], (err, rows) => {
        if (err) return reject(new Error(`Database error: ${err.message}`));
        resolve(rows);
      });
    });

    console.log('Found share links:', shareLinks.length);

    const allSuggestions = [];

    // For each collaboration branch, get the latest content and comments
    for (const link of shareLinks) {
      const projectDir = actualPath.join(REPOS_DIR_path, link.full_name);
      
      try {
        // Checkout the collaboration branch
        await actualGit.checkout({ fs: actualFsForGit, dir: projectDir, ref: link.collab_branch_name });
        
        // Get the latest commit hash
        const commitHash = await actualGit.resolveRef({ fs: actualFsForGit, dir: projectDir, ref: link.collab_branch_name });
        
        // Read the QMD file
        const fullFilepath = actualPath.join(projectDir, link.filepath);
        const qmdContent = await actualFs.readFile(fullFilepath, 'utf8');
        
        // Extract comments from the QMD content
        const { comments: extractedComments } = extractCommentsAppendix(qmdContent);
        
        // Add suggestions from this branch
        if (extractedComments.length > 0) {
          allSuggestions.push({
            branch: link.collab_branch_name,
            collaborator: link.collaborator_label || 'Unknown',
            shareToken: link.share_token,
            commitHash: commitHash.substring(0, 7),
            suggestions: extractedComments.map(comment => ({
              id: comment.id,
              author: comment.author,
              timestamp: comment.timestamp,
              status: comment.status,
              thread: comment.thread,
              location: comment.location // If you track comment locations
            }))
          });
        }
        
        // Also check live_documents for unsaved changes
        const liveDoc = await new Promise((resolve) => {
          actualDb.get('SELECT comments_json FROM live_documents WHERE share_token = ?', [link.share_token], (err, row) => {
            if (err || !row) resolve(null);
            else resolve(row);
          });
        });
        
        if (liveDoc && liveDoc.comments_json) {
          try {
            const liveComments = JSON.parse(liveDoc.comments_json);
            if (liveComments.length > 0) {
              allSuggestions.push({
                branch: `${link.collab_branch_name} (unsaved)`,
                collaborator: link.collaborator_label || 'Unknown',
                shareToken: link.share_token,
                commitHash: 'UNSAVED',
                suggestions: liveComments.map(comment => ({
                  id: comment.id,
                  author: comment.author,
                  timestamp: comment.timestamp,
                  status: comment.status,
                  thread: comment.thread,
                  location: comment.location
                }))
              });
            }
          } catch (e) {
            console.warn(`Failed to parse live comments for ${link.share_token}:`, e);
          }
        }
        
      } catch (error) {
        console.warn(`Failed to process branch ${link.collab_branch_name}:`, error.message);
        // Continue with other branches
      }
    }

    console.log('Returning suggestions:', { documentId: docId, totalSuggestions: allSuggestions.reduce((sum, branch) => sum + branch.suggestions.length, 0) });

    res.json({
      documentId: docId,
      totalSuggestions: allSuggestions.reduce((sum, branch) => sum + branch.suggestions.length, 0),
      branches: allSuggestions
    });

  } catch (error) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/docs/document-id - Get document ID from repoId and filepath
router.get('/document-id', async (req, res) => {
  const { repoId, filepath } = req.query;

  if (!repoId || !filepath) {
    return res.status(400).json({ error: 'repoId and filepath are required.' });
  }

  try {
    const doc = await new Promise((resolve, reject) => {
      actualDb.get('SELECT id FROM documents WHERE repo_id = ? AND filepath = ?', [repoId, filepath], (err, row) => {
        if (err) return reject(new Error(`Database error: ${err.message}`));
        resolve(row);
      });
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.json({ docId: doc.id });
  } catch (error) {
    console.error('Error getting document ID:', error);
    res.status(500).json({ error: error.message });
  }
});

// TODO: Add collaborator-facing endpoints (GET/POST /api/collab/:shareToken)

module.exports = router;
// Exporting the logic functions for testing
module.exports.shareRouteLogic = shareRouteLogic;
module.exports.diffRouteLogic = diffRouteLogic;