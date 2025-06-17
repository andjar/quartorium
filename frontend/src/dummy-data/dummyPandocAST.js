// This is a simplified representation of the JSON output from `quarto render --to json`.
// It captures the key structures we need to handle.
export const dummyPandocAST = {
  "pandoc-api-version": [1, 22, 2, 1],
  "meta": {
    "title": { "t": "Str", "c": "My Dummy Paper" },
    "author": { "t": "Str", "c": "A. Quillarto User" },
    "format": { "t": "Str", "c": "html" }
  },
  "blocks": [
    // Block 1: A top-level heading
    {
      "t": "Header",
      "c": [1, ["introduction", [], []], [{ "t": "Str", "c": "Introduction" }]]
    },
    // Block 2: A paragraph of text
    {
      "t": "Para",
      "c": [
        { "t": "Str", "c": "This" }, { "t": "Space" },
        { "t": "Str", "c": "is" }, { "t": "Space" },
        { "t": "Str", "c": "a" }, { "t": "Space" },
        { "t": "Str", "c": "paragraph" }, { "t": "Space" },
        { "t": "Str", "c": "of" }, { "t": "Space" },
        { "t": "Str", "c": "text." }
      ]
    },
    // Block 3: A Quarto Code Block with its output
    {
      "t": "CodeBlock",
      "c": [
        // Element 1: Attributes [id, classes, key-value pairs]
        ["fig-cars", ["r"], [["label", "fig-cars"], ["echo", "false"]]],
        // Element 2: The source code
        "plot(cars)\nsummary(cars)",
        // Element 3: The rendered outputs (added by Quarto)
        [
          // Output 1: An image
          {
            "t": "Image",
            "c": [
              ["fig-cars", ["quarto-figure", "figure-center"], []],
              [],
              ["my-paper_files/figure-html/fig-cars-1.png", "fig-"]
            ]
          },
          // Output 2: A verbatim text block (from summary(cars))
          {
            "t": "CodeBlock",
            "c": [
              ["", ["sourceCode"], []],
              "##      speed           dist       \n##  Min.   : 4.0   Min.   :  2.00  \n##  1st Qu.:12.0   1st Qu.: 26.00  \n##  Median :15.0   Median : 36.00  \n##  Mean   :15.4   Mean   : 42.98  \n##  3rd Qu.:19.0   3rd Qu.: 56.00  \n##  Max.   :25.0   Max.   :120.00"
            ]
          }
        ]
      ]
    },
    // Block 4: Another paragraph
    {
      "t": "Para",
      "c": [
        { "t": "Str", "c": "As" }, { "t": "Space" },
        { "t": "Str", "c": "the" }, { "t": "Space" },
        { "t": "Str", "c": "plot" }, { "t": "Space" },
        { "t": "Str", "c": "clearly" }, { "t": "Space" },
        { "t": "Str", "c": "shows." }
      ]
    }
  ]
};