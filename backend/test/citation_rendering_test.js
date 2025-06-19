// Test to verify citation rendering structure
const testCitationJSON = {
  type: 'doc',
  attrs: {},
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
        { type: 'text', text: ' and another one: ' },
        {
          type: 'citation',
          attrs: { 
            rid: 'ref-doe2020', 
            label: 'Doe et al. 2020',
            originalKey: 'doe2020'
          }
        },
        { type: 'text', text: '.' }
      ]
    }
  ]
};

console.log('Testing citation rendering structure...\n');

console.log('ProseMirror JSON with citations:');
console.log(JSON.stringify(testCitationJSON, null, 2));

console.log('\nExpected frontend rendering:');
console.log('This is a citation: (Knuth 1984) and another one: (Doe et al. 2020).');

console.log('\nCitation nodes found:');
testCitationJSON.content.forEach((node, index) => {
  if (node.type === 'paragraph') {
    console.log(`Paragraph ${index}:`);
    node.content.forEach((inline, inlineIndex) => {
      if (inline.type === 'citation') {
        console.log(`  Citation ${inlineIndex}: label="${inline.attrs.label}" -> should render as "(${inline.attrs.label})"`);
      }
    });
  }
});

console.log('\n✅ Test completed - citations should render with parentheses in the frontend'); 