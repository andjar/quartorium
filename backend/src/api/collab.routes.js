const express = require('express');
const db = require('../db/sqlite');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs/promises');
const { renderToJATS, jatsToProseMirrorJSON } = require('../core/astParser');
// Import our new serializer
const { proseMirrorJSON_to_qmd } = require('../core/astSerializer');

const router = express.Router();
const REPOS_DIR = path.join(__dirname, '../../repos');

// GET /api/collab/:shareToken - Load the document for a collaborator
router.get('/:shareToken', async (req, res) => {
  const { shareToken } = req.params;

  try {
    // 1. Find the share link and associated document/repo info
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

    // 2. Check out the specific collaboration branch
    const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
    await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });

    // 3. Render the document from that branch
    const fullFilepath = path.join(projectDir, linkInfo.filepath);
    const { jatsXml } = await renderToJATS(fullFilepath, projectDir);
    const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, linkInfo.repoId);
    
    res.json(proseMirrorJson);

  } catch (error) {
    console.error('Error loading collab doc:', error);
    res.status(404).json({ error: error.message });
  }
});

// POST /api/collab/:shareToken - Save changes from a collaborator
router.post('/:shareToken', async (req, res) => {
    // We will implement this after creating the serializer
    res.status(501).json({ message: 'Saving not yet implemented.' });
});

router.post('/:shareToken', async (req, res) => {
    const { shareToken } = req.params;
    const proseMirrorDoc = req.body; // The JSON from the editor
  
    try {
      // 1. Find the share link and associated document/repo info
      const linkInfo = await new Promise((resolve, reject) => {
        const sql = `
          SELECT s.collab_branch_name, d.filepath, r.full_name 
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
  
      // 2. Serialize the ProseMirror JSON back into a .qmd string
      const newQmdContent = proseMirrorJSON_to_qmd(proseMirrorDoc);
  
      // 3. Write the new content to the file and commit it to the collaboration branch
      const projectDir = path.join(REPOS_DIR, linkInfo.full_name);
      const fullFilepath = path.join(projectDir, linkInfo.filepath);
  
      await git.checkout({ fs, dir: projectDir, ref: linkInfo.collab_branch_name });
      await fs.writeFile(fullFilepath, newQmdContent);
      
      await git.add({ fs, dir: projectDir, filepath: linkInfo.filepath });
  
      await git.commit({
        fs,
        dir: projectDir,
        message: 'Update from collaborator via Quartorium',
        author: {
          name: 'Quartorium Collaborator',
          email: 'collaborator@quartorium.app',
        },
      });
  
      console.log(`Changes committed to branch: ${linkInfo.collab_branch_name}`);
      res.status(200).json({ status: 'saved' });
  
    } catch (error) {
      console.error('Error saving collab doc:', error);
      res.status(500).json({ error: 'Failed to save changes.' });
    }
  });
  
  module.exports = router;