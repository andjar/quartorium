// This is the ProseMirror JSON object that our frontend editor will consume.
// It is the "target output" of our backend's AST transformation process.
export const dummyProseMirrorDoc = {
    type: 'doc',
    attrs: {
      // The YAML frontmatter from the AST's 'meta' block
      yaml: {
        title: 'My Dummy Paper',
        author: 'A. Quillarto User',
        format: 'html',
      },
    },
    content: [
      // Node 1: A heading
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Introduction' }],
      },
      // Node 2: A paragraph
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is a paragraph of text.' },
        ],
      },
      // Node 3: Our custom Quarto Block
      {
        type: 'quartoBlock',
        attrs: {
          // The original source code from the Pandoc AST
          code: 'plot(cars)\nsummary(cars)',
          // The original chunk options
          chunkOptions: "r, label='fig-cars', echo=false",
          // The combined HTML generated from the 'outputs' array in the AST.
          // Note how we've combined the image and the verbatim text output.
          // The image `src` will eventually point to our static asset endpoint.
          htmlOutput: `
            <div class="quarto-figure quarto-figure-center">
              <img 
                src="/api/assets/my-paper_files/figure-html/fig-cars-1.png" 
                alt="A plot of the cars dataset" 
                style="max-width: 100%;"
              />
            </div>
            <pre class="sourceCode"><code>##      speed           dist       
  ##  Min.   : 4.0   Min.   :  2.00  
  ##  1st Qu.:12.0   1st Qu.: 26.00  
  ##  Median :15.0   Median : 36.00  
  ##  Mean   :15.4   Mean   : 42.98  
  ##  3rd Qu.:19.0   3rd Qu.: 56.00  
  ##  Max.   :25.0   Max.   :120.00</code></pre>
          `,
        },
      },
      // Node 4: Another paragraph
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'As the plot clearly shows.' },
        ],
      },
    ],
  };