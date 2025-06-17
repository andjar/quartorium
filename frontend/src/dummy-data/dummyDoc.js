export const dummyProseMirrorDoc = {
    type: 'doc',
    attrs: {
      yaml: {
        title: 'My Dummy Paper',
        author: 'A. Quillarto User',
        format: 'html',
      },
    },
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Introduction' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'This is a paragraph of text introducing the main topic of our paper. We will now show a very important plot.',
          },
        ],
      },
      {
        type: 'quartoBlock',
        attrs: {
          code: 'plot(cars)',
          chunkOptions: "r, label='fig-cars', echo=FALSE",
          // This is the pre-rendered HTML output for the plot.
          // For the dummy, we'll use a placeholder image from a service like placehold.co.
          htmlOutput: `
            <div style="text-align: center;">
              <img 
                src="https://placehold.co/600x400/EFEFEF/AAAAAA&text=A+Beautiful+Plot" 
                alt="A placeholder plot" 
                style="max-width: 100%;"
              />
              <p><em>Figure 1: A plot showing the relationship between two variables.</em></p>
            </div>
          `,
        },
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'As the plot clearly shows, there is a strong correlation. This sets the stage for our next section.',
          },
        ],
      },
    ],
  };