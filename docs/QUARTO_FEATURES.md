# Supported Quarto Features

This document outlines the current state of Quarto (`.qmd`) support in Quartorium. If your document does not render correctly in the WYSIWYG editor, please refer to the supported features and troubleshooting steps below.

## ✅ Currently Supported

- **YAML Frontmatter**: Standard metadata such as `title`, `author`, `date`, and `format`.
- **GFM Markdown**: Headings, paragraphs, lists (ordered/unordered), bold, italic, blockquotes, and horizontal rules.
- **Links & Images**: Relative and absolute links. Local images are automatically cached and served via the asset API.
- **Code Blocks**: Fenced code blocks. Pre-rendered outputs (figures, HTML tables, console output) are supported via the `quartoBlock` extension.
- **LaTeX Math**: Inline (`$...$`) and display (`$$...$$`) math equations rendered via KaTeX.
- **Collaborative Comments**: Add, reply to, resolve, and reopen comments using the `{.comment ref="..."}` syntax and the hidden appendix format.
- **Git Integration**: Real-time synchronization, branching, and commit history via `isomorphic-git`.
- **Live Collaboration**: Shareable links, concurrent editing, and cross-branch comment reactions.

## 🚧 Under Development / Limited Support

- **Cross-References & Citations**: Bibliography management (`references.bib`) and in-text citations (`@author2023`) are not yet fully integrated.
- **Complex Tables**: Basic GFM tables work, but advanced table layouts, pivot tables, and `kableExtra` styling may not render correctly.
- **Callouts & Advisories**: Block-level callouts (`:::{.callout-note}`) are partially supported but may lose styling.
- **Sidebars & Margin Content**: Content placed in sidebars or margins is not currently preserved in the editor.
- **Full Pandoc AST Parsing**: Highly customized Quarto layouts, custom divs, footnotes, and definition lists may cause rendering issues.
- **Interactive Widgets**: Shiny apps, Plotly, and other JS-based interactive elements are not supported in the editor view.
- **In-Browser Code Execution**: Code chunks are treated as static outputs. Live execution requires external R/Python kernels (planned for future versions).

## 🛠️ Troubleshooting: "Nothing appears in the WYSIWYG editor"

If your `.qmd` file fails to load or appears blank:

1. **Check Syntax Compatibility**: Ensure your document relies primarily on standard Markdown/GFM. Avoid heavy Pandoc-specific extensions until full AST support is implemented.
2. **Simplify Code Chunks**: Replace complex chunk options with simple fenced code blocks if you encounter parsing errors.
3. **Verify Asset Paths**: Ensure image and figure paths are relative to the `.qmd` file. Absolute paths or external URLs may not be cached correctly.
4. **Inspect Console Errors**: Open your browser's Developer Tools (F12) and check the Console/Network tabs. Look for `remark` parsing errors or 404s on `/api/assets` routes.
5. **Test with Minimal File**: Copy only the text content of your document into a new `.qmd` file. If it renders, incrementally add back formatting/chunks to isolate the problematic element.

## 📝 Contributing & Future Roadmap

We are actively expanding Quartorium's compatibility with the Quarto ecosystem. If you encounter a specific feature that breaks rendering, please open an issue on GitHub with a minimal reproducible `.qmd` example. Your feedback helps us prioritize AST parsing improvements and feature parity.
