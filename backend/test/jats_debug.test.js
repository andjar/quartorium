const { renderToJATS, jatsToProseMirrorJSON } = require('../src/core/astParser');
const { parseQmd } = require('../src/core/qmdBlockParser');
const path = require('path');

// Test the JATS parsing with a simple QMD file
async function debugJatsParsing() {
    console.log('=== JATS Debug Test ===\n');
    
    // Create a simple test QMD file
    const testQmdContent = `---
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

    const testQmdPath = path.join(__dirname, 'test_document.qmd');
    const testProjectDir = path.join(__dirname, 'test_project');
    
    try {
        // Create test project directory
        const fs = require('fs/promises');
        await fs.mkdir(testProjectDir, { recursive: true });
        await fs.writeFile(testQmdPath, testQmdContent);
        
        console.log('1. Testing QMD parsing...');
        const { blockMap, blockOrder } = parseQmd(testQmdContent);
        console.log('BlockMap keys:', Array.from(blockMap.keys()));
        console.log('BlockOrder:', blockOrder);
        
        console.log('\n2. Testing JATS rendering...');
        const { jatsXml } = await renderToJATS(testQmdPath, testProjectDir, 'test-repo', 'test-commit');
        
        console.log('\n3. JATS XML structure:');
        console.log('First 1000 characters:');
        console.log(jatsXml.substring(0, 1000));
        
        console.log('\n4. Testing JATS to ProseMirror conversion...');
        const pmDoc = await jatsToProseMirrorJSON(jatsXml, blockMap, 'test-repo', 'test-commit', testQmdPath);
        
        console.log('\n5. ProseMirror document structure:');
        console.log('Document attrs:', JSON.stringify(pmDoc.attrs, null, 2));
        console.log('Content nodes count:', pmDoc.content?.length || 0);
        
        pmDoc.content?.forEach((node, index) => {
            console.log(`Node ${index}:`, node.type, node.attrs);
            if (node.content) {
                console.log(`  Content:`, node.content.length, 'items');
            }
        });
        
        // Clean up
        await fs.rm(testProjectDir, { recursive: true, force: true });
        await fs.unlink(testQmdPath).catch(() => {});
        
    } catch (error) {
        console.error('Error in JATS debug test:', error);
        console.error(error.stack);
    }
}

debugJatsParsing(); 