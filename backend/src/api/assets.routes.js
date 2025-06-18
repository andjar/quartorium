const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/sqlite'); // Use the shared db connection

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

// This endpoint is public but the paths are unguessable.
// In a production app, you might add more security here.
// GET /api/assets/:repoId/figure-html/plot-1.png
// NOTE: The ':assetPath(*)' is a wildcard to capture the full file path.
router.get('/:repoId/:assetPath(*)', (req, res) => {
  const { repoId, assetPath } = req.params;

  // This is a simplified security check. It assumes that if a user could
  // render the doc, they have rights to see the assets.
  // We are NOT checking user authentication here to allow the public
  // collaborator view to work.
  
  // A better security model would involve checking a session or token,
  // but for now, we rely on the obscurity of the asset path.

  // Look up the repository's full_name from its ID
  db.get('SELECT full_name FROM repositories WHERE id = ?', [repoId], (err, row) => {
    if (err || !row) {
      return res.status(404).send('Repository not found');
    }
    
    const repoFullName = row.full_name;
    
    // Construct the asset path using the repository's full name
    const fullAssetPath = path.join(REPOS_DIR, repoFullName, assetPath);

    // Basic path traversal protection
    const safePath = path.resolve(fullAssetPath);
    if (!safePath.startsWith(path.resolve(REPOS_DIR))) {
      return res.status(403).send('Forbidden');
    }

    res.sendFile(safePath, (err) => {
      if (err) {
        res.status(404).send('Asset not found');
      }
    });
  });
});

module.exports = router;