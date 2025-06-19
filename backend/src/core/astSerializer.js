const yaml = require('js-yaml');

/**
 * Serializes an array of ProseMirror inline nodes (text with marks) into a Markdown string.
 * @param {Array} inlines - The `content` array from a ProseMirror node like a paragraph or heading.
 * @returns {string} A Markdown string.
 */
function serializeInlines(inlines) {
  if (!inlines) return '';
  
  return inlines.map(inlineNode => {
    if (inlineNode.type === 'citation') {
      // From `Citation.js`, the `label` attribute holds the full text like `[@key]`
      return inlineNode.attrs.label || '';
    }

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
          case 'code':
            text = `\`${text}\``;
            break;
        }
      });
    }
    return text;
  }).join('');
}

/**
 * Serializes a single ProseMirror block node into its .qmd string representation.
 * @param {object} node - A block node from the ProseMirror document's `content` array.
 * @param {number} listIndent - The current indentation level for lists.
 * @returns {string} The .qmd string for that block.
 */
function serializeBlock(node, listIndent = 0) {
  const indent = '  '.repeat(listIndent);

  switch (node.type) {
    case 'heading': {
      const prefix = '#'.repeat(node.attrs.level);
      const text = serializeInlines(node.content);
      return `${prefix} ${text}`;
    }
    case 'paragraph': {
      if (!node.content) {
        return '';
      }
      return serializeInlines(node.content);
    }
    case 'quartoBlock': {
      const { code, chunkOptions } = node.attrs;
      return `\`\`\`{${chunkOptions}}\n${code}\n\`\`\``;
    }
    case 'blockquote': {
      const content = node.content.map(n => serializeBlock(n, listIndent)).join('\n');
      return content.split('\n').map(line => `> ${line}`).join('\n');
    }
    case 'bulletList': {
      return node.content
        .map(li => serializeBlock(li, listIndent))
        .join('\n');
    }
    case 'orderedList': {
      const start = node.attrs?.start || 1;
      return node.content
        .map((li, i) => {
          const itemText = serializeBlock(li, listIndent, i);
          // Replace the leading bullet point from listItem with a numbered one.
          return itemText.replace(/^(\s*)\*\s/, `$1${start + i}. `)
        })
        .join('\n');
    }
    case 'listItem': {
      // List items can contain paragraphs and nested lists.
      // We handle the content and then add the bullet point.
      const content = node.content
        .map(n => serializeBlock(n, listIndent + 1))
        .join('\n');
      
      const bullet = '*'; 
      const firstLine = `${indent}${bullet} ${content.split('\n')[0]}`;
      const otherLines = content.split('\n').slice(1).map(line => `  ${line}`).join('\n');

      if (otherLines) {
        return `${firstLine}\n${otherLines}`;
      }
      return firstLine;
    }
    default:
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
  const yamlString = doc.attrs?.yaml 
    ? `---\n${yaml.dump(doc.attrs.yaml)}---\n` 
    : '';

  // 2. Serialize each block node in the document's content array.
  const contentString = doc.content
    .map(node => serializeBlock(node))
    .join('\n\n'); // Join blocks with two newlines for proper Markdown spacing.

  // 3. Join the YAML and the main content.
  return yamlString + contentString;
}

module.exports = { proseMirrorJSON_to_qmd };