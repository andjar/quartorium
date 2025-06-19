const { proseMirrorJSON_to_qmd } = require('../src/core/astSerializer');

// Test case 1: Document with undefined block keys
const testDoc1 = {
    "type": "doc",
    "attrs": {
        "metadata": {
            "title": "Test Document",
            "authors": []
        },
        "bibliography": {}
    },
    "content": [
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": "This is a test paragraph with a citation "
                },
                {
                    "type": "citation",
                    "attrs": { 
                        "rid": "ref-knuth84-nb-article", 
                        "label": "knuth84" 
                    }
                },
                {
                    "type": "text",
                    "text": " and a figure reference "
                },
                {
                    "type": "figureReference",
                    "attrs": { 
                        "rid": "fig-plot-nb-article", 
                        "label": "fig-plot" 
                    }
                },
                {
                    "type": "text",
                    "text": "."
                }
            ]
        },
        {
            "type": "heading",
            "attrs": {
                "level": 2
            },
            "content": [
                {
                    "type": "text",
                    "text": "Section"
                }
            ]
        },
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": undefined,
                "language": "r",
                "code": "plot(cars)\nsummary(cars)",
                "figLabel": "fig-cars"
            }
        },
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": undefined,
                "language": "r",
                "code": "print('Hello World')",
                "figLabel": "fig-hello"
            }
        }
    ]
};

// Test case 2: Document with proper block keys
const testDoc2 = {
    "type": "doc",
    "attrs": {
        "metadata": {
            "title": "Test Document",
            "authors": [
                { "name": "John Doe" },
                { "given": "Jane", "surname": "Smith" }
            ]
        },
        "bibliography": {
            "ref-knuth84-nb-article": {
                "id": "knuth84",
                "title": "The Art of Computer Programming",
                "authors": [{ "given": "Donald", "surname": "Knuth" }],
                "year": "1984"
            }
        }
    },
    "content": [
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": "__YAML_BLOCK__",
                "language": "metadata",
                "metadata": {
                    "title": "Test Document",
                    "authors": [
                        { "name": "John Doe" },
                        { "given": "Jane", "surname": "Smith" }
                    ]
                }
            }
        },
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": "This is a test paragraph with a citation "
                },
                {
                    "type": "citation",
                    "attrs": { 
                        "rid": "ref-knuth84-nb-article", 
                        "label": "knuth84" 
                    }
                },
                {
                    "type": "text",
                    "text": "."
                }
            ]
        },
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": "fig-cars",
                "language": "r",
                "code": "plot(cars)\nsummary(cars)",
                "figLabel": "fig-cars"
            }
        }
    ]
};

// Original QMD content for testing
const originalQmd = `---
title: "Test Document"
author:
  - John Doe
  - Jane Smith
---

\`\`\`{r, label="fig-cars"}
plot(cars)
summary(cars)
\`\`\`

This is a simple placeholder for the manuscript's main document.

\`\`\`{r, label="fig-hello"}
print('Hello World')
\`\`\`

 is a simple plot.`;

console.log('=== Testing Serialization ===\n');

console.log('Test 1: Document with undefined block keys');
try {
    const result1 = proseMirrorJSON_to_qmd(testDoc1, originalQmd);
    console.log('Result:', result1);
} catch (error) {
    console.error('Error in test 1:', error.message);
}

console.log('\nTest 2: Document with proper block keys');
try {
    const result2 = proseMirrorJSON_to_qmd(testDoc2, originalQmd);
    console.log('Result:', result2);
} catch (error) {
    console.error('Error in test 2:', error.message);
} 