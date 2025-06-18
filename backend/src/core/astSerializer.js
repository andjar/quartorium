const yaml = require('js-yaml');

/**
 * Serializes an array of ProseMirror inline nodes (text with marks) into a Markdown string.
 * @param {Array} inlines - The `content` array from a ProseMirror node like a paragraph or heading.
 * @returns {string} A Markdown string.
 */
function serializeInlines(inlines) {
  if (!inlines) return '';
  
  return inlines.map(inlineNode => {
    let text = inlineNode.text;
    if (inlineNode.marks) {
      // Apply marks from the inside out (e.g., bold, then italic)
      inlineNode.marks.forEach(mark => {
        switch (mark.type) {
          case 'strong':
          case 'bold': // TipTap starter kit uses 'bold'
            text = `**${text}**`;
            break;
          case 'em':
          case 'italic': // TipTap starter kit uses 'italic'
            text = `*${text}*`;
            break;
          case 'link':
            text = `[${text}](${mark.attrs.href})`;
            break;
          // Add cases for 'code', 'strike', etc. as needed
        }
      });
    }
    return text;
  }).join('');
}

/**
 * Serializes a single ProseMirror block node into its .qmd string representation.
 * @param {object} node - A block node from the ProseMirror document's `content` array.
 * @returns {string} The .qmd string for that block.
 */
function serializeBlock(node) {
  switch (node.type) {
    case 'heading': {
      const prefix = '#'.repeat(node.attrs.level);
      const text = serializeInlines(node.content);
      return `${prefix} ${text}`;
    }
    case 'paragraph': {
      // An empty paragraph in ProseMirror might be just a placeholder.
      // In Markdown, this is represented by a blank line.
      if (!node.content) {
        return '';
      }
      return serializeInlines(node.content);
    }
    case 'quartoBlock': {
      const { code, chunkOptions } = node.attrs;
      // Reconstruct the code chunk exactly as it was.
      // The `htmlOutput` is ignored, as it will be regenerated on the next render.
      return `\`\`\`{${chunkOptions}}\n${code}\n\`\`\``;
    }
    // Add cases for 'bulletList', 'orderedList', 'blockquote' as needed.
    default:
      // If we encounter a node type we don't know how to serialize,
      // it's safest to return an empty string to avoid corrupting the file.
      console.warn(`[Serializer] Unknown block type encountered: ${node.type}`);
      return '';
  }
}

/**
 * The main function to serialize a ProseMirror document object back to a .qmd file string.
 * @param {object} doc - The ProseMirror document JSON object.
 * @returns {string} The full content of the .qmd file.
 */
function proseMirrorJSON_to_qmd(doc) {
  if (!doc || doc.type !== 'doc') {
    throw new Error('Invalid ProseMirror document provided to serializer.');
  }

  // 1. Reconstruct the YAML frontmatter.
  // The 'js-yaml' library can convert a JS object back into a valid YAML string.
  // We add the `---` delimiters ourselves.
  const yamlString = doc.attrs?.yaml 
    ? `---\n${yaml.dump(doc.attrs.yaml)}---\n` 
    : '';

  // 2. Serialize each block node in the document's content array.
  const contentString = doc.content
    .map(serializeBlock)
    .join('\n\n'); // Join blocks with two newlines for proper Markdown spacing.

  // 3. Join the YAML and the main content.
  return yamlString + contentString;
}

module.exports = { proseMirrorJSON_to_qmd };