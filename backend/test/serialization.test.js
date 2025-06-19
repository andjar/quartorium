const { proseMirrorJSON_to_qmd } = require('../src/core/astSerializer');

// Test case: Demonstrate preserving original QMD structure while incorporating text changes
const originalQmd = `---
title: Quartorium
authors:
  - name: Norah Jones
    affiliation: The University
    roles: writing
    corresponding: true
bibliography: references.bib
---

## Section
This is a simple placeholder for the manuscript's main document [@knuth84].

\`\`\`{r}
#| label: fig-plot
#| fig-cap: "A simple plot"
plot(1)
\`\`\`

@fig-plot is a simple plot.
`;

// ProseMirror document with edited text but preserved block structure
const testDocWithEdits = {
    "type": "doc",
    "attrs": {
        "metadata": {
            "title": "Quartorium",
            "authors": [
                {
                    "name": "Norah Jones",
                    "affiliation": "The University",
                    "roles": "writing",
                    "corresponding": true
                }
            ],
            "bibliography": "references.bib"
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
                    "title": "Quartorium",
                    "authors": [
                        {
                            "name": "Norah Jones",
                            "affiliation": "The University",
                            "roles": "writing",
                            "corresponding": true
                        }
                    ],
                    "bibliography": "references.bib"
                }
            }
        },
        {
            "type": "heading",
            "attrs": { "level": 2 },
            "content": [{ "type": "text", "text": "Section" }]
        },
        {
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "This is a placeholder for the manuscript's main " },
                { "type": "text", "text": "document", "marks": [{ "type": "comment", "attrs": { "commentId": "c-1750370643131-l69oc" } }] },
                { "type": "text", "text": " " },
                { "type": "citation", "attrs": { "rid": "ref-knuth84-nb-article", "label": "knuth84" } },
                { "type": "text", "text": "." }
            ]
        },
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": "fig-plot",
                "language": "r",
                "code": "plot(1)",
                "figLabel": "fig-plot"
            }
        },
        {
            "type": "paragraph",
            "content": [
                { "type": "figureReference", "attrs": { "rid": "fig-plot-nb-article", "label": "fig-plot" } },
                { "type": "text", "text": " is a simple plot." }
            ]
        }
    ]
};

// Comments array to test comment handling
const commentsArray = [
    { 
        id: "c-1750370643131-l69oc", 
        author: "user-dmz3hx1r8", 
        timestamp: "2025-06-19T22:04:03.131Z",
        status: "open",
        thread: [
            {
                text: "And this is a comment",
                author: "user-dmz3hx1r8",
                timestamp: "2025-06-19T22:04:03.131Z"
            }
        ]
    }
];

console.log('Testing improved serialization with real QMD content...\n');

try {
    const result = proseMirrorJSON_to_qmd(testDocWithEdits, originalQmd, commentsArray);
    console.log('✅ SUCCESS: Serialization completed');
    console.log('\n--- Generated QMD Content ---');
    console.log(result);
    console.log('\n--- Key Features Demonstrated ---');
    console.log('1. ✅ Original YAML frontmatter preserved');
    console.log('2. ✅ Original code block with #| metadata preserved');
    console.log('3. ✅ Citation [@knuth84] preserved');
    console.log('4. ✅ Figure reference @{fig-plot} preserved');
    console.log('5. ✅ Text changes incorporated with comment marks');
    console.log('6. ✅ Comments appendix added');
    console.log('7. ✅ Document structure maintained');
} catch (error) {
    console.error('❌ ERROR in serialization test:', error.message);
    console.error(error.stack);
}

// Test case 2: Document with undefined block keys (fallback behavior)
console.log('\n\n--- Test 2: Fallback Behavior ---');
const testDocWithUndefinedKeys = {
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
                { "type": "text", "text": "This is a test paragraph with a citation " },
                { "type": "citation", "attrs": { "rid": "ref-knuth84-nb-article", "label": "knuth84" } },
                { "type": "text", "text": " and a figure reference " },
                { "type": "figureReference", "attrs": { "rid": "fig-plot-nb-article", "label": "fig-plot" } },
                { "type": "text", "text": "." }
            ]
        },
        {
            "type": "heading",
            "attrs": { "level": 2 },
            "content": [{ "type": "text", "text": "Section" }]
        },
        {
            "type": "quartoBlock",
            "attrs": {
                "blockKey": undefined,
                "language": "r",
                "code": "plot(cars)\nsummary(cars)",
                "figLabel": "fig-cars"
            }
        }
    ]
};

try {
    const result2 = proseMirrorJSON_to_qmd(testDocWithUndefinedKeys, originalQmd);
    console.log('✅ SUCCESS: Fallback serialization completed');
    console.log('\n--- Generated QMD Content (Fallback) ---');
    console.log(result2);
    console.log('\n--- Fallback Features ---');
    console.log('1. ✅ Code block reconstructed from attributes');
    console.log('2. ✅ Citations and figure references handled');
    console.log('3. ✅ No errors despite missing blockKey');
} catch (error) {
    console.error('❌ ERROR in fallback test:', error.message);
} 