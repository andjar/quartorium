const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/sqlite'); // Use the shared db connection

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos'); // Kept for potential other uses
const CACHE_DIR = path.join(__dirname, '../../cache');

// This endpoint is public but the paths are unguessable.
// In a production app, you might add more security here.
// Example: /api/assets/1/a1b2c3d4/index_files/figure-jats/fig.png
// NOTE: The ':assetPath(*)' is a wildcard to capture the full file path.
router.get('/:repoId/:commitHash/:assetPath(*)', (req, res) => {
  const { repoId, commitHash, assetPath } = req.params;

  // Basic path traversal protection
  const safeAssetPath = path.normalize(assetPath).replace(/^(\.\.[\/\\])+/, '');
  
  // Construct the asset path using the new cache structure
  const fullAssetPath = path.join(CACHE_DIR, 'renders', repoId, commitHash, safeAssetPath);
  
  // More robust security check
  const safeResolvedPath = path.resolve(fullAssetPath);
  const expectedCacheBase = path.resolve(path.join(CACHE_DIR, 'renders'));
  if (!safeResolvedPath.startsWith(expectedCacheBase)) {
    return res.status(403).send('Forbidden');
  }

  res.sendFile(safeResolvedPath, (err) => {
    if (err) {
      if (!res.headersSent) {
        res.status(404).send('Asset not found');
      }
    }
  });
});

module.exports = router;