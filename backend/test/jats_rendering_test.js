const { extractCommentsAppendix } = require('../src/core/commentUtils');
const { parseQmd } = require('../src/core/qmdBlockParser');
const { renderToJATS, jatsToProseMirrorJSON } = require('../src/core/astParser');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

// Test the JATS rendering process
async function testJatsRendering() {
  console.log('Testing JATS rendering process...\n');
  
  const testQmd = `---
title: Quartorium
authors:
  - name: Norah Jones
    affiliation: The University
    roles: writing
    corresponding: true
bibliography: references.bib
---

## Section

This is a placeholderfor the manuscript's main document ([@knuth84]).

\`\`\`{r}
#| label: fig-plot
#| fig-cap: "A simple plot"
plot(1)
\`\`\`

@fig-plot is a simple plot.

<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": [
    {
      "id": "c-1750374236614-pi9ok",
      "author": "Jane Doe",
      "timestamp": "2025-06-19T23:03:56.614Z",
      "status": "open",
      "thread": [
        {
          "text": "Comment;)",
          "author": "Jane Doe",
          "timestamp": "2025-06-19T23:04:03.242Z"
        }
      ],
      "isNew": false
    }
  ]
}
\`\`\`
</div>`;

  try {
    console.log('1. Extracting comments...');
    const { comments: extractedComments, remainingQmdString: qmdWithoutComments } = extractCommentsAppendix(testQmd);
    console.log(`   - Extracted ${extractedComments.length} comments`);
    
    console.log('\n2. Parsing QMD without comments...');
    const { blockMap } = parseQmd(qmdWithoutComments);
    console.log(`   - Found ${blockMap.size} blocks in blockMap`);
    
    console.log('\n3. Creating temporary file for JATS rendering...');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jats-test-'));
    const tempQmdPath = path.join(tempDir, 'test.qmd');
    
    // Create a minimal bibliography file to avoid the error
    const bibContent = `@article{knuth84,
  title={The {\\TeX}book},
  author={Knuth, Donald E},
  year={1984},
  publisher={Addison--Wesley}
}`;
    await fs.writeFile(path.join(tempDir, 'references.bib'), bibContent);
    
    await fs.writeFile(tempQmdPath, qmdWithoutComments);
    
    console.log(`   - Created temp file: ${tempQmdPath}`);
    console.log(`   - Created bibliography file: ${path.join(tempDir, 'references.bib')}`);
    console.log(`   - Temp directory: ${tempDir}`);
    
    console.log('\n4. Rendering to JATS...');
    const { jatsXml } = await renderToJATS(tempQmdPath, tempDir, 'test-repo', 'test-commit');
    
    console.log(`   - JATS XML length: ${jatsXml.length} characters`);
    console.log('\n   - JATS XML sample (first 500 chars):');
    console.log(jatsXml.substring(0, 500) + '...');
    
    // Look for citation and figure reference patterns in JATS
    console.log('\n5. Analyzing JATS for citation and figure reference patterns...');
    
    // Look for xref elements
    const xrefMatches = jatsXml.match(/<xref[^>]*>/g);
    if (xrefMatches) {
      console.log(`   - Found ${xrefMatches.length} xref elements:`);
      xrefMatches.forEach((match, index) => {
        console.log(`     ${index + 1}. ${match}`);
      });
    }
    
    // Look for the actual text content around citations and figure references
    console.log('\n   - Looking for citation and figure reference text patterns...');
    
    // Find paragraphs containing citations and figure references
    const paragraphMatches = jatsXml.match(/<p[^>]*>([\s\S]*?)<\/p>/g);
    if (paragraphMatches) {
      paragraphMatches.forEach((match, index) => {
        if (match.includes('xref') || match.includes('@') || match.includes('[')) {
          console.log(`     Paragraph ${index + 1}: ${match.replace(/\s+/g, ' ')}`);
        }
      });
    }
    
    // Look for specific citation patterns
    const citationPattern = /\[@([^\]]+)\]/g;
    const citations = [...jatsXml.matchAll(citationPattern)];
    console.log(`   - Found ${citations.length} citation patterns in JATS:`, citations.map(match => match[1]));
    
    // Look for figure reference patterns
    const figurePattern = /@([a-zA-Z0-9_-]+)/g;
    const figures = [...jatsXml.matchAll(figurePattern)];
    console.log(`   - Found ${figures.length} figure reference patterns in JATS:`, figures.map(match => match[1]));
    
    console.log('\n6. Transforming JATS to ProseMirror JSON...');
    const proseMirrorJson = await jatsToProseMirrorJSON(jatsXml, blockMap, 'test-repo', 'test-commit', tempQmdPath);
    
    console.log(`   - ProseMirror JSON structure:`, {
      type: proseMirrorJson.type,
      contentLength: proseMirrorJson.content?.length || 0,
      attrs: proseMirrorJson.attrs
    });
    
    // Look for citations and figure references in the ProseMirror JSON
    console.log('\n7. Analyzing ProseMirror JSON for citations and figure references...');
    
    const findCitationsAndFigures = (nodes) => {
      const results = { citations: [], figures: [] };
      
      const traverse = (node) => {
        if (node.type === 'citation') {
          results.citations.push({
            rid: node.attrs.rid,
            label: node.attrs.label
          });
        } else if (node.type === 'figureReference') {
          results.figures.push({
            rid: node.attrs.rid,
            label: node.attrs.label
          });
        }
        
        if (node.content) {
          node.content.forEach(traverse);
        }
      };
      
      nodes.forEach(traverse);
      return results;
    };
    
    const found = findCitationsAndFigures(proseMirrorJson.content);
    console.log(`   - Found ${found.citations.length} citations in ProseMirror:`, found.citations);
    console.log(`   - Found ${found.figures.length} figure references in ProseMirror:`, found.figures);
    
    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('\n8. Cleaned up temporary directory');
    
    return {
      comments: extractedComments,
      jatsXml,
      proseMirrorJson,
      found
    };
    
  } catch (error) {
    console.error('Error during JATS rendering test:', error);
    throw error;
  }
}

// Run the test
testJatsRendering().catch(console.error); 