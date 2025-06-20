const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git'); // Re-add for GET endpoint
const http = require('isomorphic-git/http/node'); // Add http for git operations
const fs = require('fs/promises');
const fsForGit = require('fs'); // Add synchronous fs for isomorphic-git
const matter = require('gray-matter'); // For YAML extraction
const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser'); // Keep for GET, might remove if GET switches path
// const { proseMirrorJSON_to_qmd } = require('../core/astSerializer'); // Replaced by new serializer
const { proseMirrorJSON_to_qmd } = require('../core/astSerializer'); // Use improved serializer
// Import the QMD parser to create blockMap - still needed for GET /:shareToken if rendering from branch
const { parseQmd } = require('../core/qmdBlockParser');
// Import comment utilities to extract comments from QMD
const { extractCommentsAppendix } = require('../core/commentUtils');

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

// GET /api/collab/:shareToken - Load the document for a collaborator
router.get('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. First, get the share link information (needed for both live doc and branch rendering)
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // 2. Find all share links for this document to check all possible live docs.
    const allShareLinks = await new Promise((resolve, reject) => {
      const sql = `SELECT share_token FROM share_links WHERE doc_id = ?`;
      db.all(sql, [linkInfo.doc_id], (err, rows) => {
        if (err) return reject(new Error('Could not query for sibling share links.'));
        resolve(rows.map(r => r.share_token));
      });
    });

    // 3. Check if there are any recent, meaningful, unsaved changes from ANY collaborator.
    let liveDoc = null;
    if (allShareLinks.length > 0) {
      liveDoc = await new Promise((resolve, reject) => {
        const placeholders = allShareLinks.map(() => '?').join(',');
        const sql = `
          SELECT prosemirror_json, base_commit_hash, comments_json, share_token 
          FROM live_documents 
          WHERE share_token IN (${placeholders}) 
          ORDER BY updated_at DESC
        `;
        db.all(sql, allShareLinks, (err, rows) => {
          if (err) {
            console.error('Error checking live_documents for all collaborators:', err.message);
            return resolve(null);
          }
          
          // Find the first meaningful document
          const meaningfulDoc = rows.find(row => {
            try {
              const pmJson = JSON.parse(row.prosemirror_json);
              return pmJson.content && Array.isArray(pmJson.content) && pmJson.content.length > 0 &&
                     (pmJson.content.length > 1 || (pmJson.content[0].content && pmJson.content[0].content.length > 0));
            } catch {
              return false;
            }
          });
          resolve(meaningfulDoc || null);
        });
      });
    }
    
    // 4. If we have unsaved changes, return them
    if (liveDoc) {
      console.log(`Returning unsaved changes from token ${liveDoc.share_token} for ${linkInfo.collaborator_label}`);
      let prosemirrorJson;
      let comments = [];

      try {
        prosemirrorJson = JSON.parse(liveDoc.prosemirror_json);
        if (liveDoc.comments_json) {
          comments = JSON.parse(liveDoc.comments_json);
        }
      } catch (e) {
        console.error('Failed to parse stored JSON from live doc, rendering from branch instead:', e);
        // Fall through to branch rendering
      }

      if (prosemirrorJson) {
        return res.json({ 
          prosemirrorJson: prosemirrorJson, 
          comments: comments,
          currentCommitHash: liveDoc.base_commit_hash,
          collaboratorLabel: linkInfo.collaborator_label || null
        });
      }
    }

    // 5. If no unsaved changes, render from the collaboration branch
    console.log(`No valid unsaved changes found for shareToken ${shareToken}, rendering from branch`);
    
    // Check out the specific collaboration branch
    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    
    // Try to checkout the branch - handle local branch references
    try {
      await git.checkout({ fs: fsForGit, dir: projectDir, ref: linkInfo.collab_branch_name });
    } catch (checkoutError) {
      // If local branch doesn't exist, create it from the main branch
      if (checkoutError.message.includes('Could not find')) {
        console.log(`Branch ${linkInfo.collab_branch_name} not found locally, creating from main branch`);
        await git.branch({
          fs: fsForGit,
          dir: projectDir,
          ref: linkInfo.collab_branch_name,
          checkout: true
        });
      } else {
        throw checkoutError;
      }
    }

    // Get the current commit hash for the collaboration branch
    const commitHash = await git.resolveRef({ fs: fsForGit, dir: projectDir, ref: linkInfo.collab_branch_name });

    // Read the original QMD file to create the blockMap
    const fullFilepath = path.join(projectDir, linkInfo.filepath);
    const qmdContent = await fs.readFile(fullFilepath, 'utf8');
    
    console.log(`Processing QMD file: ${linkInfo.filepath}`);
    console.log(`Original QMD content length: ${qmdContent.length} characters`);
    
    // Extract comments from the QMD content before rendering
    const { comments: extractedComments, remainingQmdString: qmdWithoutComments } = extractCommentsAppendix(qmdContent);
    
    console.log(`Extracted ${extractedComments.length} comments from QMD`);
    console.log(`QMD content without comments length: ${qmdWithoutComments.length} characters`);
    
    // Create blockMap from the QMD content without comments
    const { blockMap } = parseQmd(qmdWithoutComments);

    // Render the document from that branch using the QMD content without comments
    // Temporarily replace the file content with the version without comments for rendering
    // so that the JATS rendering process can find the expected output file
    const originalContent = qmdContent; // We already have the original content
    await fs.writeFile(fullFilepath, qmdWithoutComments);
    
    try {
      const { jatsXml } = await renderToJATS(fullFilepath, projectDir, linkInfo.repoId, commitHash);
      const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, blockMap, linkInfo.repoId, commitHash, fullFilepath);
      
      res.json({ 
        prosemirrorJson: proseMirrorJson, 
        comments: extractedComments, // Return the extracted comments
        currentCommitHash: commitHash,
        collaboratorLabel: linkInfo.collaborator_label || null // Include collaborator label
      });
    } finally {
      // Restore the original content
      await fs.writeFile(fullFilepath, originalContent);
    }

  } catch (error) {
    console.error('Error loading collab doc:', error);
    res.status(404).json({ error: error.message });
  }
});

// POST /api/collab/:shareToken - Save changes from a collaborator
router.post('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;
  const { prosemirror_json, base_commit_hash, comments } = req.body; // Added comments

  // Validate input
  if (!prosemirror_json || !base_commit_hash) { // Comments can be optional (empty array)
    return res.status(400).json({ error: 'Missing prosemirror_json or base_commit_hash.' });
  }

  const comments_json = comments ? JSON.stringify(comments) : JSON.stringify([]); // Ensure comments_json is always a string

  try {
    // 1. Validate shareToken and get associated repo_id and filepath (if needed, or just ensure it's valid)
    // For simplicity, we'll assume share_token is unique and directly usable for UPSERT in live_documents.
    // If you need to link back to repo_id and filepath for collab docs, you'd query share_links first.
    // However, the requirement is to UPSERT based on share_token.

    const upsertSql = `
      INSERT INTO live_documents (share_token, prosemirror_json, base_commit_hash, comments_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(share_token) DO UPDATE SET
        prosemirror_json = excluded.prosemirror_json,
        base_commit_hash = excluded.base_commit_hash,
        comments_json = excluded.comments_json,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    db.get(upsertSql, [shareToken, prosemirror_json, base_commit_hash, comments_json], (err, row) => {
      if (err) {
        console.error('Error saving collab document to live_documents:', err.message);
        // Check for UNIQUE constraint violation on share_token if the share_token itself is invalid
        // or if the initial INSERT fails before ON CONFLICT.
        // However, ON CONFLICT should handle existing tokens.
        // A more specific error might be that the share_token doesn't exist if you were validating it against share_links first.
        return res.status(500).json({ error: 'Failed to save collab document.' });
      }
      if (row) {
        res.status(200).json({ message: 'Collab document saved successfully.', id: row.id });
      } else {
        // Fallback if RETURNING id is not supported or fails
        db.get("SELECT id FROM live_documents WHERE share_token = ?", [shareToken], (err, newRow) => {
            if (err) {
                console.error('Error retrieving saved collab document id:', err.message);
                return res.status(500).json({ error: 'Failed to retrieve collab document id after save.' });
            }
            if (newRow) {
                res.status(200).json({ message: 'Collab document saved successfully.', id: newRow.id });
            } else {
                // This could mean the share_token is invalid if we were to check it first.
                // Or some other persistent save error.
                res.status(404).json({ error: 'Failed to save or find collab document. Invalid share token?' });
            }
        });
      }
    });

  } catch (error) { // Catch any synchronous errors or promise rejections from db.get if not handled by callback
    console.error('Error in POST /api/collab/:shareToken:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// POST /api/collab/:shareToken/commit-qmd - Commit changes from live document to collab branch
router.post('/:shareToken/commit-qmd', async (req, res) => {
  const { shareToken } = req.params;
  const { base_commit_hash } = req.body;

  if (!base_commit_hash) {
    return res.status(400).json({ error: 'Missing required field: base_commit_hash.' });
  }

  try {
    // 1. Retrieve stored JSON and comments from live_documents
    const liveDoc = await new Promise((resolve, reject) => {
      // Fetch both prosemirror_json and comments_json
      db.get('SELECT prosemirror_json, comments_json FROM live_documents WHERE share_token = ?', [shareToken], (err, row) => {
        if (err) return reject(new Error(`Database error fetching live document: ${err.message}`));
        if (!row) return reject(new Error('No live document found for this share token. Save changes first.'));
        resolve(row);
      });
    });

    let parsedProsemirrorJson;
    let parsedCommentsArray = []; // Default to empty array

    try {
      parsedProsemirrorJson = JSON.parse(liveDoc.prosemirror_json);
      if (liveDoc.comments_json) {
        parsedCommentsArray = JSON.parse(liveDoc.comments_json);
      }
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse stored Prosemirror JSON or comments JSON.' });
    }

    // 2. Retrieve link information (collab_branch_name, filepath, repo.full_name)
    //    AND the user_id who created the share link.
    const linkAndUserInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT
          s.collab_branch_name,
          s.user_id,
          s.collaborator_label,
          d.filepath,
          r.full_name,
          u.username
        FROM share_links s
        JOIN documents d ON s.doc_id = d.id
        JOIN repositories r ON d.repo_id = r.id
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.share_token = ?
      `;
      db.get(sql, [shareToken], (err, row) => {
        if (err) return reject(new Error(`Database error fetching link and user info: ${err.message}`));
        if (!row) return reject(new Error('Invalid share link or associated user not found.'));
        if (!row.user_id) return reject(new Error('Share link is not associated with a user.')); // Should not happen with FK
        if (!row.username) { // If user was deleted but link persists, or if JOIN failed to find user
            console.warn(`User not found for user_id ${row.user_id} associated with shareToken ${shareToken}. Using default author.`);
            // Provide default values if username is not found to allow commit to proceed
            resolve({ ...row, username: 'UnknownUser' });
        } else {
            resolve(row);
        }
      });
    });

    const projectDir = path.join(REPOS_DIR, linkAndUserInfo.full_name);
    const collabBranchName = linkAndUserInfo.collab_branch_name;
    const collabFilepath = linkAndUserInfo.filepath;
    // Use collaborator_label as author name if available, otherwise fall back to username
    const authorName = linkAndUserInfo.collaborator_label || linkAndUserInfo.username;
    // Assuming email is not stored, create a placeholder.
    // If github_id is available on users table and preferred, it could be used.
    // For now, username@domain or user_id@domain.
    const authorEmail = `${authorName.replace(/\s+/g, '_')}@quartorium.app`;


    // 3. Checkout collab branch
    // Try to checkout the branch - handle local branch references
    try {
      await git.checkout({ fs: fsForGit, dir: projectDir, ref: collabBranchName });
    } catch (checkoutError) {
      // If local branch doesn't exist, create it from the main branch
      if (checkoutError.message.includes('Could not find')) {
        console.log(`Branch ${collabBranchName} not found locally, creating from main branch`);
        await git.branch({
          fs: fsForGit,
          dir: projectDir,
          ref: collabBranchName,
          checkout: true
        });
      } else {
        throw checkoutError;
      }
    }
    console.log(`Checked out ${collabBranchName} for repo ${linkAndUserInfo.full_name}`);

    // 4. Fetch original QMD content from base_commit_hash on the collab branch
    let originalQmdContent;
    try {
      const relativeFilepath = path.relative(projectDir, path.join(projectDir, collabFilepath)); // Ensure filepath is relative for readBlob
      const blobData = await git.readBlob({ fs: fsForGit, dir: projectDir, oid: base_commit_hash, filepath: relativeFilepath });
      originalQmdContent = Buffer.from(blobData.blob).toString('utf8');
    } catch (e) {
        console.warn(`Failed to read blob for ${collabFilepath} at ${base_commit_hash} on branch ${collabBranchName}: ${e.message}. Assuming new file or attempting HEAD.`);
        try {
            // Fallback: try reading from the current HEAD of the branch if blob read fails
            originalQmdContent = await fs.readFile(path.join(projectDir, collabFilepath), 'utf8');
        } catch (readError) {
            console.warn(`File ${collabFilepath} not found in ${collabBranchName} HEAD after blob read failure. Assuming new file.`);
            originalQmdContent = ""; // If file doesn't exist at all (e.g. first commit of this file)
        }
    }

    // 5. Extract YAML from originalQmdContent and Convert JSON to QMD
    // Ensure originalQmdContent is defined, even if empty, for gray-matter
    const currentOriginalQmdContent = originalQmdContent || '';
    const { data: yamlObject } = matter(currentOriginalQmdContent);

    // Create a YAML string. If yamlObject is empty, matter.stringify returns '---\n{}\n---' or similar.
    // We want an empty string if no actual YAML, or just '--- \n ---' for empty frontmatter
    let yamlString = '';
    if (Object.keys(yamlObject).length > 0) {
      yamlString = matter.stringify('', yamlObject); // This prepends '---' and appends '---'
    } else if (currentOriginalQmdContent.startsWith('---')) {
      // If original content started with --- but had no actual data, preserve that.
      // This case might need refinement based on how `matter` handles truly empty YAML.
      // For an empty YAML block like "--- \n ---", yamlObject will be empty.
      // matter.stringify('', {}) might produce "--- {}\n ---"
      // We want to ensure it's either a valid YAML string or an empty string if no frontmatter.
      // A simple check: if original started with '---' and yamlObject is empty, it was an empty block.
      const lines = currentOriginalQmdContent.split('\n');
      if (lines.length >= 2 && lines[0].trim() === '---' && lines[1].trim() === '---') {
        yamlString = '---\n---\n';
      } else if (Object.keys(yamlObject).length > 0) {
         yamlString = matter.stringify('', yamlObject);
      } else {
         yamlString = ''; // No frontmatter
      }
    }


    const newQmdContent = proseMirrorJSON_to_qmd(parsedProsemirrorJson, currentOriginalQmdContent, parsedCommentsArray);

    // 6. Write and commit to collab branch
    const fullCollabFilepath = path.join(projectDir, collabFilepath);
    await fs.writeFile(fullCollabFilepath, newQmdContent);
    await git.add({ fs: fsForGit, dir: projectDir, filepath: collabFilepath }); // filepath relative to repo root

    const newCommitHash = await git.commit({
      fs: fsForGit,
      dir: projectDir,
      message: `Quartorium Collab: Update ${collabFilepath} by ${authorName}`, // Added author name to message
      author: { name: authorName, email: authorEmail }, // Use fetched user details
    });

    // 7. Cleanup: Delete the entry from live_documents for this shareToken
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM live_documents WHERE share_token = ?', [shareToken], function(err) {
        if (err) {
          console.error(`Failed to delete from live_documents for shareToken ${shareToken}: ${err.message}`);
          // Don't reject, commit was successful. Log error.
        }
        console.log(`Cleaned up live_document for shareToken ${shareToken}`);
        resolve();
      });
    });

    res.json({ message: 'Committed to collaboration branch successfully.', newCommitHash });

  } catch (error) {
    console.error('Error committing QMD to collaboration branch:', error);
     if (error.message.includes("No live document") || error.message.includes("Invalid share link")) {
        return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: `Failed to commit to collaboration branch: ${error.message}` });
  }
});

// POST /api/collab/:shareToken/track-comment - Track when a comment is added
router.post('/:shareToken/track-comment', async (req, res) => {
  const { shareToken } = req.params;
  const { collaboratorLabel } = req.body;

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // Update the live_documents table to indicate a comment was added
    await new Promise((resolve, reject) => {
      const sql = `
        UPDATE live_documents 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE share_token = ?
      `;
      db.run(sql, [shareToken], function(err) {
        if (err) return reject(err);
        resolve();
      });
    });

    res.json({ message: 'Comment tracked successfully' });

  } catch (error) {
    console.error('Error tracking comment:', error);
    res.status(500).json({ error: error.message || 'Failed to track comment.' });
  }
});

// Branch locking endpoints
// POST /api/collab/:shareToken/lock - Acquire a lock on the collaboration branch
router.post('/:shareToken/lock', async (req, res) => {
  const { shareToken } = req.params;
  const { collaboratorLabel, lockDuration = 30 } = req.body; // lockDuration in minutes

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // Check if branch is already locked by someone else
    const existingLock = await new Promise((resolve) => {
      const sql = `
        SELECT * FROM branch_locks 
        WHERE repo_id = ? AND branch_name = ? AND is_active = 1 
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND locked_by_collaborator_label != ?
      `;
      db.get(sql, [linkInfo.repoId, linkInfo.collab_branch_name, collaboratorLabel], (err, row) => {
        if (err) resolve(null);
        else resolve(row);
      });
    });

    if (existingLock) {
      const lockInfo = {
        lockedBy: existingLock.locked_by_collaborator_label || 'Unknown',
        lockedAt: existingLock.locked_at,
        expiresAt: existingLock.expires_at
      };
      return res.status(409).json({ 
        error: 'Branch is already locked', 
        lockInfo 
      });
    }

    // Check if this collaborator already has a lock
    const myExistingLock = await new Promise((resolve) => {
      const sql = `
        SELECT * FROM branch_locks 
        WHERE repo_id = ? AND branch_name = ? AND is_active = 1 
        AND locked_by_collaborator_label = ?
      `;
      db.get(sql, [linkInfo.repoId, linkInfo.collab_branch_name, collaboratorLabel], (err, row) => {
        if (err) resolve(null);
        else resolve(row);
      });
    });

    // If I already have a lock, extend it
    if (myExistingLock) {
      const expiresAt = new Date(Date.now() + lockDuration * 60 * 1000).toISOString();
      await new Promise((resolve, reject) => {
        const sql = `
          UPDATE branch_locks 
          SET expires_at = ?, locked_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        db.run(sql, [expiresAt, myExistingLock.id], function(err) {
          if (err) return reject(err);
          resolve(this.changes);
        });
      });

      return res.json({ 
        message: 'Branch lock extended successfully',
        expiresAt,
        lockDuration
      });
    }

    // Create new lock
    const expiresAt = new Date(Date.now() + lockDuration * 60 * 1000).toISOString();
    await new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO branch_locks 
        (repo_id, branch_name, locked_by_collaborator_label, expires_at, is_active) 
        VALUES (?, ?, ?, ?, 1)
      `;
      db.run(sql, [linkInfo.repoId, linkInfo.collab_branch_name, collaboratorLabel, expiresAt], function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      });
    });

    res.json({ 
      message: 'Branch locked successfully',
      expiresAt,
      lockDuration
    });

  } catch (error) {
    console.error('Error acquiring branch lock:', error);
    res.status(500).json({ error: error.message || 'Failed to acquire lock.' });
  }
});

// DELETE /api/collab/:shareToken/lock - Release a lock on the collaboration branch
router.delete('/:shareToken/lock', async (req, res) => {
  const { shareToken } = req.params;
  const { collaboratorLabel } = req.body;

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // Check if the lock belongs to this collaborator
    const existingLock = await new Promise((resolve) => {
      const sql = `
        SELECT * FROM branch_locks 
        WHERE repo_id = ? AND branch_name = ? AND is_active = 1
        AND locked_by_collaborator_label = ?
      `;
      db.get(sql, [linkInfo.repoId, linkInfo.collab_branch_name, collaboratorLabel], (err, row) => {
        if (err) resolve(null);
        else resolve(row);
      });
    });

    if (!existingLock) {
      return res.status(404).json({ error: 'No active lock found for this collaborator.' });
    }

    // Release the lock
    await new Promise((resolve, reject) => {
      const sql = `UPDATE branch_locks SET is_active = 0 WHERE id = ?`;
      db.run(sql, [existingLock.id], function(err) {
        if (err) return reject(err);
        resolve();
      });
    });

    res.json({ message: 'Branch lock released successfully' });

  } catch (error) {
    console.error('Error releasing branch lock:', error);
    res.status(500).json({ error: error.message || 'Failed to release lock.' });
  }
});

// GET /api/collab/:shareToken/lock-status - Get current lock status
router.get('/:shareToken/lock-status', async (req, res) => {
  const { shareToken } = req.params;
  const { collaboratorLabel } = req.query; // Get collaborator label from query params

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // Get all active locks for this branch
    const activeLocks = await new Promise((resolve) => {
      const sql = `
        SELECT * FROM branch_locks 
        WHERE repo_id = ? AND branch_name = ? AND is_active = 1 
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY locked_at DESC
      `;
      db.all(sql, [linkInfo.repoId, linkInfo.collab_branch_name], (err, rows) => {
        if (err || !rows) resolve([]);
        else resolve(rows);
      });
    });

    // Clean up any expired locks
    const now = new Date();
    const validLocks = activeLocks.filter(lock => {
      if (lock.expires_at) {
        const expiresAt = new Date(lock.expires_at);
        if (now > expiresAt) {
          // Clean up the expired lock
          db.run('UPDATE branch_locks SET is_active = 0 WHERE id = ?', [lock.id], (err) => {
            if (err) console.error('Error cleaning up expired lock:', err.message);
          });
          return false;
        }
      }
      return true;
    });

    // Find my lock if I have one
    const myLock = validLocks.find(lock => lock.locked_by_collaborator_label === collaboratorLabel);
    
    // Find other people's locks
    const otherLocks = validLocks.filter(lock => lock.locked_by_collaborator_label !== collaboratorLabel);

    // Determine lock status
    let isLocked = false;
    let lockInfo = null;
    let isLockedByMe = false;

    if (myLock) {
      // I have a lock
      isLocked = true;
      isLockedByMe = true;
      lockInfo = {
        lockedBy: myLock.locked_by_collaborator_label,
        lockedAt: myLock.locked_at,
        expiresAt: myLock.expires_at
      };
    } else if (otherLocks.length > 0) {
      // Someone else has a lock
      isLocked = true;
      isLockedByMe = false;
      lockInfo = {
        lockedBy: otherLocks[0].locked_by_collaborator_label,
        lockedAt: otherLocks[0].locked_at,
        expiresAt: otherLocks[0].expires_at
      };
    }

    res.json({ 
      isLocked,
      isLockedByMe,
      lockInfo,
      allLocks: validLocks.map(lock => ({
        lockedBy: lock.locked_by_collaborator_label,
        lockedAt: lock.locked_at,
        expiresAt: lock.expires_at
      }))
    });

  } catch (error) {
    console.error('Error getting lock status:', error);
    res.status(500).json({ error: error.message || 'Failed to get lock status.' });
  }
});

// GET /api/collab/:shareToken/recent-changes - Get recent changes from all collaborators
router.get('/:shareToken/recent-changes', async (req, res) => {
  const { shareToken } = req.params;
  const { since } = req.query; // Optional timestamp to get changes since a specific time

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
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

    // Get all share links for the same document
    const allShareLinks = await new Promise((resolve) => {
      const sql = `
        SELECT s.*, r.full_name
        FROM share_links s 
        JOIN repositories r ON s.repo_id = r.id 
        WHERE s.doc_id = (SELECT doc_id FROM share_links WHERE share_token = ?)
        AND s.share_token != ?
      `;
      db.all(sql, [shareToken, shareToken], (err, rows) => {
        if (err) resolve([]);
        else resolve(rows);
      });
    });

    // Get live changes from all collaborators
    const liveChanges = await new Promise((resolve) => {
      const sql = `
        SELECT ld.*, sl.collaborator_label, sl.share_token
        FROM live_documents ld
        JOIN share_links sl ON ld.share_token = sl.share_token
        WHERE sl.doc_id = (SELECT doc_id FROM share_links WHERE share_token = ?)
        AND ld.share_token != ?
        ${since ? 'AND ld.updated_at > ?' : ''}
        ORDER BY ld.updated_at DESC
      `;
      const params = since ? [shareToken, shareToken, since] : [shareToken, shareToken];
      db.all(sql, params, (err, rows) => {
        if (err) resolve([]);
        else resolve(rows);
      });
    });

    // Get recent commits from all collaboration branches
    const recentCommits = [];
    for (const link of allShareLinks) {
      try {
        const projectDir = path.join(REPOS_DIR, link.full_name);
        
        // Get recent commits from this collaborator's branch
        const commits = await git.log({
          fs: fsForGit,
          dir: projectDir,
          ref: link.collab_branch_name,
          depth: 5 // Get last 5 commits
        });

        commits.forEach(commit => {
          recentCommits.push({
            hash: commit.oid,
            message: commit.commit.message,
            author: commit.commit.author.name,
            timestamp: new Date(commit.commit.author.timestamp * 1000).toISOString(),
            collaboratorLabel: link.collaborator_label,
            branchName: link.collab_branch_name
          });
        });
      } catch (error) {
        console.error(`Error getting commits for ${link.collab_branch_name}:`, error.message);
      }
    }

    // Sort commits by timestamp
    recentCommits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      liveChanges: liveChanges.map(change => ({
        collaboratorLabel: change.collaborator_label,
        updatedAt: change.updated_at,
        hasUnsavedChanges: true
      })),
      recentCommits: recentCommits.slice(0, 10), // Return last 10 commits
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting recent changes:', error);
    res.status(500).json({ error: error.message || 'Failed to get recent changes.' });
  }
});

// GET /api/collab/:shareToken/info - Get share link information
router.get('/:shareToken/info', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // Get share link information
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name, s.collaborator_label
        FROM share_links s 
        JOIN documents d ON s.doc_id = d.id 
        JOIN repositories r ON d.repo_id = r.id 
        WHERE s.share_token = ?
      `;
      db.get(sql, [shareToken], (err, row) => {
        if (err || !row) return reject(new Error('Invalid share link.'));
        console.log('Share link info for /info endpoint:', row);
        resolve(row);
      });
    });

    res.json({
      shareToken: linkInfo.share_token,
      collaboratorLabel: linkInfo.collaborator_label,
      collabBranchName: linkInfo.collab_branch_name,
      filepath: linkInfo.filepath,
      repoName: linkInfo.full_name
    });

  } catch (error) {
    console.error('Error getting share link info:', error);
    res.status(404).json({ error: error.message });
  }
});

module.exports = router;

