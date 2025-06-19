const { parseQmd } = require('./qmdBlockParser'); // Adjust path if needed

/**
 * Creates maps to convert JATS IDs back to original QMD/BibTeX keys.
 * This is a simplified helper; you might need to make the logic more robust
 * based on your exact JATS ID generation.
 */
function createReferenceMaps(pmDoc) {
    const citeMap = new Map();
    const figMap = new Map();

    // Create citation map (e.g., "ref-knuth84-nb-article" -> "knuth84")
    const bibliography = pmDoc.attrs?.bibliography;
    if (bibliography) {
        for (const [jatsId, refData] of Object.entries(bibliography)) {
            const key = jatsId.replace(/^ref-/, '').replace(/-nb-article$/, '');
            citeMap.set(jatsId, key);
        }
    }

    // Scan content to create figure map (e.g., "fig-plot-nb-article" -> "fig-plot")
    pmDoc.content?.forEach(node => {
        if (node.content) {
            node.content.forEach(inline => {
                if (inline.type === 'figureReference') {
                    const jatsId = inline.attrs.rid;
                    const key = jatsId.replace(/-nb-article$/, '');
                    figMap.set(jatsId, key);
                }
            });
        }
    });

    return { citeMap, figMap };
}

/**
 * Serializes an array of ProseMirror inline nodes into a Markdown string.
 */
function serializeInlines(inlines, { citeMap, figMap }) {
  if (!inlines) return '';
  return inlines.map(inlineNode => {
    switch (inlineNode.type) {
      case 'text':
        return inlineNode.text;
      case 'citation': {
        const rid = inlineNode.attrs.rid;
        const label = inlineNode.attrs.label;
        
        // Try to get the citation key from the map
        const bibKey = citeMap.get(rid);
        if (bibKey) {
          return `[@${bibKey}]`;
        }
        
        // Fallback: try to extract key from the label or rid
        if (label) {
          // If label looks like a citation key, use it
          if (/^[a-zA-Z0-9_-]+$/.test(label)) {
            return `[@${label}]`;
          }
          // Otherwise, use the label as is
          return `[@${label}]`;
        }
        
        // Last resort: try to extract from rid
        if (rid) {
          const extractedKey = rid.replace(/^ref-/, '').replace(/-nb-article$/, '');
          if (extractedKey && extractedKey !== rid) {
            return `[@${extractedKey}]`;
          }
        }
        
        return `[UNKNOWN_CITATION]`;
      }
      case 'figureReference': {
        const rid = inlineNode.attrs.rid;
        const label = inlineNode.attrs.label;
        
        // Try to get the figure key from the map
        const figLabel = figMap.get(rid);
        if (figLabel) {
          return `@{${figLabel}}`;
        }
        
        // Fallback: try to extract from the label or rid
        if (label) {
          // If label looks like a figure reference, use it
          if (/^fig-/.test(label)) {
            return `@{${label}}`;
          }
          // Otherwise, use the label as is
          return `@{${label}}`;
        }
        
        // Last resort: try to extract from rid
        if (rid) {
          const extractedKey = rid.replace(/-nb-article$/, '');
          if (extractedKey && extractedKey !== rid) {
            return `@{${extractedKey}}`;
          }
        }
        
        return `[UNKNOWN_FIGURE]`;
      }
      default:
        return inlineNode.text || '';
    }
  }).join('');
}

/**
 * Serializes a single ProseMirror block node into its .qmd string representation.
 */
function serializeBlock(node, blockMap, refMaps) {
  switch (node.type) {
    case 'heading': {
      const prefix = '#'.repeat(node.attrs.level);
      const text = serializeInlines(node.content, refMaps);
      return `${prefix} ${text}`;
    }
    case 'paragraph': {
      return serializeInlines(node.content, refMaps);
    }
    case 'quartoBlock': {
      const { blockKey, language, code, htmlOutput, figLabel, figCaption } = node.attrs;
      
      // Handle bibliography blocks - don't render them in the output
      if (language === 'bibliography') {
          return ''; // Do not render the bibliography block.
      }
      
      // Handle metadata blocks - use the YAML block from the original file
      if (language === 'metadata') {
          if (blockKey && blockMap.has(blockKey)) {
            return blockMap.get(blockKey);
          }
          // If no blockKey, try to reconstruct basic YAML
          const metadata = node.attrs.metadata;
          if (metadata) {
            let yaml = '---\n';
            if (metadata.title) yaml += `title: "${metadata.title}"\n`;
            if (metadata.authors && metadata.authors.length > 0) {
              yaml += 'author:\n';
              metadata.authors.forEach(author => {
                if (author.name) yaml += `  - ${author.name}\n`;
                else if (author.given && author.surname) yaml += `  - ${author.given} ${author.surname}\n`;
              });
            }
            yaml += '---';
            return yaml;
          }
          return '';
      }
      
      // Handle code blocks with blockKey
      if (blockKey && blockMap.has(blockKey)) {
        return blockMap.get(blockKey);
      }
      
      // Fallback: reconstruct code block from attributes if blockKey is missing
      if (code && language) {
        let reconstructed = `\`\`\`{${language}`;
        if (figLabel) {
          reconstructed += `, label="${figLabel}"`;
        }
        reconstructed += `}\n${code}\n\`\`\``;
        return reconstructed;
      }
      
      // If we can't reconstruct anything meaningful, return an error message
      return `[ERROR: QMD block not found for key: ${blockKey || 'undefined'}]`;
    }
    default:
      return '';
  }
}

/**
 * Main function to serialize a ProseMirror document back to a .qmd file string.
 * @param {object} pmDoc - The ProseMirror document JSON object.
 * @param {string} originalQmdString - The raw string content of the original .qmd file.
 * @returns {string} The full content of the newly constructed .qmd file.
 */
function proseMirrorJSON_to_qmd(pmDoc, originalQmdString) {
  if (!pmDoc || pmDoc.type !== 'doc') {
    throw new Error('Invalid ProseMirror document provided.');
  }

  // Debug: Log the document structure
  console.log('Serializing ProseMirror document:');
  console.log('- Document attrs:', JSON.stringify(pmDoc.attrs, null, 2));
  console.log('- Content nodes count:', pmDoc.content?.length || 0);
  
  // Debug: Log blockMap contents
  const { blockMap } = parseQmd(originalQmdString);
  console.log('- BlockMap keys:', Array.from(blockMap.keys()));

  // 2. Create maps for resolving cross-references.
  const refMaps = createReferenceMaps(pmDoc);
  console.log('- Citation map size:', refMaps.citeMap.size);
  console.log('- Figure map size:', refMaps.figMap.size);

  // 3. Serialize each block node from the ProseMirror document.
  const contentParts = pmDoc.content
    .map((node, index) => {
      console.log(`- Processing node ${index}:`, node.type, node.attrs);
      return serializeBlock(node, blockMap, refMaps);
    })
    .filter(part => part !== null && part !== ''); // Filter out empty strings

  // 4. Join the parts to form the final document.
  const result = contentParts.join('\n\n');
  console.log('- Final serialized content length:', result.length);
  
  return result;
}

module.exports = { proseMirrorJSON_to_qmd };