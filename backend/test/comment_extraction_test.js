const { extractCommentsAppendix } = require('../src/core/commentUtils');

// Test the comment extraction functionality
function testCommentExtraction() {
  console.log('Testing comment extraction...\n');
  
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

  const result = extractCommentsAppendix(testQmd);
  
  console.log('Extraction result:');
  console.log('- Comments found:', result.comments.length);
  console.log('- First comment ID:', result.comments[0]?.id);
  console.log('- Remaining QMD length:', result.remainingQmdString.length);
  console.log('- Remaining QMD contains comments appendix:', result.remainingQmdString.includes('Comments Appendix'));
  
  console.log('\nExtracted comments:');
  console.log(JSON.stringify(result.comments, null, 2));
  
  console.log('\nRemaining QMD (first 200 chars):');
  console.log(result.remainingQmdString.substring(0, 200) + '...');
  
  return result;
}

// Run the test
testCommentExtraction(); 