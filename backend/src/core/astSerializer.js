const { parseQmd } = require('./qmdBlockParser'); // Adjust path if needed

/**
 * Splits text into sentences and adds line breaks after each sentence.
 * This makes diffing easier by allowing sentence-by-sentence comparison.
 * 
 * @param {string} text - The text to split into sentences
 * @returns {string} The text with line breaks after each sentence
 */
function addLineBreaksAfterSentences(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Split on sentence endings (., !, ?) followed by whitespace or end of string
  // This regex handles common sentence endings while preserving abbreviations
  const sentences = text.split(/([.!?])\s+/);
  
  if (sentences.length <= 1) return text;
  
  // Reconstruct with line breaks after each sentence
  let result = '';
  for (let i = 0; i < sentences.length; i += 2) {
    if (i + 1 < sentences.length) {
      // Complete sentence with punctuation
      result += sentences[i] + sentences[i + 1] + '\n';
    } else {
      // Last fragment (might be incomplete sentence)
      result += sentences[i];
    }
  }
  
  return result.trim();
}

/**
 * Creates maps to convert JATS IDs back to original QMD/BibTeX keys.
 * This is a simplified helper; you might need to make the logic more robust
 * based on your exact JATS ID generation.
 */
function createReferenceMaps(pmDoc) {
    const citeMap = new Map();
    const figMap = new Map();

    // Create citation map (e.g., "ref-knuth84-nb-article" -> "knuth84")
    // First try pmDoc.attrs.bibliography
    let bibliography = pmDoc.attrs?.bibliography;
    
    // If not found there, scan content for bibliography blocks
    if (!bibliography) {
        pmDoc.content?.forEach(node => {
            if (node.type === 'quartoBlock' && node.attrs?.language === 'bibliography') {
                bibliography = node.attrs.bibliography;
            }
        });
    }
    
    if (bibliography) {
        for (const [jatsId, refData] of Object.entries(bibliography)) {
            const key = jatsId.replace(/^ref-/, '').replace(/-nb-article$/, '');
            citeMap.set(jatsId, key);
            console.log(`Citation map: ${jatsId} -> ${key}`);
        }
    }

    // Scan content to create figure map (e.g., "fig-plot-nb-article" -> "fig-plot")
    pmDoc.content?.forEach(node => {
        if (node.content) {
            node.content.forEach(inline => {
                if (inline.type === 'figureReference') {
                    const jatsId = inline.attrs.rid;
                    // Extract the original QMD figure label from the JATS ID
                    // "fig-plot-nb-article" -> "fig-plot"
                    const key = jatsId.replace(/-nb-article$/, '');
                    figMap.set(jatsId, key);
                    console.log(`Figure map: ${jatsId} -> ${key}`);
                }
            });
        }
    });

    return { citeMap, figMap };
}

/**
 * Serializes an array of ProseMirror inline nodes into a Markdown string.
 * Enhanced to handle comments and other inline marks.
 */
function serializeInlines(inlines, { citeMap, figMap }) {
  if (!inlines) return '';
  return inlines.map(inlineNode => {
    switch (inlineNode.type) {
      case 'text': {
        let text = inlineNode.text;
        
        // Handle marks (comments, emphasis, etc.)
        if (inlineNode.marks && inlineNode.marks.length > 0) {
          // Sort marks to ensure consistent formatting order
          const sortedMarks = [...inlineNode.marks].sort((a, b) => {
            const order = ['comment', 'strikethrough', 'strong', 'em'];
            return order.indexOf(a.type) - order.indexOf(b.type);
          });
          
          sortedMarks.forEach(mark => {
            switch (mark.type) {
              case 'comment':
                if (mark.attrs && mark.attrs.commentId) {
                  // Format as Quarto comment span
                  text = `[${text}]{.comment ref="${mark.attrs.commentId}"}`;
                }
                break;
              case 'strong':
                // Bold text: **text**
                text = `**${text}**`;
                break;
              case 'em':
                // Italic text: *text*
                text = `*${text}*`;
                break;
              case 'strikethrough':
                // Strikethrough text: ~~text~~
                text = `~~${text}~~`;
                break;
              default:
                console.warn(`Unhandled mark type: ${mark.type}`);
                break;
            }
          });
        }
        
        return text;
      }
      case 'citation': {
        const rid = inlineNode.attrs.rid;
        const label = inlineNode.attrs.label;
        const originalKey = inlineNode.attrs.originalKey;
        
        console.log(`Serializing citation: rid="${rid}", label="${label}", originalKey="${originalKey}"`);
        
        // Use originalKey if available, otherwise fall back to other methods
        if (originalKey) {
          console.log(`Using originalKey for citation: ${originalKey}`);
          return `[@${originalKey}]`;
        }
        
        // Try to get the citation key from the map
        const bibKey = citeMap.get(rid);
        if (bibKey) {
          console.log(`Using mapped citation key: ${bibKey}`);
          return `[@${bibKey}]`;
        }
        
        // Fallback: try to extract key from the label or rid
        if (label) {
          // If label looks like a citation key, use it
          if (/^[a-zA-Z0-9_-]+$/.test(label)) {
            console.log(`Using label as citation key: ${label}`);
            return `[@${label}]`;
          }
          // Otherwise, use the label as is
          console.log(`Using label as-is: ${label}`);
          return `[@${label}]`;
        }
        
        // Last resort: try to extract from rid
        if (rid) {
          const extractedKey = rid.replace(/^ref-/, '').replace(/-nb-article$/, '');
          if (extractedKey && extractedKey !== rid) {
            console.log(`Last resort: extracted key from rid: ${extractedKey}`);
            return `[@${extractedKey}]`;
          }
        }
        
        console.warn(`Could not resolve citation: rid="${rid}", label="${label}"`);
        return `[UNKNOWN_CITATION]`;
      }
      case 'figureReference': {
        const rid = inlineNode.attrs.rid;
        const label = inlineNode.attrs.label;
        const originalKey = inlineNode.attrs.originalKey;
        
        console.log(`Serializing figure reference: rid="${rid}", label="${label}", originalKey="${originalKey}"`);
        
        // Use originalKey if available, otherwise fall back to other methods
        if (originalKey) {
          console.log(`Using originalKey for figure reference: ${originalKey}`);
          return `@${originalKey}`;
        }
        
        // Try to get the figure key from the map
        const figLabel = figMap.get(rid);
        if (figLabel) {
          console.log(`Using mapped figure label: ${figLabel}`);
          return `@${figLabel}`;
        }
        
        // Fallback: try to extract from the label or rid
        if (label) {
          // If label looks like a figure reference, use it
          if (/^fig-/.test(label)) {
            console.log(`Using label as figure reference: ${label}`);
            return `@${label}`;
          }
          // If label is "Figure 1" or similar, try to extract the key from rid
          if (rid && rid.startsWith('fig-')) {
            const extractedKey = rid.replace(/-nb-article$/, '');
            console.log(`Extracted figure key from rid: ${extractedKey}`);
            return `@${extractedKey}`;
          }
          // Otherwise, use the label as is (this might be wrong, but it's a fallback)
          console.log(`Using label as-is: ${label}`);
          return `@${label}`;
        }
        
        // Last resort: try to extract from rid
        if (rid) {
          const extractedKey = rid.replace(/-nb-article$/, '');
          if (extractedKey && extractedKey !== rid) {
            console.log(`Last resort: extracted key from rid: ${extractedKey}`);
            return `@${extractedKey}`;
          }
        }
        
        console.warn(`Could not resolve figure reference: rid="${rid}", label="${label}"`);
        return `[UNKNOWN_FIGURE]`;
      }
      default:
        console.warn(`Unhandled inline node type: ${inlineNode.type}`);
        return inlineNode.text || '';
    }
  }).join('');
}

/**
 * Serializes a single ProseMirror block node into its .qmd string representation.
 * Enhanced to better preserve original QMD structure while incorporating text changes.
 */
function serializeBlock(node, blockMap, refMaps) {
  switch (node.type) {
    case 'heading': {
      const prefix = '#'.repeat(node.attrs.level);
      const text = serializeInlines(node.content, refMaps);
      const textWithLineBreaks = addLineBreaksAfterSentences(text);
      return `${prefix} ${textWithLineBreaks}`;
    }
    case 'paragraph': {
      const paragraphText = serializeInlines(node.content, refMaps);
      return addLineBreaksAfterSentences(paragraphText);
    }
    case 'quartoBlock': {
      const { blockKey, language, code, htmlOutput, figLabel, figCaption, chunkOptions } = node.attrs;
      
      console.log(`Serializing quartoBlock: blockKey="${blockKey}", language="${language}"`);
      
      // Handle bibliography blocks - don't render them in the output
      if (language === 'bibliography') {
          console.log('Skipping bibliography block');
          return ''; // Do not render the bibliography block.
      }
      
      // Handle metadata blocks - use the YAML block from the original file
      if (language === 'metadata') {
          console.log('Processing metadata block');
          console.log('Looking for blockKey:', blockKey);
          console.log('Available blockMap keys:', Array.from(blockMap.keys()));
          if (blockKey && blockMap.has(blockKey)) {
            console.log(`Found metadata block in blockMap: ${blockKey}`);
            const yamlContent = blockMap.get(blockKey);
            console.log('YAML content from blockMap:', yamlContent.substring(0, 200) + '...');
            return yamlContent;
          }
          console.log(`Metadata block not found in blockMap: ${blockKey}`);
          // If no blockKey, try to reconstruct basic YAML
          const metadata = node.attrs.metadata;
          if (metadata) {
            console.log('Reconstructing metadata from node attributes');
            let yaml = '---\n';
            if (metadata.title) yaml += `title: "${metadata.title}"\n`;
            if (metadata.authors && metadata.authors.length > 0) {
              yaml += 'author:\n';
              metadata.authors.forEach(author => {
                if (author.name) yaml += `  - name: ${author.name}\n`;
              });
            }
            if (pmDoc.attrs.bibliography) yaml += `bibliography: references.bib\n`;
            yaml += '---';
            return yaml;
          }
          return '';
      }
      
      // Handle code blocks with blockKey - preserve original structure
      if (blockKey && blockMap.has(blockKey)) {
        console.log(`Found code block in blockMap: ${blockKey}`);
        const codeContent = blockMap.get(blockKey);
        console.log('Code content from blockMap:', codeContent.substring(0, 100) + '...');
        return codeContent;
      }
      
      console.log(`Code block not found in blockMap: ${blockKey}`);
      console.log('Available blockMap keys:', Array.from(blockMap.keys()));
      console.log('Code block attrs:', JSON.stringify(node.attrs, null, 2));
      
      // Fallback: reconstruct code block from attributes if blockKey is missing
      if (code && (language || chunkOptions)) {
        console.log('Reconstructing code block from attributes');
        let reconstructed = '```{';
        if (chunkOptions) {
          reconstructed += chunkOptions;
        } else if (language) {
          reconstructed += language;
          if (figLabel) {
            reconstructed += `, label="${figLabel}"`;
          }
        }
        reconstructed += `}\n${code}\n\`\`\``;
        return reconstructed;
      }
      
      // If we can't reconstruct anything meaningful, log a warning but don't fail
      console.warn(`Could not reconstruct QMD block for key: ${blockKey || 'undefined'}`);
      return '';
    }
    default:
      console.warn(`Unhandled block node type: ${node.type}`);
      return '';
  }
}

/**
 * Main function to serialize a ProseMirror document back to a .qmd file string.
 * This function preserves the original QMD structure (metadata, code chunks, figures, tables)
 * while incorporating changes made to paragraph text in ProseMirror.
 * 
 * @param {object} pmDoc - The ProseMirror document JSON object.
 * @param {string} originalQmdString - The raw string content of the original .qmd file.
 * @param {Array<object>} commentsArray - Optional array of comment objects to append.
 * @returns {string} The full content of the newly constructed .qmd file.
 */
function proseMirrorJSON_to_qmd(pmDoc, originalQmdString, commentsArray = []) {
  if (!pmDoc || pmDoc.type !== 'doc') {
    throw new Error('Invalid ProseMirror document provided.');
  }

  // Debug: Log the document structure
  console.log('Serializing ProseMirror document:');
  console.log('- Document attrs:', JSON.stringify(pmDoc.attrs, null, 2));
  console.log('- Content nodes count:', pmDoc.content?.length || 0);
  
  // Parse the original QMD to get block mappings
  const { blockMap } = parseQmd(originalQmdString);
  console.log('- BlockMap keys:', Array.from(blockMap.keys()));
  console.log('- BlockMap contents:');
  blockMap.forEach((value, key) => {
    console.log(`  ${key}:`, value.substring(0, 100) + '...');
  });

  // Create maps for resolving cross-references
  const refMaps = createReferenceMaps(pmDoc);
  console.log('- Citation map size:', refMaps.citeMap.size);
  console.log('- Figure map size:', refMaps.figMap.size);
  console.log('- Citation map contents:', Object.fromEntries(refMaps.citeMap));
  console.log('- Figure map contents:', Object.fromEntries(refMaps.figMap));

  // Serialize each block node from the ProseMirror document
  const contentParts = pmDoc.content
    .map((node, index) => {
      console.log(`\n- Processing node ${index}:`, node.type);
      console.log('  Node attrs:', JSON.stringify(node.attrs, null, 2));
      const result = serializeBlock(node, blockMap, refMaps);
      console.log('  Serialized result:', result ? result.substring(0, 100) + '...' : 'EMPTY');
      return result;
    })
    .filter(part => part !== null && part !== ''); // Filter out empty strings

  // Join the parts to form the final document
  let result = contentParts.join('\n\n');
  console.log('- Final serialized content length:', result.length);
  console.log('- Final content preview:', result.substring(0, 500) + '...');
  
  // Add comments appendix if provided
  if (commentsArray && commentsArray.length > 0) {
    const commentsJsonPayload = JSON.stringify({ comments: commentsArray }, null, 2);
    const appendix = `\n<!-- Comments Appendix -->\n<div id="quartorium-comments" style="display:none;">\n\`\`\`json\n${commentsJsonPayload}\n\`\`\`\n</div>\n`;
    result += appendix;
  }
  
  return result.trim() + '\n'; // Ensure a final newline
}

module.exports = { proseMirrorJSON_to_qmd };

// Simple test for the sentence splitting function
if (require.main === module) {
  console.log('Testing sentence splitting:');
  const testText = "This is the first sentence. This is the second sentence! And this is the third sentence? Finally, this is the last sentence.";
  console.log('Original:', testText);
  console.log('With line breaks:');
  console.log(addLineBreaksAfterSentences(testText));
}