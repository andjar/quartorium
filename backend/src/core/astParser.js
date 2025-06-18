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

    console.log('--- [DEBUG] Temp dir for rendering: ', outputJsonPath);

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

    // 7. The assets are in a sub-directory relative to where the JSON output was saved.
    const outputDir = path.dirname(outputJsonPath);
    const assetsDir = path.join(outputDir, `${path.parse(inputFilename).name}_files`);
    
    // 8. Copy the rendered assets back to the repository directory so they can be served
    const repoAssetsDir = path.join(projectDir, `${path.parse(inputFilename).name}_files`);
    try {
      await fs.cp(assetsDir, repoAssetsDir, { recursive: true });
      console.log('--- [DEBUG] Copied assets from temp dir to repo dir:', repoAssetsDir);
    } catch (copyError) {
      console.log('--- [DEBUG] No assets to copy or copy failed:', copyError.message);
    }
    
    return { ast, assetsDir: repoAssetsDir };

  } catch (e) {
    console.error("Failed during AST rendering process.", e);
    throw new Error("Failed to process Quarto's output.");
  } finally {
    // 9. Clean up the temporary directory after we're done.
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
 * @param {string} repoId - The repository ID for asset path rewriting.
 * @returns {Array} - An array of ProseMirror inline nodes.
 */
function transformInlines(inlines, repoId) {
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
        proseMirrorInlines.push(...transformInlines(content, repoId).map(node => ({
          ...node,
          marks: [...(node.marks || []), { type: 'em' }]
        })));
        break;
      case 'Strong': // Bold
        proseMirrorInlines.push(...transformInlines(content, repoId).map(node => ({
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
        const linkText = transformInlines(content[1], repoId);
        const linkUrl = content[2][0];
        proseMirrorInlines.push(...linkText.map(node => ({
          ...node,
          marks: [...(node.marks || []), { type: 'link', attrs: { href: linkUrl } }]
        })));
        break;
      case 'Image':
        // Image structure: [attrs, caption, [src, title]]
        const imageSrc = content[2][0];
        const imageTitle = content[2][1] || '';
        const imageCaption = transformInlines(content[1], repoId);
        
        // Rewrite the image path to use our assets API
        const rewrittenSrc = imageSrc.startsWith('/api/assets/') ? imageSrc : `/api/assets/${repoId}/${imageSrc}`;
        
        // For now, just create a text node with the image path
        // We'll handle image conversion at the block level
        proseMirrorInlines.push({ 
          type: 'text', 
          text: `[IMAGE: ${rewrittenSrc}]`,
          marks: [{ type: 'image', attrs: { src: rewrittenSrc, alt: imageCaption.map(node => node.text || '').join(''), title: imageTitle } }]
        });
        break;
      // Add cases for other inline types like 'Code', 'Strikeout', etc. as needed.
      default:
        // Do nothing for unsupported inline types for now.
        break;
    }
  });

  return proseMirrorInlines;
}

/**
 * Rewrites asset paths in HTML content to point to the repository's assets.
 * @param {string} htmlContent - The HTML string to process.
 * @param {string} repoId - The ID of the repository.
 * @returns {string} - The HTML string with rewritten asset paths.
 */
function rewriteAssetPaths(htmlContent, repoId) {
  if (!htmlContent) return '';

  // This regex finds src attributes in img tags.
  // It captures the existing value of src.
  // TODO: Extend this to other tags like <source>, <video>, <object> if necessary.
  const imgRegex = /<img\s+[^>]*src="([^"]+)"[^>]*>/g;

  return htmlContent.replace(imgRegex, (match, srcValue) => {
    if (!srcValue.startsWith('http://') && !srcValue.startsWith('https://') && !srcValue.startsWith('/api/assets/')) {
      const newSrc = `/api/assets/${repoId}/${srcValue.startsWith('/') ? srcValue.substring(1) : srcValue}`;
      return match.replace(srcValue, newSrc);
    }
    return match; // Return the original match if no replacement is needed
  });
}


// --- MODIFIED transformBlock function with LOGGING ---
function transformBlock(block, repoId) {
  // console.log(`[DEBUG] Processing block of type: ${block.t}`); // <-- LOG 1

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
        content: transformInlines(inlines, repoId),
      };
      break; // Added break for clarity
    }
    case 'Para': {
      result = {
        type: 'paragraph',
        content: transformInlines(content, repoId),
      };
      break;
    }
    case 'Plain': {
      // Plain blocks contain inline elements (like images) without paragraph wrapper
      const inlines = transformInlines(content, repoId);
      
      // Check if this Plain block contains an image
      const imageNode = inlines.find(node => node.marks && node.marks.some(mark => mark.type === 'image'));
      
      if (imageNode) {
        // Extract image information from the mark
        const imageMark = imageNode.marks.find(mark => mark.type === 'image');
        const { src, alt, title } = imageMark.attrs;
        
        // Create HTML for the image
        const imageHtml = `<img src="${src}" alt="${alt}" title="${title}" style="max-width: 100%; height: auto;" />`;
        
        result = {
          type: 'quartoBlock',
          attrs: { 
            htmlOutput: imageHtml, 
            code: '', 
            chunkOptions: 'image' 
          }
        };
      } else {
        // Regular Plain block - convert to paragraph
        result = {
          type: 'paragraph',
          content: inlines,
        };
      }
      break;
    }
    case 'CodeBlock': {
      // ... (This logic is fine for now) ...
      break;
    }
    case 'RawBlock': {
      const format = content[0];
      const htmlContent = content[1];
      if (format === 'html') {
        const modifiedHtml = rewriteAssetPaths(htmlContent, repoId);
        result = {
          type: 'quartoBlock',
          attrs: { htmlOutput: modifiedHtml, code: '', chunkOptions: '' },
        };
      }
      // If not HTML, or some other RawBlock we don't handle, it will become null
      break;
    }
    case 'Div': {
      const attrs = content[0]; // Array: [id, classes, key-value pairs]
      const divId = attrs[0];
      const classes = attrs[1];
      const kvPairs = attrs[2]; // Array of [key, value]

      // Check for 'refs' div used for bibliographies etc.
      if (divId === 'refs') {
        const divContent = content[1]; // Pandoc blocks
        result = divContent.map(b => transformBlock(b, repoId)).filter(Boolean);
        // This will be flattened later by .flat()
      }
      // Handle Quarto figure divs by checking the ID, not the class
      else if (divId && (divId.startsWith('cell-fig-') || divId.startsWith('fig-'))) {
        const divBlocks = content[1]; // Array of Pandoc blocks within this Div
        
        // Look for images within the figure div
        let imageHtml = '';
        let foundImage = false;
        
        // Recursively search for images in all nested blocks
        function findImages(blocks) {
          for (const block of blocks) {
            if (foundImage) return; // Stop searching once found

            if (block.t === 'Plain') {
              const inlines = transformInlines(block.c, repoId);
              const imageNode = inlines.find(node => node.marks && node.marks.some(mark => mark.type === 'image'));
              if (imageNode) {
                const imageMark = imageNode.marks.find(mark => mark.type === 'image');
                const { src, alt, title } = imageMark.attrs;
                imageHtml = `<img src="${src}" alt="${alt}" title="${title}" style="max-width: 100%; height: auto;" />`;
                foundImage = true;
                return;
              }
            } else if (block.t === 'Div') {
              findImages(block.c[1]); // Recursively search nested divs
            }
          }
        }
        
        findImages(divBlocks);
        
        if (foundImage) {
          result = {
            type: 'quartoBlock',
            attrs: { 
              htmlOutput: imageHtml, 
              code: '', 
              chunkOptions: 'image' 
            }
          };
        } else {
          // If no image found, it might just be a container, process inner blocks
          const transformedBlocks = divBlocks.map(b => transformBlock(b, repoId)).filter(Boolean);
          result = transformedBlocks.flat();
        }
      }
      // Heuristic: Check for common Quarto output cell classes.
      // This might need refinement based on actual AST structures.
      else if (classes.includes('cell-output') || classes.includes('cell-output-display') || classes.includes('quarto-figure')) {
        let htmlOutput = '';
        let extractedCode = ''; // Placeholder
        let extractedChunkOpts = ''; // Placeholder

        // Try to stringify chunk options from kvPairs
        if (kvPairs && kvPairs.length > 0) {
          extractedChunkOpts = kvPairs.map(kv => `${kv[0]}="${kv[1]}"`).join(' ');
        }

        const divBlocks = content[1]; // Array of Pandoc blocks within this Div

        divBlocks.forEach(innerBlock => {
          if (innerBlock.t === 'RawBlock' && innerBlock.c[0] === 'html') {
            htmlOutput += rewriteAssetPaths(innerBlock.c[1], repoId);
          }
          // Potentially look for 'CodeBlock' if the code is part of the output Div,
          // though typically it's a sibling block.
          // For now, we focus on getting the HTML output with rewritten paths.
        });

        if (htmlOutput) {
          result = {
            type: 'quartoBlock',
            attrs: { htmlOutput, code: extractedCode, chunkOptions: extractedChunkOpts },
          };
        }
        // If no HTML output was found in this Div, it might be something else.
        // Let it become null and be filtered out.
      }
      // If it's another type of Div we don't specifically handle, it will become null.
      break;
    }
    default:
      // This case will be hit for any unhandled block type
      // console.log(`[DEBUG] -> Unhandled block type: ${type}`); // <-- LOG 2
      result = null;
      break;
  }

  // console.log(`[DEBUG] -> Result for ${type}:`, JSON.stringify(result, null, 2)); // <-- LOG 3
  return result;
}


// --- MODIFIED pandocAST_to_proseMirrorJSON function with LOGGING ---
function pandocAST_to_proseMirrorJSON(pandocAST, repoId) {
  // console.log('--- [DEBUG] Starting AST Transformation ---');
  // console.log('[DEBUG] Full Pandoc AST:', JSON.stringify(pandocAST, null, 2)); // Uncomment for extreme detail

  const transformedBlocks = pandocAST.blocks
    .map(block => transformBlock(block, repoId))
    .filter(Boolean);
    
  const content = transformedBlocks.flat();

  // console.log('[DEBUG] Final ProseMirror content array:', JSON.stringify(content, null, 2)); // <-- LOG 4
  // console.log('--- [DEBUG] Finished AST Transformation ---');

  return {
    type: 'doc',
    attrs: {
      yaml: pandocAST.meta,
    },
    content,
  };
}

module.exports = { renderToAST, pandocAST_to_proseMirrorJSON };