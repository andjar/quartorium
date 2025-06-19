import { extractCommentsAppendix } from './commentUtils.js';

function runCommentUtilsTests() {
  console.log("Running commentUtils.js tests...\n");
  let testsPassed = 0;
  let testsFailed = 0;

  const assertEqual = (actual, expected, testName) => {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr === expectedStr) {
      console.log(`✅ PASSED: ${testName}`);
      testsPassed++;
    } else {
      console.error(`❌ FAILED: ${testName}`);
      console.error(`   Expected: ${expectedStr}`);
      console.error(`   Actual:   ${actualStr}`);
      testsFailed++;
    }
  };

  const assertThrows = (fn, testName, expectedErrorMessageContent) => {
    try {
      fn();
      console.error(`❌ FAILED: ${testName} - Expected function to throw.`);
      testsFailed++;
    } catch (e) {
      if (expectedErrorMessageContent && !e.message.includes(expectedErrorMessageContent)) {
        console.error(`❌ FAILED: ${testName} - Error message "${e.message}" did not include "${expectedErrorMessageContent}"`);
        testsFailed++;
      } else {
        console.log(`✅ PASSED: ${testName} (threw as expected)`);
        testsPassed++;
      }
    }
  };

  // Mock console.error for specific tests
  const originalConsoleError = console.error;
  let consoleErrorOutput = [];
  const mockConsoleError = (...args) => {
    consoleErrorOutput.push(args.join(' '));
  };
  const clearConsoleErrorOutput = () => {
    consoleErrorOutput = [];
  };
  const getConsoleErrorOutput = () => consoleErrorOutput.join('\n');


  // Test case 1: Valid QMD with comments appendix
  const qmdWithComments = `---
title: Test Doc
---

Some text.

<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": [
    { "id": "c1", "text": "Comment 1" },
    { "id": "c2", "text": "Comment 2" }
  ]
}
\`\`\`
</div>`;
  const expectedResult1 = {
    comments: [{ "id": "c1", "text": "Comment 1" }, { "id": "c2", "text": "Comment 2" }],
    remainingQmdString: `---
title: Test Doc
---

Some text.`
  };
  let result1 = extractCommentsAppendix(qmdWithComments);
  assertEqual(result1, expectedResult1, "Test 1: Valid QMD with comments appendix");

  // Test case 2: QMD string missing the appendix
  const qmdWithoutAppendix = `---
title: Test Doc
---

Some text without appendix.`;
  const expectedResult2 = {
    comments: [],
    remainingQmdString: qmdWithoutAppendix
  };
  let result2 = extractCommentsAppendix(qmdWithoutAppendix);
  assertEqual(result2, expectedResult2, "Test 2: QMD string missing the appendix");

  // Test case 3: Malformed JSON in appendix
  const qmdWithMalformedJson = `---
title: Test Doc
---
<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": [
    { "id": "c1", "text": "Comment 1" },
    { "id": "c2", "text": "Comment 2" }
  ] // Missing closing curly brace
\`\`\`
</div>`;
  const expectedResult3 = {
    comments: [],
    remainingQmdString: `---
title: Test Doc
---`
  };
  console.error = mockConsoleError; // Start capturing console.error
  clearConsoleErrorOutput();
  let result3 = extractCommentsAppendix(qmdWithMalformedJson);
  const errorOutput3 = getConsoleErrorOutput();
  console.error = originalConsoleError; // Restore console.error FIRST

  if (JSON.stringify(result3) === JSON.stringify(expectedResult3) && errorOutput3.includes("Invalid JSON in comments appendix")) {
      console.log(`✅ PASSED: Test 3: Malformed JSON in appendix (correct output and error logged)`);
      testsPassed++;
  } else {
      console.error(`❌ FAILED: Test 3: Malformed JSON in appendix`);
      if(JSON.stringify(result3) !== JSON.stringify(expectedResult3)) {
        console.error(`   Output mismatch - Expected: ${JSON.stringify(expectedResult3)}, Actual: ${JSON.stringify(result3)}`);
      }
      if(!errorOutput3.includes("Invalid JSON in comments appendix")) { // Made the expected message more specific
        console.error(`   Error log mismatch - Expected "Invalid JSON in comments appendix" in log, Got: "${errorOutput3}"`);
      }
      testsFailed++;
  }


  // Test case 4: Empty comments array in appendix
  const qmdWithEmptyComments = `---
title: Test Doc
---
<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{
  "comments": []
}
\`\`\`
</div>`;
  const expectedResult4 = {
    comments: [],
    remainingQmdString: `---
title: Test Doc
---`
  };
  let result4 = extractCommentsAppendix(qmdWithEmptyComments);
  assertEqual(result4, expectedResult4, "Test 4: Empty comments array in appendix");

  // Test case 5: Appendix present but JSON is just an empty object (no "comments" key)
  const qmdWithEmptyJsonObject = `---
title: Test Doc
---
<!-- Comments Appendix -->
<div id="quartorium-comments" style="display:none;">
\`\`\`json
{}
\`\`\`
</div>`;
    const expectedResult5 = {
    comments: [], // Should default to empty array
    remainingQmdString: `---
title: Test Doc
---`
  };
  let result5 = extractCommentsAppendix(qmdWithEmptyJsonObject);
  assertEqual(result5, expectedResult5, "Test 5: Appendix with empty JSON object (no 'comments' key)");

  // Test case 6: Appendix with different whitespace and newlines
    const qmdWithVariedWhitespace = `---
title: Test Doc
---

Some text.

<!-- Comments Appendix -->
    <div id="quartorium-comments" style="display:none;">
  \`\`\`json
  {
    "comments": [
      { "id": "c1", "text": "Comment 1" }
    ]
  }
  \`\`\`
      </div>`;
  const expectedResult6 = {
    comments: [{ "id": "c1", "text": "Comment 1" }],
    remainingQmdString: `---
title: Test Doc
---

Some text.`
  };
  let result6 = extractCommentsAppendix(qmdWithVariedWhitespace);
  assertEqual(result6, expectedResult6, "Test 6: Appendix with varied whitespace");


  console.log("\ncommentUtils.js tests summary:");
  console.log(`${testsPassed} tests passed.`);
  console.log(`${testsFailed} tests failed.`);
  console.log("-------------------------------------\n");
  return testsFailed === 0;
}

runCommentUtilsTests();
