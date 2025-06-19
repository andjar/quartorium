const { extractCommentsAppendix } = require('../src/core/commentUtils');
const { parseQmd } = require('../src/core/qmdBlockParser');
const path = require('path');
const fs = require('fs/promises');

// Test the full pipeline including comment extraction and QMD parsing
async function testFullPipeline() {
  console.log('Testing full pipeline...\n');
  
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
        },
        {
          "text": "I think we should do this!",
          "author": "John Doe",
          "timestamp": "2025-06-19T23:04:51.492Z"
        }
      ],
      "isNew": false
    }
  ]
}
\`\`\`
</div>`;

  console.log('1. Extracting comments...');
  const { comments: extractedComments, remainingQmdString: qmdWithoutComments } = extractCommentsAppendix(testQmd);
  
  console.log(`   - Extracted ${extractedComments.length} comments`);
  console.log(`   - QMD without comments length: ${qmdWithoutComments.length} characters`);
  
  console.log('\n2. Parsing QMD without comments...');
  const { blockMap } = parseQmd(qmdWithoutComments);
  
  console.log(`   - Found ${blockMap.size} blocks in blockMap`);
  console.log('   - BlockMap keys:', Array.from(blockMap.keys()));
  
  console.log('\n3. Checking for citation and figure reference patterns...');
  const citationPattern = /\[@([^\]]+)\]/g;
  const figurePattern = /@([a-zA-Z0-9_-]+)/g;
  
  const citations = [...qmdWithoutComments.matchAll(citationPattern)];
  const figures = [...qmdWithoutComments.matchAll(figurePattern)];
  
  console.log(`   - Found ${citations.length} citations:`, citations.map(match => match[1]));
  console.log(`   - Found ${figures.length} figure references:`, figures.map(match => match[1]));
  
  console.log('\n4. Verifying blockMap contains expected blocks...');
  const expectedBlocks = ['__YAML_BLOCK__', 'fig-plot'];
  expectedBlocks.forEach(block => {
    if (blockMap.has(block)) {
      console.log(`   ✅ Found block: ${block}`);
    } else {
      console.log(`   ❌ Missing block: ${block}`);
    }
  });
  
  console.log('\n5. Sample of remaining QMD content:');
  console.log(qmdWithoutComments.substring(0, 300) + '...');
  
  return {
    comments: extractedComments,
    qmdWithoutComments,
    blockMap,
    citations: citations.map(match => match[1]),
    figures: figures.map(match => match[1])
  };
}

// Run the test
testFullPipeline().catch(console.error); 