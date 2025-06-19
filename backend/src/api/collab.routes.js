const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git'); // Re-add for GET endpoint
const fs = require('fs/promises');
const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser');
// Import our new serializer - NO LONGER NEEDED for POST
const { proseMirrorJSON_to_qmd } = require('../core/astSerializer'); // Needed for commit
// Import the QMD parser to create blockMap
const { parseQmd } = require('../core/qmdBlockParser'); // Potentially needed if astSerializer requires full parsing for context

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

// GET /api/collab/:shareToken - Load the document for a collaborator
router.get('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. First, check if there are any unsaved changes in live_documents
    const liveDoc = await new Promise((resolve, reject) => {
      db.get('SELECT prosemirror_json, base_commit_hash FROM live_documents WHERE share_token = ?', [shareToken], (err, row) => {
        if (err) {
          console.error('Error checking live_documents:', err.message);
          resolve(null); // Continue with branch rendering if there's a DB error
        } else {
          resolve(row);
        }
      });
    });

    // 2. If we have unsaved changes, return them
    if (liveDoc) {
      console.log(`Returning unsaved changes for shareToken ${shareToken}`);
      let prosemirrorJson;
      try {
        prosemirrorJson = JSON.parse(liveDoc.prosemirror_json);
      } catch (e) {
        console.error('Failed to parse stored prosemirror_json:', e);
        // Fall through to branch rendering if parsing fails
      }
      
      if (prosemirrorJson) {
        return res.json({ 
          prosemirrorJson: prosemirrorJson, 
          currentCommitHash: liveDoc.base_commit_hash 
        });
      }
    }

    // 3. If no unsaved changes, render from the collaboration branch
    console.log(`No unsaved changes found for shareToken ${shareToken}, rendering from branch`);
    
    // Find the share link and associated document/repo info
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.*, d.filepath, r.id as repoId, r.full_name 
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

    // Check out the specific collaboration branch
    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });

    // Get the current commit hash for the collaboration branch
    const commitHash = await git.resolveRef({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });

    // Read the original QMD file to create the blockMap
    const fullFilepath = path.join(projectDir, linkInfo.filepath);
    const qmdContent = await fs.readFile(fullFilepath, 'utf8');
    const { blockMap } = parseQmd(qmdContent);

    // Render the document from that branch
    const { jatsXml } = await renderToJATS(fullFilepath, projectDir, linkInfo.repoId, commitHash);
    const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, blockMap, linkInfo.repoId, commitHash, fullFilepath);
    
    res.json({ prosemirrorJson: proseMirrorJson, currentCommitHash: commitHash });

  } catch (error) {
    console.error('Error loading collab doc:', error);
    res.status(404).json({ error: error.message });
  }
});

// POST /api/collab/:shareToken - Save changes from a collaborator
router.post('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;
  const { prosemirror_json, base_commit_hash } = req.body;

  // Validate input
  if (!prosemirror_json || !base_commit_hash) {
    return res.status(400).json({ error: 'Missing prosemirror_json or base_commit_hash.' });
  }

  try {
    // 1. Validate shareToken and get associated repo_id and filepath (if needed, or just ensure it's valid)
    // For simplicity, we'll assume share_token is unique and directly usable for UPSERT in live_documents.
    // If you need to link back to repo_id and filepath for collab docs, you'd query share_links first.
    // However, the requirement is to UPSERT based on share_token.

    const upsertSql = `
      INSERT INTO live_documents (share_token, prosemirror_json, base_commit_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(share_token) DO UPDATE SET
        prosemirror_json = excluded.prosemirror_json,
        base_commit_hash = excluded.base_commit_hash,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    db.get(upsertSql, [shareToken, prosemirror_json, base_commit_hash], (err, row) => {
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
    // 1. Retrieve stored JSON from live_documents
    const liveDoc = await new Promise((resolve, reject) => {
      db.get('SELECT prosemirror_json FROM live_documents WHERE share_token = ?', [shareToken], (err, row) => {
        if (err) return reject(new Error(`Database error fetching live document: ${err.message}`));
        if (!row) return reject(new Error('No live document found for this share token. Save changes first.'));
        resolve(row);
      });
    });

    let parsedProsemirrorJson;
    try {
      parsedProsemirrorJson = JSON.parse(liveDoc.prosemirror_json);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse stored Prosemirror JSON.' });
    }

    // 2. Retrieve link information (collab_branch_name, filepath, repo.full_name)
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.collab_branch_name, d.filepath, r.full_name
        FROM share_links s
        JOIN documents d ON s.doc_id = d.id
        JOIN repositories r ON d.repo_id = r.id
        WHERE s.share_token = ?
      `;
      db.get(sql, [shareToken], (err, row) => {
        if (err) return reject(new Error(`Database error fetching link info: ${err.message}`));
        if (!row) return reject(new Error('Invalid share link.'));
        resolve(row);
      });
    });

    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    const collabBranchName = linkInfo.collab_branch_name;
    const collabFilepath = linkInfo.filepath;

    // 3. Checkout collab branch
    await git.checkout({ fs, dir: projectDir, ref: collabBranchName });
    console.log(`Checked out ${collabBranchName} for repo ${linkInfo.full_name}`);

    // 4. Fetch original QMD content from base_commit_hash on the collab branch
    let originalQmdContent;
    try {
      const relativeFilepath = path.relative(projectDir, path.join(projectDir, collabFilepath));
      const blobData = await git.readBlob({ fs, dir: projectDir, oid: base_commit_hash, filepath: relativeFilepath });
      originalQmdContent = Buffer.from(blobData.blob).toString('utf8');
    } catch (e) {
        console.warn(`Failed to read blob for ${collabFilepath} at ${base_commit_hash} on branch ${collabBranchName}: ${e.message}. Assuming new file or attempting HEAD.`);
        try {
            originalQmdContent = await fs.readFile(path.join(projectDir, collabFilepath), 'utf8');
        } catch (readError) {
            console.warn(`File ${collabFilepath} not found in ${collabBranchName} HEAD. Assuming new file.`);
            originalQmdContent = "";
        }
    }

    // 5. Convert JSON to QMD
    const newQmdContent = proseMirrorJSON_to_qmd(parsedProsemirrorJson, originalQmdContent);

    // 6. Write and commit to collab branch
    const fullCollabFilepath = path.join(projectDir, collabFilepath);
    await fs.writeFile(fullCollabFilepath, newQmdContent);
    await git.add({ fs, dir: projectDir, filepath: collabFilepath }); // filepath relative to repo root

    const newCommitHash = await git.commit({
      fs,
      dir: projectDir,
      message: `Quartorium Collab: Update ${collabFilepath}`,
      // TODO: Consider if author info can be more specific, e.g., from a user session if collaborator is logged in,
      // or a generic collaborator name if they are anonymous.
      author: { name: 'Quartorium Collaborator', email: 'collaborator@quartorium.app' },
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


module.exports = router;