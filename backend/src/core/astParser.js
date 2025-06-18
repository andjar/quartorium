const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

/**
 * Executes `quarto render` and reads the resulting JSON AST from a file.
 * @param {string} qmdFilepath - The absolute path to the source .qmd file.
 * @param {string} projectDir - The root directory of the cloned project.
 * @returns {Promise<{ast: object, assetsDir: string}>} - The parsed Pandoc AST and the path to the assets directory.
 */
async function renderToAST(qmdFilepath, projectDir) {
  // 1. Create a temporary directory to work in.
  const tempRenderDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quartorium-render-'));
  
  try {
    // 2. Copy the entire project content to the temporary directory.
    // This preserves any relative paths to images, data files, _quarto.yml, etc.
    await fs.cp(projectDir, tempRenderDir, { recursive: true });

    // 3. Define paths relative to the new temporary directory.
    const inputFilename = path.basename(qmdFilepath);
    const outputJsonFilename = `${path.parse(inputFilename).name}.json`;
    const outputJsonPath = path.join(tempRenderDir, '_manuscript', outputJsonFilename);

    // 4. Construct the Quarto command. The --output flag now only contains the filename.
    const command = `quarto render "${inputFilename}" --to json --output "${outputJsonFilename}"`;

    // 5. Execute the command from *inside the temporary directory*.
    await new Promise((resolve, reject) => {
      exec(command, { cwd: tempRenderDir }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Quarto render error: ${stderr}`);
          console.error(`Quarto stdout: ${stdout}`);
          return reject(new Error(`Quarto execution failed: ${stderr}`));
        }
        resolve(stdout);
      });
    });

    // 6. Read the JSON file that Quarto created in the temp directory.
    const jsonString = await fs.readFile(outputJsonPath, 'utf8');
    const ast = JSON.parse(jsonString);

    // 7. The assets are in a sub-directory relative to the output file.
    const assetsDir = path.join(tempRenderDir, `${path.parse(inputFilename).name}_files`);
    
    return { ast, assetsDir };

  } catch (e) {
    console.error("Failed during AST rendering process.", e);
    throw new Error("Failed to process Quarto's output.");
  } finally {
    // 8. Clean up the temporary directory after we're done.
    // We can uncomment this once we are sure everything works.
    // await fs.rm(tempRenderDir, { recursive: true, force: true });
  }
}

// ===================================================================
// NEW AND IMPROVED TRANSFORMATION LOGIC STARTS HERE
// ===================================================================

/**
 * A helper function to recursively transform an array of Pandoc "inline" elements
 * (like Str, Space, Emph, Cite) into ProseMirror text nodes with marks.
 * @param {Array} inlines - The 'c' array from a Pandoc Para or Header.
 * @returns {Array} - An array of ProseMirror inline nodes.
 */
function transformInlines(inlines) {
  const proseMirrorInlines = [];
  
  inlines.forEach(inline => {
    const type = inline.t;
    const content = inline.c;
    
    switch (type) {
      case 'Str':
        proseMirrorInlines.push({ type: 'text', text: content });
        break;
      case 'Space':
        proseMirrorInlines.push({ type: 'text', text: ' ' });
        break;
      case 'Emph': // Italics
        proseMirrorInlines.push(...transformInlines(content).map(node => ({
          ...node,
          marks: [...(node.marks || []), { type: 'em' }]
        })));
        break;
      case 'Strong': // Bold
        proseMirrorInlines.push(...transformInlines(content).map(node => ({
          ...node,
          marks: [...(node.marks || []), { type: 'strong' }]
        })));
        break;
      case 'Cite':
        // For citations, we'll just render the plain text representation.
        // e.g., (Knuth 1984)
        const citationText = content[1].map(c => c.c).join('');
        proseMirrorInlines.push({ type: 'text', text: citationText });
        break;
      case 'Link':
        const linkText = transformInlines(content[1]);
        const linkUrl = content[2][0];
        proseMirrorInlines.push(...linkText.map(node => ({
          ...node,
          marks: [...(node.marks || []), { type: 'link', attrs: { href: linkUrl } }]
        })));
        break;
      // Add cases for other inline types like 'Code', 'Strikeout', etc. as needed.
      default:
        // Do nothing for unsupported inline types for now.
        break;
    }
  });

  return proseMirrorInlines;
}

// --- MODIFIED transformBlock function with LOGGING ---
function transformBlock(block, repoId) {
  console.log(`[DEBUG] Processing block of type: ${block.t}`); // <-- LOG 1

  const type = block.t;
  const content = block.c;

  let result = null; // Start with null

  switch (type) {
    case 'Header': {
      const level = content[0];
      const inlines = content[2];
      result = {
        type: 'heading',
        attrs: { level },
        content: transformInlines(inlines),
      };
      break; // Added break for clarity
    }
    case 'Para': {
      result = {
        type: 'paragraph',
        content: transformInlines(content),
      };
      break;
    }
    case 'CodeBlock': {
      // ... (This logic is fine for now) ...
      break;
    }
    case 'Div': {
      const id = content[0][0];
      if (id === 'refs') {
        const divContent = content[1];
        result = divContent.map(b => transformBlock(b, repoId)).filter(Boolean);
      }
      break;
    }
    default:
      // This case will be hit for any unhandled block type
      console.log(`[DEBUG] -> Unhandled block type: ${type}`); // <-- LOG 2
      result = null;
      break;
  }

  console.log(`[DEBUG] -> Result for ${type}:`, JSON.stringify(result, null, 2)); // <-- LOG 3
  return result;
}


// --- MODIFIED pandocAST_to_proseMirrorJSON function with LOGGING ---
function pandocAST_to_proseMirrorJSON(pandocAST, repoId) {
  console.log('--- [DEBUG] Starting AST Transformation ---');
  // console.log('[DEBUG] Full Pandoc AST:', JSON.stringify(pandocAST, null, 2)); // Uncomment for extreme detail

  const transformedBlocks = pandocAST.blocks
    .map(block => transformBlock(block, repoId))
    .filter(Boolean);
    
  const content = transformedBlocks.flat();

  console.log('[DEBUG] Final ProseMirror content array:', JSON.stringify(content, null, 2)); // <-- LOG 4
  console.log('--- [DEBUG] Finished AST Transformation ---');

  return {
    type: 'doc',
    attrs: {
      yaml: pandocAST.meta,
    },
    content,
  };
}

module.exports = { renderToAST, pandocAST_to_proseMirrorJSON };