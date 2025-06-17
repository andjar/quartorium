const express = require('express');
const path = require('path');
const fs = require('fs');

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

  // We need to find the repo's full_name from its ID to construct the path.
  // This is a simplification; in a real app, you'd query the DB.
  // For now, we'll just scan the repos dir. This is NOT performant.
  // TODO: Replace this with a DB lookup.
  const repoName = fs.readdirSync(REPOS_DIR).find(dir => fs.statSync(path.join(REPOS_DIR, dir)).isDirectory());
  if (!repoName) {
      return res.status(404).send('Repo directory not found.');
  }
  
  const fullAssetPath = path.join(REPOS_DIR, repoName, `${path.parse(assetPath).name}_files`, assetPath);

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

module.exports = router;