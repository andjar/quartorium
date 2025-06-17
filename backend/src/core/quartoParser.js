const matter = require('gray-matter');
const { unified } = require('unified');
const remarkParse = require('remark-parse').default; 
const { renderChunk } = require('./quartoRunner');

async function qmdToProseMirror(qmdString) {
  const { data: yaml, content: markdown } = matter(qmdString);
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
      // For now, we'll do a simple conversion. A real implementation
      // would traverse the node's children for bold, italics, etc.
      // This is a simplification for Epic 3.
      
      // Let's create a placeholder for standard markdown content
      // We will render it as simple text for now.
      // A full markdown-to-prosemirror converter is a later step.
      const textContent = node.children?.map(c => c.value).join('') || '';

      if (node.type === 'heading') {
        proseMirrorNodes.push({
          type: 'heading',
          attrs: { level: node.depth },
          content: [{ type: 'text', text: textContent }],
        });
      } else if (node.type === 'paragraph') {
         proseMirrorNodes.push({
          type: 'paragraph',
          content: [{ type: 'text', text: textContent }],
        });
      }
      // Note: This simplified parser ignores lists, blockquotes, etc. for now.
    }
  }

  return {
    type: 'doc',
    content: proseMirrorNodes,
    attrs: {
      yaml, // Attach the YAML frontmatter to the document
    },
  };
}

module.exports = { qmdToProseMirror };