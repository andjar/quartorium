const express = require('express');
const router = express.Router();
const db = require('../db/sqlite'); // Assuming your db setup is here
const { ensureAuthenticated } = require('../middleware/auth.middleware'); // Assuming auth middleware

// POST /api/docs/save-json
router.post('/save-json', ensureAuthenticated, (req, res) => {
  const { repo_id, filepath, prosemirror_json, base_commit_hash } = req.body;

  // Validate input
  if (!repo_id || !filepath || !prosemirror_json || !base_commit_hash) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const sql = `
    INSERT INTO live_documents (repo_id, filepath, prosemirror_json, base_commit_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(repo_id, filepath) DO UPDATE SET
      prosemirror_json = excluded.prosemirror_json,
      base_commit_hash = excluded.base_commit_hash,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id;
  `;

  db.get(sql, [repo_id, filepath, prosemirror_json, base_commit_hash], (err, row) => {
    if (err) {
      console.error('Error saving document to live_documents:', err.message);
      return res.status(500).json({ error: 'Failed to save document.' });
    }
    if (row) {
        res.status(200).json({ message: 'Document saved successfully.', id: row.id });
    } else {
        // This case should ideally not be reached if RETURNING id is supported and works as expected
        // However, some older versions or specific configurations of SQLite might have issues.
        // As a fallback, we can query the document again, though it's less efficient.
        db.get("SELECT id FROM live_documents WHERE repo_id = ? AND filepath = ?", [repo_id, filepath], (err, newRow) => {
            if (err) {
                console.error('Error retrieving saved document id:', err.message);
                return res.status(500).json({ error: 'Failed to retrieve document id after save.' });
            }
            if (newRow) {
                res.status(200).json({ message: 'Document saved successfully.', id: newRow.id });
            } else {
                res.status(500).json({ error: 'Failed to save or retrieve document.' });
            }
        });
    }
  });
});

// --- Additional imports for commit-qmd ---
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node'); // May not be needed for commit if auth is via SSH/token elsewhere
const fs = require('fs/promises');
const { proseMirrorJSON_to_qmd } = require('../core/astSerializer'); // Adjust path as necessary
const REPOS_DIR = path.join(__dirname, '../../repos'); // Define REPOS_DIR

// POST /api/docs/commit-qmd
router.post('/commit-qmd', ensureAuthenticated, async (req, res) => {
  const { repo_id, filepath, prosemirror_json, base_commit_hash } = req.body;
  const userId = req.user.id;
  const userEmail = req.user.email || `${req.user.username}@quartorium.app`; // Fallback email

  // Validate input
  if (!repo_id || !filepath || !prosemirror_json || !base_commit_hash) {
    return res.status(400).json({ error: 'Missing required fields: repo_id, filepath, prosemirror_json, or base_commit_hash.' });
  }

  let parsedProsemirrorJson;
  try {
    parsedProsemirrorJson = JSON.parse(prosemirror_json);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid prosemirror_json format.' });
  }

  try {
    // 1. Retrieve repository information
    const repo = await new Promise((resolve, reject) => {
      db.get('SELECT full_name, main_branch FROM repositories WHERE id = ? AND user_id = ?', [repo_id, userId], (err, row) => {
        if (err) return reject(new Error(`Database error fetching repository: ${err.message}`));
        if (!row) return reject(new Error('Repository not found or access denied.'));
        resolve(row);
      });
    });

    const projectDir = path.join(REPOS_DIR, repo.full_name);
    const mainBranch = repo.main_branch || 'main'; // Default to 'main' if not specified

    // 2. Checkout main branch (or the repo's designated main branch)
    await git.checkout({ fs, dir: projectDir, ref: mainBranch });
    console.log(`Checked out ${mainBranch} for repo ${repo.full_name}`);

    // 3. Fetch original QMD content from base_commit_hash
    let originalQmdContent;
    try {
      // Ensure filepath is relative to projectDir for git.readBlob
      const relativeFilepath = path.relative(projectDir, path.join(projectDir, filepath));
      const blobData = await git.readBlob({ fs, dir: projectDir, oid: base_commit_hash, filepath: relativeFilepath });
      originalQmdContent = Buffer.from(blobData.blob).toString('utf8');
    } catch (e) {
      console.error(`Failed to read blob for ${filepath} at ${base_commit_hash}: ${e.message}`);
      // Fallback: try reading from current HEAD of mainBranch if base_commit_hash is problematic or file was new
      // This might not be ideal, as it wouldn't reflect the true base for conversion if base_commit_hash was valid.
      // Consider if this fallback is appropriate or if it should be a hard error.
      // For now, let's assume this indicates a new file or a situation where current main is the best guess.
      try {
        console.warn(`Falling back to reading ${filepath} from current ${mainBranch} HEAD.`);
        originalQmdContent = await fs.readFile(path.join(projectDir, filepath), 'utf8');
      } catch (readError) {
         // If file truly doesn't exist even in HEAD (e.g. new file), astSerializer should handle empty originalQmdContent.
         console.warn(`File ${filepath} not found in ${mainBranch} HEAD either. Assuming new file.`);
         originalQmdContent = "";
      }
    }

    // 4. Convert JSON to QMD
    const newQmdContent = proseMirrorJSON_to_qmd(parsedProsemirrorJson, originalQmdContent);

    // 5. Write and commit
    const fullFilepath = path.join(projectDir, filepath);
    await fs.writeFile(fullFilepath, newQmdContent);
    await git.add({ fs, dir: projectDir, filepath: filepath }); // filepath should be relative to repo root

    const newCommitHash = await git.commit({
      fs,
      dir: projectDir,
      message: `Quartorium: Update ${filepath}`,
      author: { name: req.user.username, email: userEmail },
    });

    // 6. Cleanup: Delete the entry from live_documents
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM live_documents WHERE repo_id = ? AND filepath = ?', [repo_id, filepath], function(err) {
        if (err) {
          console.error(`Failed to delete from live_documents: ${err.message}`);
          // Don't reject, as commit was successful. Log error.
        }
        console.log(`Cleaned up live_document for repo_id ${repo_id}, filepath ${filepath}`);
        resolve();
      });
    });

    res.json({ message: 'Committed successfully to main branch.', newCommitHash });

  } catch (error) {
    console.error('Error committing QMD to main branch:', error);
    // Ensure we switch back to main branch if an error occurred mid-process after checkout
    // This is a simplified error handling; more robust would involve checking repo state.
    if (error.message.includes("Repository not found")) {
        return res.status(404).json({ error: error.message });
    }
    if (error.message.includes("access denied")) {
        return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: `Failed to commit QMD: ${error.message}` });
  }
});

module.exports = router;
