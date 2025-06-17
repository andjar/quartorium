const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

/**
 * Executes the `quarto render --to json` command.
 * @param {string} qmdFilepath - The absolute path to the .qmd file.
 * @param {string} projectDir - The directory where the command should be run.
 * @returns {Promise<{ast: object, assetsDir: string}>} - The parsed Pandoc AST and the path to the assets directory.
 */
async function renderToAST(qmdFilepath, projectDir) {
  // Use a temporary directory for the output to keep things clean.
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quillarto-render-'));
  const command = `quarto render "${qmdFilepath}" --to json --output-dir "${outputDir}"`;

  const stdout = await new Promise((resolve, reject) => {
    exec(command, { cwd: projectDir, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => { // 50MB buffer
      if (error) {
        console.error(`Quarto render error: ${stderr}`);
        return reject(new Error(`Quarto execution failed: ${stderr}`));
      }
      resolve(stdout);
    });
  });

  try {
    const ast = JSON.parse(stdout);
    // The assets (e.g., plot images) are in a sub-directory named like 'my-doc_files'
    const assetsDir = path.join(outputDir, `${path.parse(qmdFilepath).name}_files`);
    return { ast, assetsDir };
  } catch (e) {
    throw new Error("Failed to parse Quarto's JSON output.");
  }
}

/**
 * A recursive function to transform a Pandoc AST block into a ProseMirror node.
 * @param {object} block - A block from the Pandoc AST `blocks` array.
 * @param {string} repoId - The ID of the repository for constructing asset URLs.
 * @returns {object|null} - A ProseMirror node object, or null if the block is not supported.
 */
function transformBlock(block, repoId) {
  switch (block.t) {
    case 'Header': {
      const level = block.c[0];
      const text = block.c[2].map(inline => inline.c).join('');
      return {
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text }],
      };
    }
    case 'Para': {
      // Simplification: This joins all text parts of a paragraph. A full implementation
      // would handle marks like bold/italic within the paragraph.
      const text = block.c.map(inline => inline.c || ' ').join('');
      return {
        type: 'paragraph',
        content: [{ type:text, text }],
      };
    }
    case 'CodeBlock': {
      const [attrs, code, outputs] = block.c;
      // This is a Quarto code chunk if it has outputs.
      if (outputs) {
        const chunkOptions = attrs[2].map(([key, val]) => `${key}=${val}`).join(', ');
        
        // Combine all rendered outputs into a single HTML string.
        const htmlOutput = outputs.map(output => {
          if (output.t === 'Image') {
            const imagePath = output.c[2][0];
            // The src will point to our new static asset endpoint.
            const src = `/api/assets/${repoId}/${imagePath}`;
            return `<img src="${src}" alt="Generated plot" style="max-width: 100%;" />`;
          }
          if (output.t === 'CodeBlock') {
            const codeContent = output.c[1];
            return `<pre><code>${codeContent}</code></pre>`;
          }
          return '';
        }).join('\n');

        return {
          type: 'quartoBlock',
          attrs: { code, chunkOptions, htmlOutput },
        };
      }
      // This is a plain code block (not a Quarto chunk).
      // We can handle this later if needed, for now we skip.
      return null;
    }
    default:
      // We don't support other block types like lists or blockquotes yet.
      return null;
  }
}

/**
 * Transforms a full Pandoc AST into a ProseMirror JSON document.
 * @param {object} pandocAST - The complete AST from Quarto.
 * @param {string} repoId - The ID of the repository.
 * @returns {object} - A ProseMirror JSON object.
 */
function pandocAST_to_proseMirrorJSON(pandocAST, repoId) {
  const content = pandocAST.blocks
    .map(block => transformBlock(block, repoId))
    .filter(Boolean); // Filter out any null (unsupported) blocks

  return {
    type: 'doc',
    attrs: {
      yaml: pandocAST.meta, // Pass along the metadata
    },
    content,
  };
}

module.exports = { renderToAST, pandocAST_to_proseMirrorJSON };