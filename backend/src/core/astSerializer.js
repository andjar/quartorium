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
        const bibKey = citeMap.get(inlineNode.attrs.rid);
        return bibKey ? `[@${bibKey}]` : `[UNKNOWN_CITATION]`;
      }
      case 'figureReference': {
        // Your JATS->JSON parser creates figure refs with a label, which is great.
        // But for perfect round-tripping, we reconstruct from the key.
        const figLabel = figMap.get(inlineNode.attrs.rid);
        return figLabel ? `@{${figLabel}}` : `[UNKNOWN_FIGURE]`;
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
      // THIS IS THE CORE LOGIC.
      // It completely ignores the renderable attributes (htmlOutput, etc.)
      // and uses the blockKey to retrieve the pristine, original block content.
      const { blockKey, language } = node.attrs;
      if (language === 'bibliography') {
          return ''; // Do not render the bibliography block.
      }
      if (blockKey && blockMap.has(blockKey)) {
        return blockMap.get(blockKey);
      }
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

  // 1. Parse the original QMD to get a map of all special blocks.
  const { blockMap } = parseQmd(originalQmdString);

  // 2. Create maps for resolving cross-references.
  const refMaps = createReferenceMaps(pmDoc);

  // 3. Serialize each block node from the ProseMirror document.
  const contentParts = pmDoc.content
    .map(node => serializeBlock(node, blockMap, refMaps))
    .filter(part => part !== null && part !== ''); // Filter out empty strings

  // 4. Join the parts to form the final document.
  return contentParts.join('\n\n');
}

module.exports = { proseMirrorJSON_to_qmd };