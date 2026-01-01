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

// IMPORTANT: These routes must come BEFORE the /:shareToken routes
// because Express matches routes in order

// POST /api/collab/reaction - Add or update a reaction to a comment
router.post('/reaction', async (req, res) => {
  console.log('POST /api/collab/reaction body:', req.body);
  const { commentId, sourceShareToken, reactorShareToken, reactionType } = req.body;

  if (!commentId || !sourceShareToken || !reactorShareToken || !reactionType) {
    console.log('Missing required fields:', { commentId, sourceShareToken, reactorShareToken, reactionType });
    return res.status(400).json({ 
      error: 'Missing required fields.',
      received: { commentId, sourceShareToken, reactorShareToken, reactionType }
    });
  }

  if (!['thumbs_up', 'thumbs_down'].includes(reactionType)) {
    return res.status(400).json({ error: 'Invalid reaction type. Must be thumbs_up or thumbs_down.' });
  }

  try {
    // Get reactor label
    const reactorInfo = await new Promise((resolve, reject) => {
      db.get('SELECT collaborator_label FROM share_links WHERE share_token = ?', 
        [reactorShareToken], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
    });

    const reactorLabel = reactorInfo ? reactorInfo.collaborator_label : 'Unknown';

    // Upsert the reaction
    const sql = `
      INSERT INTO comment_reactions (comment_id, source_share_token, reactor_share_token, reactor_label, reaction_type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(comment_id, source_share_token, reactor_share_token) 
      DO UPDATE SET reaction_type = excluded.reaction_type, created_at = CURRENT_TIMESTAMP
    `;
    
    await new Promise((resolve, reject) => {
      db.run(sql, [commentId, sourceShareToken, reactorShareToken, reactorLabel, reactionType], function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });

    res.json({ message: 'Reaction saved successfully', reactionType });

  } catch (error) {
    console.error('Error saving reaction:', error);
    res.status(500).json({ error: error.message || 'Failed to save reaction.' });
  }
});

// DELETE /api/collab/reaction - Remove a reaction
router.delete('/reaction', async (req, res) => {
  const { commentId, sourceShareToken, reactorShareToken } = req.body;

  if (!commentId || !sourceShareToken || !reactorShareToken) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM comment_reactions WHERE comment_id = ? AND source_share_token = ? AND reactor_share_token = ?',
        [commentId, sourceShareToken, reactorShareToken],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });

    res.json({ message: 'Reaction removed successfully' });

  } catch (error) {
    console.error('Error removing reaction:', error);
    res.status(500).json({ error: error.message || 'Failed to remove reaction.' });
  }
});

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

// GET /api/collab/:shareToken/recent-changes - Get recent changes from all collaborators
router.get('/:shareToken/recent-changes', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. Get info about the current request
    const linkInfo = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.doc_id, s.collab_branch_name, r.full_name
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

    // 2. Get all share tokens for the same document to find all live changes
    const allShareLinks = await new Promise((resolve, reject) => {
      const sql = `SELECT share_token, collaborator_label FROM share_links WHERE doc_id = ?`;
      db.all(sql, [linkInfo.doc_id], (err, rows) => {
        if (err) return reject(new Error('Could not query for sibling share links.'));
        resolve(rows);
      });
    });

    // 3. Get all live (unsaved) changes for this document
    const liveChanges = await new Promise((resolve, reject) => {
      if (!allShareLinks.length) return resolve([]);
      const tokens = allShareLinks.map(l => l.share_token);
      const placeholders = tokens.map(() => '?').join(',');
      const sql = `
        SELECT share_token, updated_at FROM live_documents
        WHERE share_token IN (${placeholders})
        ORDER BY updated_at DESC
      `;
      db.all(sql, tokens, (err, rows) => {
        if (err) return reject(new Error('Could not query live documents.'));
        
        // Map collaborator label back to the live change
        const changesWithLabels = rows.map(row => {
          const link = allShareLinks.find(l => l.share_token === row.share_token);
          return {
            ...row,
            collaboratorLabel: link ? link.collaborator_label : 'Unknown'
          };
        });
        resolve(changesWithLabels);
      });
    });
    
    // 4. Get recent commits from the single shared collaboration branch
    const recentCommits = [];
    try {
      const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
      const commits = await git.log({
        fs: fsForGit,
        dir: projectDir,
        ref: linkInfo.collab_branch_name,
        depth: 5
      });
      recentCommits.push(...commits.map(c => c));
    } catch (error) {
      console.error(`Error getting commits for ${linkInfo.collab_branch_name}:`, error.message);
    }

    // 5. Send the combined and sorted data to the client
    res.json({
      liveChanges: liveChanges,
      recentCommits: recentCommits.map(commit => ({
        hash: commit.oid,
        message: commit.commit.message,
        author: commit.commit.author.name,
        timestamp: new Date(commit.commit.author.timestamp * 1000).toISOString()
      }))
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

// Helper function to compute paragraph hashes for change detection
function computeParagraphHashes(prosemirrorJson) {
  const hashes = [];
  if (!prosemirrorJson || !prosemirrorJson.content) return hashes;
  
  prosemirrorJson.content.forEach((node, index) => {
    // Get text content from node
    let textContent = '';
    if (node.content) {
      node.content.forEach(child => {
        if (child.text) textContent += child.text;
        else if (child.content) {
          child.content.forEach(grandchild => {
            if (grandchild.text) textContent += grandchild.text;
          });
        }
      });
    }
    
    // Content-based hash using first 30 chars (for matching) + full length
    const trimmedText = textContent.trim();
    const contentHash = trimmedText.substring(0, 30) + '_' + trimmedText.length;
    
    hashes.push({
      index,
      type: node.type,
      contentHash: contentHash,
      // Also store a "fuzzy" hash using just first few words for looser matching
      fuzzyHash: trimmedText.split(/\s+/).slice(0, 5).join(' ').toLowerCase(),
      preview: trimmedText.substring(0, 100),
      fullText: trimmedText
    });
  });
  
  return hashes;
}

// Content-based diff: finds actual additions, removals, and modifications
function computeContentBasedChanges(currentHashes, siblingHashes) {
  const changes = [];
  
  // Create lookup maps by content hash
  const currentByHash = new Map();
  const siblingByHash = new Map();
  
  currentHashes.forEach(h => {
    if (!currentByHash.has(h.contentHash)) {
      currentByHash.set(h.contentHash, []);
    }
    currentByHash.get(h.contentHash).push(h);
  });
  
  siblingHashes.forEach(h => {
    if (!siblingByHash.has(h.contentHash)) {
      siblingByHash.set(h.contentHash, []);
    }
    siblingByHash.get(h.contentHash).push(h);
  });
  
  // Track which paragraphs have been matched
  const matchedCurrentIndices = new Set();
  const matchedSiblingIndices = new Set();
  
  // First pass: exact content matches (same paragraph, possibly moved)
  siblingHashes.forEach(siblingPara => {
    if (currentByHash.has(siblingPara.contentHash)) {
      const currentMatches = currentByHash.get(siblingPara.contentHash);
      const unmatched = currentMatches.find(c => !matchedCurrentIndices.has(c.index));
      if (unmatched) {
        matchedCurrentIndices.add(unmatched.index);
        matchedSiblingIndices.add(siblingPara.index);
        // Same content - no change needed
      }
    }
  });
  
  // Second pass: find modifications using fuzzy matching
  siblingHashes.forEach(siblingPara => {
    if (matchedSiblingIndices.has(siblingPara.index)) return;
    
    // Try to find a paragraph with similar starting content that wasn't matched
    let bestMatch = null;
    let bestMatchScore = 0;
    
    currentHashes.forEach(currentPara => {
      if (matchedCurrentIndices.has(currentPara.index)) return;
      
      // Check fuzzy hash match
      if (siblingPara.fuzzyHash && currentPara.fuzzyHash) {
        const fuzzyMatch = siblingPara.fuzzyHash === currentPara.fuzzyHash;
        if (fuzzyMatch) {
          // This is likely a modified version of the same paragraph
          const score = 2;
          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatch = currentPara;
          }
        }
      }
      
      // Check if same approximate position (within 2 positions) as fallback
      if (!bestMatch && Math.abs(siblingPara.index - currentPara.index) <= 2) {
        // Check if there's some text similarity
        const sibWords = new Set(siblingPara.fullText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const curWords = new Set(currentPara.fullText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let overlap = 0;
        sibWords.forEach(w => { if (curWords.has(w)) overlap++; });
        
        if (sibWords.size > 0 && overlap / sibWords.size > 0.3) {
          const score = 1;
          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatch = currentPara;
          }
        }
      }
    });
    
    if (bestMatch) {
      // This is a modification
      matchedCurrentIndices.add(bestMatch.index);
      matchedSiblingIndices.add(siblingPara.index);
      changes.push({
        index: siblingPara.index,
        changeType: 'modified',
        nodeType: siblingPara.type,
        preview: siblingPara.preview
      });
    }
  });
  
  // Remaining unmatched in sibling = additions (new content they added)
  siblingHashes.forEach(siblingPara => {
    if (!matchedSiblingIndices.has(siblingPara.index)) {
      changes.push({
        index: siblingPara.index,
        changeType: 'added',
        nodeType: siblingPara.type,
        preview: siblingPara.preview
      });
    }
  });
  
  // Remaining unmatched in current = removals (content they removed)
  currentHashes.forEach(currentPara => {
    if (!matchedCurrentIndices.has(currentPara.index)) {
      changes.push({
        index: currentPara.index,
        changeType: 'removed',
        nodeType: currentPara.type,
        preview: currentPara.preview
      });
    }
  });
  
  // Sort by index for display
  changes.sort((a, b) => a.index - b.index);
  
  return changes;
}

// GET /api/collab/:shareToken/other-branches - Get comments from sibling branches
router.get('/:shareToken/other-branches', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. Get info about the current share link
    const currentLink = await new Promise((resolve, reject) => {
      const sql = `
        SELECT s.doc_id, s.share_token, s.collaborator_label, s.collab_branch_name,
               d.filepath, r.full_name
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

    // 2. Get current user's document content (for comparison)
    let currentParagraphHashes = [];
    const currentLiveDoc = await new Promise((resolve) => {
      db.get('SELECT prosemirror_json FROM live_documents WHERE share_token = ?', 
        [shareToken], (err, row) => {
          if (err || !row) resolve(null);
          else resolve(row);
        });
    });
    
    if (currentLiveDoc && currentLiveDoc.prosemirror_json) {
      try {
        const currentJson = JSON.parse(currentLiveDoc.prosemirror_json);
        currentParagraphHashes = computeParagraphHashes(currentJson);
      } catch (e) {
        console.warn('Could not parse current live doc for comparison:', e);
      }
    }

    // 3. Get all OTHER share links for the same document
    const siblingLinks = await new Promise((resolve, reject) => {
      const sql = `
        SELECT share_token, collaborator_label, collab_branch_name 
        FROM share_links 
        WHERE doc_id = ? AND share_token != ?
      `;
      db.all(sql, [currentLink.doc_id, shareToken], (err, rows) => {
        if (err) return reject(new Error('Could not query sibling share links.'));
        resolve(rows || []);
      });
    });

    // 4. For each sibling, get their comments and paragraph changes
    const branches = [];
    
    for (const sibling of siblingLinks) {
      let comments = [];
      let source = 'none';
      let paragraphChanges = [];
      
      // Check live_documents first (unsaved changes)
      const liveDoc = await new Promise((resolve) => {
        db.get('SELECT prosemirror_json, comments_json, updated_at FROM live_documents WHERE share_token = ?', 
          [sibling.share_token], (err, row) => {
            if (err || !row) resolve(null);
            else resolve(row);
          });
      });
      
      if (liveDoc) {
        // Parse comments
        if (liveDoc.comments_json) {
          try {
            const liveComments = JSON.parse(liveDoc.comments_json);
            if (liveComments.length > 0) {
              comments = liveComments;
              source = 'live';
            }
          } catch (e) {
            console.warn(`Failed to parse live comments for ${sibling.share_token}:`, e);
          }
        }
        
        // Compare paragraphs to find changes using content-based matching
        if (liveDoc.prosemirror_json && currentParagraphHashes.length > 0) {
          try {
            const siblingJson = JSON.parse(liveDoc.prosemirror_json);
            const siblingHashes = computeParagraphHashes(siblingJson);
            
            // Use content-based diff instead of index-based
            paragraphChanges = computeContentBasedChanges(currentParagraphHashes, siblingHashes);
          } catch (e) {
            console.warn('Could not compare paragraphs:', e);
          }
        }
      }
      
      // If no live comments, try to get from the committed branch
      if (comments.length === 0) {
        try {
          const projectDir = path.join(REPOS_DIR, currentLink.full_name);
          await git.checkout({ fs: fsForGit, dir: projectDir, ref: sibling.collab_branch_name });
          const fullFilepath = path.join(projectDir, currentLink.filepath);
          const qmdContent = await fs.readFile(fullFilepath, 'utf8');
          const { comments: extractedComments } = extractCommentsAppendix(qmdContent);
          if (extractedComments.length > 0) {
            comments = extractedComments;
            source = 'branch';
          }
        } catch (error) {
          console.warn(`Could not read branch ${sibling.collab_branch_name}:`, error.message);
        }
      }
      
      // Get reaction counts for each comment
      const commentsWithReactions = await Promise.all(comments.map(async (comment) => {
        const reactions = await new Promise((resolve) => {
          const sql = `
            SELECT reaction_type, COUNT(*) as count, 
                   GROUP_CONCAT(reactor_label) as reactors
            FROM comment_reactions 
            WHERE comment_id = ? AND source_share_token = ?
            GROUP BY reaction_type
          `;
          db.all(sql, [comment.id, sibling.share_token], (err, rows) => {
            if (err || !rows) resolve({ thumbs_up: 0, thumbs_down: 0, reactors: {} });
            else {
              const result = { thumbs_up: 0, thumbs_down: 0, reactors: {} };
              rows.forEach(row => {
                result[row.reaction_type] = row.count;
                result.reactors[row.reaction_type] = row.reactors ? row.reactors.split(',') : [];
              });
              resolve(result);
            }
          });
        });
        
        // Check if current user has reacted
        const myReaction = await new Promise((resolve) => {
          db.get(
            'SELECT reaction_type FROM comment_reactions WHERE comment_id = ? AND source_share_token = ? AND reactor_share_token = ?',
            [comment.id, sibling.share_token, shareToken],
            (err, row) => resolve(row ? row.reaction_type : null)
          );
        });
        
        return {
          ...comment,
          reactions,
          myReaction
        };
      }));
      
      branches.push({
        shareToken: sibling.share_token,
        collaboratorLabel: sibling.collaborator_label || 'Unknown',
        branchName: sibling.collab_branch_name,
        comments: commentsWithReactions,
        paragraphChanges: paragraphChanges,
        source,
        lastUpdated: liveDoc ? liveDoc.updated_at : null
      });
    }

    res.json({
      currentBranch: {
        shareToken: currentLink.share_token,
        collaboratorLabel: currentLink.collaborator_label,
        branchName: currentLink.collab_branch_name
      },
      otherBranches: branches
    });

  } catch (error) {
    console.error('Error getting other branches:', error);
    res.status(500).json({ error: error.message || 'Failed to get other branches.' });
  }
});

module.exports = router;

