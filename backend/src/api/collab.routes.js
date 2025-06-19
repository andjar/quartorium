const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git'); // Re-add for GET endpoint
const fs = require('fs/promises');
const matter = require('gray-matter'); // For YAML extraction
const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser'); // Keep for GET, might remove if GET switches path
// const { proseMirrorJSON_to_qmd } = require('../core/astSerializer'); // Replaced by new serializer
const { proseMirrorToQmd } = require('../core/quartoSerializer'); // New serializer
// Import the QMD parser to create blockMap - still needed for GET /:shareToken if rendering from branch
const { parseQmd } = require('../core/qmdBlockParser');

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

    // 2. Check if there are any unsaved changes in live_documents
    const liveDoc = await new Promise((resolve, reject) => {
      // Updated SELECT query to include comments_json
      db.get('SELECT prosemirror_json, base_commit_hash, comments_json FROM live_documents WHERE share_token = ?', [shareToken], (err, row) => {
        if (err) {
          console.error('Error checking live_documents:', err.message);
          resolve(null); // Continue with branch rendering if there's a DB error
        } else {
          resolve(row);
        }
      });
    });

    // 3. If we have unsaved changes, return them
    if (liveDoc) {
      console.log(`Returning unsaved changes for shareToken ${shareToken}`);
      let prosemirrorJson;
      let comments = []; // Default to empty array for comments

      try {
        prosemirrorJson = JSON.parse(liveDoc.prosemirror_json);
        if (liveDoc.comments_json) {
          comments = JSON.parse(liveDoc.comments_json);
        }
      } catch (e) {
        console.error('Failed to parse stored JSON (ProseMirror or comments):', e);
        // Fall through to branch rendering if parsing fails, prosemirrorJson might be null
      }
      
      if (prosemirrorJson) { // Only return if prosemirrorJson is valid
        return res.json({ 
          prosemirrorJson: prosemirrorJson, 
          comments: comments, // Include comments in the response
          currentCommitHash: liveDoc.base_commit_hash,
          collaboratorLabel: linkInfo.collaborator_label || null // Include collaborator label
        });
      }
    }

    // 4. If no unsaved changes (or live doc parsing failed), render from the collaboration branch
    console.log(`No valid unsaved changes found for shareToken ${shareToken}, rendering from branch`);
    
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
    // NOTE: This path (rendering from branch) currently uses the JATS pipeline,
    // which doesn't inherently know about comments in the format this subtask is implementing.
    // For consistency, if this route is used, it should ideally also use qmdToProseMirror
    // which extracts comments from the QMD appendix if they were committed.
    // However, the subtask focuses on live save/load and commit serialization.
    // So, for now, this part will return empty comments if it falls through to here.
    const { jatsXml } = await renderToJATS(fullFilepath, projectDir, linkInfo.repoId, commitHash);
    const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, blockMap, linkInfo.repoId, commitHash, fullFilepath);
    
    // When rendering from branch, comments would need to be parsed from the QMD file itself
    // using the logic from `extractCommentsAppendix` if we were to use the remark path here.
    // Since we are using JATS path here, we'll return empty comments.
    // Or, if the /api/docs/view endpoint is the primary one for viewing, it would handle this.
    res.json({ 
      prosemirrorJson: proseMirrorJson, 
      comments: [], 
      currentCommitHash: commitHash,
      collaboratorLabel: linkInfo.collaborator_label || null // Include collaborator label
    });

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
    await git.checkout({ fs, dir: projectDir, ref: collabBranchName });
    console.log(`Checked out ${collabBranchName} for repo ${linkAndUserInfo.full_name}`);

    // 4. Fetch original QMD content from base_commit_hash on the collab branch
    let originalQmdContent;
    try {
      const relativeFilepath = path.relative(projectDir, path.join(projectDir, collabFilepath)); // Ensure filepath is relative for readBlob
      const blobData = await git.readBlob({ fs, dir: projectDir, oid: base_commit_hash, filepath: relativeFilepath });
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


    const newQmdContent = proseMirrorToQmd(parsedProsemirrorJson, parsedCommentsArray, yamlString);

    // 6. Write and commit to collab branch
    const fullCollabFilepath = path.join(projectDir, collabFilepath);
    await fs.writeFile(fullCollabFilepath, newQmdContent);
    await git.add({ fs, dir: projectDir, filepath: collabFilepath }); // filepath relative to repo root

    const newCommitHash = await git.commit({
      fs,
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


module.exports = router;