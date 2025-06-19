const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { parseStringPromise } = require('xml2js');

/**
 * Executes `quarto render` to JATS format and reads the resulting XML.
 * @param {string} qmdFilepath - The absolute path to the source .qmd file.
 * @param {string} projectDir - The root directory of the cloned project.
 * @returns {Promise<{jatsXml: string, assetsDir: string}>} - The parsed JATS XML string and the path to the assets directory.
 */
async function renderToJATS(qmdFilepath, projectDir) {
  // 1. Create a temporary directory to work in.
  const tempRenderDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quartorium-render-'));
  
  try {
    // 2. Copy the entire project content to the temporary directory.
    await fs.cp(projectDir, tempRenderDir, { recursive: true });

    // 3. Define paths relative to the new temporary directory.
    const inputFilename = path.basename(qmdFilepath);
    const outputXmlFilename = `${path.parse(inputFilename).name}.xml`;
    // The output is placed in a subdirectory by default in this project setup.
    const outputXmlPath = path.join(tempRenderDir, '_manuscript', outputXmlFilename);

    // 4. Construct the Quarto command to render to JATS.
    const command = `quarto render "${inputFilename}" --to jats`;

    // 5. Execute the command from *inside the temporary directory*.
    await new Promise((resolve, reject) => {
      exec(command, { cwd: tempRenderDir }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Quarto render error: ${stderr}`);
          console.error(`Quarto stdout: ${stdout}`);
          return reject(new Error(`Quarto execution failed: ${stderr}`));
        }
        resolve(stdout);
      });
    });

    // 6. Read the XML file that Quarto created in the temp directory.
    const jatsXml = await fs.readFile(outputXmlPath, 'utf8');

    // 7. The assets are in a sub-directory relative to where the XML output was saved.
    const outputDir = path.dirname(outputXmlPath);
    const assetsDir = path.join(outputDir, `${path.parse(inputFilename).name}_files`);
    
    // 8. Copy the rendered assets back to the repository directory so they can be served
    const repoAssetsDir = path.join(projectDir, `${path.parse(inputFilename).name}_files`);
    try {
      await fs.cp(assetsDir, repoAssetsDir, { recursive: true });
    } catch (copyError) {
      // It's okay if this fails, not all documents have assets.
    }
    
    return { jatsXml, assetsDir: repoAssetsDir };

  } catch (e) {
    console.error("Failed during JATS rendering process.", e);
    throw new Error("Failed to process Quarto's JATS output.");
  } finally {
    // 9. Clean up the temporary directory after we're done.
    // await fs.rm(tempRenderDir, { recursive: true, force: true });
  }
}

const { JSDOM } = require('jsdom');

// ===================================================================
// JATS TRANSFORMATION LOGIC (REFACTORED WITH JSDOM)
// ===================================================================

// Helper to clean up text content from DOM nodes
const cleanText = (text) => text?.replace(/\s+/g, ' ').trim() || '';

/**
 * First pass: Scans the JATS document to build maps of all referenceable items.
 * @param {Document} document - The JSDOM document object.
 * @returns {object} A context object with maps for affiliations, refs, etc.
 */
function buildContext(document) {
    const context = {
        affiliations: {},
        references: {},
        notes: {},
        figures: {}
    };

    // Use querySelectorAll to find all elements with an ID attribute. This is much cleaner.
    document.querySelectorAll('[id]').forEach(el => {
        const id = el.id;
        switch (el.tagName.toLowerCase()) {
            case 'aff':
                const inst = el.querySelector('institution');
                context.affiliations[id] = cleanText(inst?.textContent) || cleanText(el.textContent);
                break;
            case 'corresp':
                context.notes[id] = cleanText(el.textContent) || 'Corresponding Author';
                break;
            case 'ref':
                context.references[id] = parseReference(el);
                break;
            case 'fig':
                const caption = el.querySelector('caption');
                context.figures[id] = { id, caption: cleanText(caption?.textContent) };
                break;
        }
    });

    return context;
}

/**
 * Parses a <ref> element into a structured object using DOM methods.
 * @param {Element} refElement - The <ref> DOM element.
 * @returns {object} Structured reference data.
 */
function parseReference(refElement) {
    const citation = refElement.querySelector('element-citation, mixed-citation');
    if (!citation) return { text: cleanText(refElement.textContent) };

    const authors = Array.from(citation.querySelectorAll('person-group[person-group-type="author"] > name'))
        .map(nameEl => ({
            surname: cleanText(nameEl.querySelector('surname')?.textContent),
            given: cleanText(nameEl.querySelector('given-names')?.textContent),
        }));

    const get = (selector) => cleanText(citation.querySelector(selector)?.textContent);

    return {
        id: refElement.id,
        type: citation.getAttribute('publication-type') || 'misc',
        authors,
        title: get('article-title'),
        source: get('source'),
        year: get('year'),
        volume: get('volume'),
        issue: get('issue'),
        fpage: get('fpage'),
        lpage: get('lpage'),
        doi: cleanText(citation.querySelector('pub-id[pub-id-type="doi"]')?.textContent),
        uri: get('uri'),
        text: cleanText(citation.textContent)
    };
}

/**
 * Parses the <front> or <front-stub> matter into a structured metadata object.
 * @param {Element} frontElement - The <front> or <front-stub> DOM element.
 * @param {object} context - The context object with resolved affiliations.
 * @returns {object} Structured metadata.
 */
function parseFront(frontElement, context) {
    const title = cleanText(frontElement.querySelector('article-title')?.textContent);
    
    const authors = Array.from(frontElement.querySelectorAll('contrib[contrib-type="author"]'))
        .map(contribEl => {
            const affXrefs = Array.from(contribEl.querySelectorAll('xref[ref-type="aff"]'));
            const correspXref = contribEl.querySelector('xref[ref-type="corresp"]');

            const given = cleanText(contribEl.querySelector('given-names')?.textContent);
            const surname = cleanText(contribEl.querySelector('surname')?.textContent);

            return {
                name: cleanText(contribEl.querySelector('string-name')?.textContent) || `${given} ${surname}`.trim(),
                role: cleanText(contribEl.querySelector('role')?.textContent),
                isCorresponding: !!correspXref,
                affiliations: affXrefs.map(xref => ({
                    id: xref.getAttribute('rid'),
                    text: context.affiliations[xref.getAttribute('rid')] || ''
                }))
            };
        });

    return { title, authors };
}

/**
 * UPDATED: Transforms JATS body nodes, now creating <figureReference> nodes.
 * @param {NodeList} nodes - A list of DOM nodes (element.childNodes).
 * @param {string} repoId - The repository ID for asset path rewriting.
 * @param {object} context - The context object for resolving xrefs.
 * @returns {Array} An array of ProseMirror nodes.
 */
function transformBodyNodes(nodes, repoId, context) {
    const pmNodes = [];

    nodes.forEach(node => {
        if (node.nodeType === 3) { // Text Node
            const text = node.textContent;
            if (text.trim()) {
                pmNodes.push({ type: 'text', text: text.replace(/\s+/g, ' ') });
            }
        }

        if (node.nodeType === 1) { // Element Node
            const el = node;
            const tagName = el.tagName.toLowerCase();

            switch (tagName) {
                case 'p':
                    pmNodes.push({
                        type: 'paragraph',
                        content: transformBodyNodes(el.childNodes, repoId, context)
                    });
                    break;
                case 'xref':
                    const refType = el.getAttribute('ref-type');
                    const rid = el.getAttribute('rid');
                    
                    if (refType === 'bibr' && context.references[rid]) {
                        pmNodes.push({
                            type: 'citation',
                            attrs: { rid: rid, label: cleanText(el.textContent) },
                        });
                    } else if (context.figures[rid]) { // NEW: Check if the rid points to a known figure
                        pmNodes.push({
                            type: 'figureReference', // Use our new node type
                            attrs: {
                                rid: rid,
                                label: cleanText(el.textContent)
                            }
                        });
                    } else {
                        // Fallback for other unhandled xrefs
                        pmNodes.push({ type: 'text', text: cleanText(el.textContent) });
                    }
                    break;
                case 'sec':
                    if (el.getAttribute('specific-use') === 'notebook-content') {
                        const codeEl = el.querySelector('code');
                        const figEl = el.querySelector('fig');
                        const code = codeEl ? codeEl.textContent : '';
                        const language = codeEl ? codeEl.getAttribute('language') : null;
                        
                        if (figEl) {
                            pmNodes.push(processFig(figEl, repoId, code, language));
                        } else if (code) {
                            pmNodes.push({
                                type: 'code_block',
                                attrs: { language: language },
                                content: [{ type: 'text', text: code.replace(/\n$/, '') }]
                            });
                        }
                    } else {
                        const titleEl = el.querySelector(':scope > title');
                        if (titleEl) {
                            pmNodes.push({
                                type: 'heading',
                                attrs: { level: 2 },
                                content: [{ type: 'text', text: cleanText(titleEl.textContent) }]
                            });
                            titleEl.remove();
                        }
                        pmNodes.push(...transformBodyNodes(el.childNodes, repoId, context));
                    }
                    break;
                case 'fig':
                    pmNodes.push(processFig(el, repoId, '', null));
                    break;
            }
        }
    });

    return pmNodes;
}

/**
 * @param {Element} figElement - The <fig> DOM element.
 * @param {string} repoId - The ID of the repository for asset rewriting.
 * @param {string} code - The source code associated with this figure.
 * @param {string|null} language - The language of the source code.
 * @returns {object} A ProseMirror quartoBlock node.
 */
function processFig(figElement, repoId, code, language) {
  const captionEl = figElement.querySelector('caption');
  let figLabel = '';
  let figCaption = '';

  if (captionEl) {
      // JATS Best Practice: Check for an explicit <label> element first.
      const labelEl = captionEl.querySelector('label');
      if (labelEl) {
          figLabel = cleanText(labelEl.textContent);
          // To get the rest of the caption, we can clone the caption, remove the label, and get the text.
          const captionClone = captionEl.cloneNode(true);
          captionClone.querySelector('label').remove();
          figCaption = cleanText(captionClone.textContent);
      } else {
          // Fallback for captions like <p>Figure 1: A simple plot</p>
          const pText = cleanText(captionEl.querySelector('p')?.textContent || captionEl.textContent);
          const labelRegex = /^(Figure|Table|Fig\.?)\s+[\w\d.-]+[:.]?\s*/i;
          const match = pText.match(labelRegex);

          if (match) {
              figLabel = cleanText(match[0]);
              figCaption = cleanText(pText.substring(match[0].length));
          } else {
              // If no recognizable label pattern, the whole thing is the caption.
              figCaption = pText;
          }
      }
  }

  const graphicEl = figElement.querySelector('graphic');
  const imageSrc = graphicEl?.getAttribute('xlink:href') || graphicEl?.getAttribute('href') || '';
  const rewrittenSrc = imageSrc ? `/api/assets/${repoId}/${imageSrc}` : '';
  // Use the full caption text for the alt attribute for accessibility.
  const altText = `${figLabel} ${figCaption}`.trim();
  const imageHtml = rewrittenSrc ? `<img src="${rewrittenSrc}" alt="${altText}" style="max-width: 100%; height: auto;" />` : '';

  return {
      type: 'quartoBlock',
      attrs: {
          htmlOutput: imageHtml,
          code: code,
          language: language,
          figId: figElement.id || '',
          figCaption: figCaption, // Just the caption text
          figLabel: figLabel,     // Just the label text
      }
  };
}

/**
 * Transforms a JATS XML string into a ProseMirror JSON document using JSDOM.
 * @param {string} jatsXml - The JATS XML content.
 * @param {string} repoId - The repository ID for asset path rewriting.
 * @returns {Promise<object>} The ProseMirror JSON document.
 */
async function jatsToProseMirrorJSON(jatsXml, repoId) {
    try {
        // 1. Parse the XML string into a DOM.
        // The contentType is crucial for parsing XML correctly, not as HTML.
        const dom = new JSDOM(jatsXml, { contentType: "application/xml" });
        const { document } = dom.window;

        // 2. Build the context map for all referenceable IDs
        const context = buildContext(document);

        // 3. Find the correct article content to parse (prefer sub-article)
        const subArticle = document.querySelector('sub-article');
        const articleToParse = subArticle || document.querySelector('article');
        if (!articleToParse) throw new Error("Could not find <article> or <sub-article> element.");

        // 4. Parse Metadata from <front> or <front-stub>
        const frontEl = articleToParse.querySelector('front, front-stub');
        const metadata = frontEl ? parseFront(frontEl, context) : {};

        // 5. Parse Body Content
        const bodyEl = articleToParse.querySelector('body');
        if (!bodyEl) throw new Error("Could not find <body> in the selected article content.");
        const content = transformBodyNodes(bodyEl.childNodes, repoId, context);

        // 6. Assemble the final ProseMirror document
        return {
            type: 'doc',
            attrs: {
                metadata: metadata,
                bibliography: context.references
            },
            content: content,
        };
    } catch (error) {
        console.error("Error transforming JATS XML to ProseMirror JSON:", error);
        throw new Error("Failed to parse or transform JATS XML with JSDOM.");
    }
}

// Don't forget to export your main functions
module.exports = { renderToJATS, jatsToProseMirrorJSON };