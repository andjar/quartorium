const { proseMirrorJSON_to_qmd } = require('../src/core/astSerializer');

// Test ProseMirror JSON with display text citations and figure references
const testProseMirrorJSON = {
  type: 'doc',
  attrs: {
    metadata: { title: 'Test Document' },
    bibliography: {}
  },
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This is a citation: ' },
        {
          type: 'citation',
          attrs: { 
            rid: 'ref-knuth84', 
            label: 'Knuth 1984',
            originalKey: 'knuth84'
          }
        },
        { type: 'text', text: ' and a figure reference: ' },
        {
          type: 'figureReference',
          attrs: { 
            rid: 'fig-plot', 
            label: 'Figure 1',
            originalKey: 'fig-plot'
          }
        },
        { type: 'text', text: '.' }
      ]
    }
  ]
};

console.log('Testing serialization of ProseMirror JSON with display text...\n');

try {
  const qmdOutput = proseMirrorJSON_to_qmd(testProseMirrorJSON, '', []);
  
  console.log('Input ProseMirror JSON:');
  console.log(JSON.stringify(testProseMirrorJSON, null, 2));
  console.log('\nSerialized QMD output:');
  console.log(qmdOutput);
  
  // Check if the output contains the correct citation and figure reference syntax
  const hasCitation = qmdOutput.includes('[@knuth84]');
  const hasFigureRef = qmdOutput.includes('@fig-plot');
  
  console.log('\nValidation:');
  console.log(`- Contains citation [@knuth84]: ${hasCitation}`);
  console.log(`- Contains figure reference @fig-plot: ${hasFigureRef}`);
  
  if (hasCitation && hasFigureRef) {
    console.log('✅ Serialization test PASSED - citations and figure references serialize correctly');
  } else {
    console.log('❌ Serialization test FAILED - missing expected citation or figure reference syntax');
  }
  
} catch (error) {
  console.error('❌ Serialization test FAILED with error:', error);
} 