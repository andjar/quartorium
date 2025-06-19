const matter = require('gray-matter');
const { unified } = require('unified');
const remarkParse = require('remark-parse').default;
const { renderChunk } = require('./quartoRunner');
const { extractCommentsAppendix } = require('./commentUtils');

async function qmdToProseMirror(qmdString) {
  const { comments, remainingQmdString } = extractCommentsAppendix(qmdString);
  const { data: yaml, content: markdown } = matter(remainingQmdString);
  const tree = unified().use(remarkParse).parse(markdown);

  const proseMirrorNodes = [];

  for (const node of tree.children) {
    if (node.type === 'code' && node.lang) {
      // This is a Quarto code chunk
      const chunkOptions = node.lang;
      const code = node.value;

      // Render the chunk to get its output
      const htmlOutput = await renderChunk(code, chunkOptions);

      proseMirrorNodes.push({
        type: 'quartoBlock',
        attrs: {
          code,
          chunkOptions,
          htmlOutput,
        },
      });
    } else {
      // This is a standard Markdown node (paragraph, heading, etc.)
      // This is where we need to handle spans for comments.
      if (node.type === 'heading') {
        const textContent = node.children?.map(c => c.value).join('') || '';
        proseMirrorNodes.push({
          type: 'heading',
          attrs: { level: node.depth },
          content: [{ type: 'text', text: textContent }],
        });
      } else if (node.type === 'paragraph') {
        const paragraphContent = [];
        for (const child of node.children) {
          if (child.type === 'text') {
            // Attempt to find comment spans within the text node
            // This is a simplified approach. A proper solution would use a remark plugin.
            const commentSpanRegex = /\[([^\]]+)\]\{(.comment)\s+ref="([^"]+)"\}/g;
            let lastIndex = 0;
            let match;
            const textValue = child.value;

            while ((match = commentSpanRegex.exec(textValue)) !== null) {
              // Add text before the comment span
              if (match.index > lastIndex) {
                paragraphContent.push({ type: 'text', text: textValue.substring(lastIndex, match.index) });
              }
              // Add the comment span text with mark
              const [, innerText, , commentId] = match; // Corrected destructuring
              paragraphContent.push({
                type: 'text',
                text: innerText,
                marks: [{ type: 'comment', attrs: { commentId } }],
              });
              lastIndex = commentSpanRegex.lastIndex;
            }

            // Add any remaining text after the last comment span
            if (lastIndex < textValue.length) {
              paragraphContent.push({ type: 'text', text: textValue.substring(lastIndex) });
            }
          } else {
            // For other inline types (e.g., strong, em), recursively process or add as plain text
            // This part needs to be more robust for a full converter.
            paragraphContent.push({ type: 'text', text: child.value || '' });
          }
        }
        proseMirrorNodes.push({
          type: 'paragraph',
          content: paragraphContent,
        });
      }
      // Note: This simplified parser ignores lists, blockquotes, etc. for now.
    }
  }

  const prosemirrorJson = {
    type: 'doc',
    content: proseMirrorNodes,
    attrs: {
      yaml, // Attach the YAML frontmatter to the document
    },
  };

  return { prosemirrorJson, comments };
}

module.exports = { qmdToProseMirror };