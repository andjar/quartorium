/**
 * Serializes ProseMirror JSON and comments to a QMD string.
 *
 * @param {object} prosemirrorJson - The ProseMirror document JSON.
 * @param {Array<object>} commentsArray - An array of comment objects.
 * @param {string} yamlString - The YAML frontmatter string.
 * @returns {string} The generated QMD string.
 */
function proseMirrorToQmd(prosemirrorJson, commentsArray, yamlString) {
  let qmdString = '';

  // 1. YAML Frontmatter
  if (yamlString && yamlString.trim().length > 0) {
    // yamlString from matter.stringify already includes '---' at start and end.
    // We just need to ensure there are two newlines after it.
    qmdString += yamlString.trim() + '\n\n';
  }


  // 2. Body Serialization
  if (prosemirrorJson && prosemirrorJson.content) {
    prosemirrorJson.content.forEach(node => {
      if (node.type === 'paragraph') {
        let paraText = '';
        if (node.content) {
          node.content.forEach(child => {
            if (child.type === 'text') {
              if (child.marks) {
                const commentMark = child.marks.find(mark => mark.type === 'comment' && mark.attrs && mark.attrs.commentId);
                if (commentMark) {
                  paraText += `[${child.text}]{.comment ref="${commentMark.attrs.commentId}"}`;
                } else {
                  paraText += child.text;
                }
              } else {
                paraText += child.text;
              }
            } else {
              // Handle other inline types if necessary, e.g., images, links (not specified, keeping simple)
              // For now, only text nodes within paragraphs are fully handled.
              console.warn(`Unhandled inline node type in paragraph: ${child.type}`);
            }
          });
        }
        qmdString += paraText + '\n\n';
      } else if (node.type === 'heading') {
        if (node.content && node.content[0] && node.content[0].text) {
          qmdString += '#'.repeat(node.attrs.level) + ' ' + node.content[0].text + '\n\n';
        }
      } else if (node.type === 'quartoBlock') { // From quartoParser.js for code blocks
        // Basic serialization for a code chunk. Assumes attrs.code and attrs.chunkOptions
        if (node.attrs && node.attrs.code && node.attrs.chunkOptions) {
            qmdString += '```{' + node.attrs.chunkOptions + '}\n';
            qmdString += node.attrs.code.trim() + '\n';
            qmdString += '```\n\n';
        } else {
            console.warn('Quarto block node missing code or chunkOptions', node.attrs);
        }
      }
      // Add other block types as needed, matching quartoParser.js
      else {
        console.warn(`Unhandled block node type: ${node.type}`);
      }
    });
  }

  // 3. Comments Appendix Serialization
  if (commentsArray && commentsArray.length > 0) {
    const commentsJsonPayload = JSON.stringify({ comments: commentsArray }, null, 2);
    const appendix = `\n<!-- Comments Appendix -->\n<div id="quartorium-comments" style="display:none;">\n\`\`\`json\n${commentsJsonPayload}\n\`\`\`\n</div>\n`;
    qmdString += appendix;
  }

  return qmdString.trim() + '\n'; // Ensure a final newline
}

module.exports = { proseMirrorToQmd };
