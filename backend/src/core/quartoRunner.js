const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// --- SECURITY WARNING ---
// This current implementation runs Quarto directly on the host machine.
// This is a MAJOR security risk if used with untrusted .qmd files, as they
// can execute arbitrary code. For a public-facing service, this MUST be
// replaced with a sandboxed execution environment (e.g., Docker containers).
// For this trusted-user-only phase, we proceed with this simplified model.

async function renderChunk(code, chunkOptions) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quillarto-'));
  const tempQmdPath = path.join(tempDir, 'temp.qmd');
  const tempHtmlPath = path.join(tempDir, 'temp.html');

  try {
    const qmdContent = `---
title: "Chunk Render"
format: html
---

\`\`\`{${chunkOptions}}\n${code}\n\`\`\`
`;

    await fs.writeFile(tempQmdPath, qmdContent);

    // Execute the Quarto CLI command
    await new Promise((resolve, reject) => {
      exec(`quarto render "${tempQmdPath}" --to html`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Quarto render error: ${stderr}`);
          return reject(new Error(`Quarto execution failed: ${stderr}`));
        }
        resolve(stdout);
      });
    });

    const htmlOutput = await fs.readFile(tempHtmlPath, 'utf8');
    
    // A simple way to extract just the output div from the rendered HTML body
    const match = htmlOutput.match(/<div id="quarto-content" role="main">([\s\S]*?)<\/div>/);
    return match ? match[1].trim() : '<div>Error: Could not extract content.</div>';

  } catch (error) {
    console.error('Error in renderChunk:', error);
    // Return an error message as HTML to be displayed in the editor
    return `<div style="color:red; background-color:#ffeeee; border:1px solid red; padding:1rem;"><strong>Render Error:</strong><pre>${error.message}</pre></div>`;
  } finally {
    // Clean up the temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { renderChunk };