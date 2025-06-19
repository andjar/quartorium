const { proseMirrorToQmd } = require('./quartoSerializer.js');

function runQuartoSerializerTests() {
  console.log("Running quartoSerializer.js tests...\n");
  let testsPassed = 0;
  let testsFailed = 0;

  const assertEqual = (actual, expected, testName) => {
    // Normalize whitespace for comparison (replace multiple newlines with one, trim ends)
    const normalize = (str) => str.replace(/\n\s*\n/g, '\n\n').trim();
    const actualNormalized = normalize(actual);
    const expectedNormalized = normalize(expected);

    if (actualNormalized === expectedNormalized) {
      console.log(`✅ PASSED: ${testName}`);
      testsPassed++;
    } else {
      console.error(`❌ FAILED: ${testName}`);
      console.error(`   Expected: ${JSON.stringify(expectedNormalized)}`);
      console.error(`   Actual:   ${JSON.stringify(actualNormalized)}`);
      testsFailed++;
    }
  };

  // Test case 1: Simple PM JSON, empty comments, no YAML
  const pmJson1 = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Hello world." }]
    }]
  };
  const comments1 = [];
  const yaml1 = "";
  const expectedQmd1 = "Hello world.\n";
  assertEqual(proseMirrorToQmd(pmJson1, comments1, yaml1), expectedQmd1, "Test 1: Simple PM, empty comments, no YAML");

  // Test case 2: PM JSON with a comment mark
  const pmJson2 = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "This is " },
        { type: "text", text: "important", marks: [{ type: "comment", attrs: { commentId: "c1" } }] },
        { type: "text", text: "." }
      ]
    }]
  };
  const comments2 = [];
  const yaml2 = "";
  const expectedQmd2 = "This is [important]{.comment ref=\"c1\"}.\n";
  assertEqual(proseMirrorToQmd(pmJson2, comments2, yaml2), expectedQmd2, "Test 2: PM JSON with comment mark");

  // Test case 3: Populated commentsArray, simple PM JSON, no YAML
  const pmJson3 = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Some text." }]
    }]
  };
  const comments3 = [{ id: "c1", author: "user1", thread: [{ text: "A comment" }] }];
  const yaml3 = "";
  const expectedQmd3 = `Some text.

<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": [
    {
      "id": "c1",
      "author": "user1",
      "thread": [
        {
          "text": "A comment"
        }
      ]
    }
  ]
}
\`\`\`
</div>
`;
  assertEqual(proseMirrorToQmd(pmJson3, comments3, yaml3), expectedQmd3, "Test 3: Populated commentsArray");

  // Test case 4: With YAML frontmatter
  const pmJson4 = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Content here." }]
    }]
  };
  const comments4 = [];
  const yaml4 = "---\ntitle: My Document\nauthor: Test Author\n---";
  // The serializer adds an extra '---' line after the yamlString if it doesn't end with one.
  // And then two newlines.
  const expectedQmd4 = `---
title: My Document
author: Test Author
---

Content here.
`;
  assertEqual(proseMirrorToQmd(pmJson4, comments4, yaml4), expectedQmd4, "Test 4: With YAML frontmatter");

  // Test case 5: Mixed content in a paragraph
  const pmJson5 = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "Text before. " },
        { type: "text", text: "Marked text", marks: [{ type: "comment", attrs: { commentId: "c2" } }] },
        { type: "text", text: ". Text after." }
      ]
    }]
  };
  const comments5 = [];
  const yaml5 = "";
  const expectedQmd5 = "Text before. [Marked text]{.comment ref=\"c2\"}. Text after.\n";
  assertEqual(proseMirrorToQmd(pmJson5, comments5, yaml5), expectedQmd5, "Test 5: Mixed content in paragraph");

  // Test case 6: Multiple paragraphs and a heading
  const pmJson6 = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Main Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
      { type: "paragraph", content: [
          { type: "text", text: "Second paragraph with " },
          { type: "text", text: "a comment", marks: [{ type: "comment", attrs: { commentId: "c3" } }] },
          { type: "text", text: " inside." }
      ]}
    ]
  };
  const comments6 = [{ id: "c3", text: "A comment on second para" }];
  const yaml6 = "---\nkey: value\n---";
  const expectedQmd6 = `---
key: value
---

# Main Title

First paragraph.

Second paragraph with [a comment]{.comment ref="c3"} inside.

<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": [
    {
      "id": "c3",
      "text": "A comment on second para"
    }
  ]
}
\`\`\`
</div>
`;
  assertEqual(proseMirrorToQmd(pmJson6, comments6, yaml6), expectedQmd6, "Test 6: Multiple blocks, heading, and comments");

  // Test case 7: Empty YAML ('--- \n ---')
  const pmJson7 = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello." }] }] };
  const yaml7 = "---\n---\n";
  const expectedQmd7 = "---\n---\n\nHello.\n";
  assertEqual(proseMirrorToQmd(pmJson7, [], yaml7), expectedQmd7, "Test 7: Empty YAML frontmatter");

  // Test case 8: Quarto code block
  const pmJson8 = {
    type: "doc",
    content: [{
      type: "quartoBlock",
      attrs: { code: "print('Hello')", chunkOptions: "python" }
    }]
  };
  const expectedQmd8 = "```{" + "python}\nprint('Hello')\n```\n";
  assertEqual(proseMirrorToQmd(pmJson8, [], ""), expectedQmd8, "Test 8: Quarto code block");


  console.log("\nquartoSerializer.js tests summary:");
  console.log(`${testsPassed} tests passed.`);
  console.log(`${testsFailed} tests failed.`);
  console.log("-------------------------------------\n");
  return testsFailed === 0;
}

runQuartoSerializerTests();
