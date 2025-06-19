const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const CACHE_DIR = path.join(__dirname, '../../cache');
const { parseStringPromise } = require('xml2js');

/**
 * Executes `quarto render` to JATS format and reads the resulting XML.
 * @param {string} qmdFilepath - The absolute path to the source .qmd file.
 * @param {string} projectDir - The root directory of the cloned project.
 * @param {string} repoId - The repository ID.
 * @param {string} commitHash - The commit hash.
 * @returns {Promise<{jatsXml: string, assetsCachePath: string | null}>} - The parsed JATS XML string and the path to the cached assets directory.
 */
async function renderToJATS(qmdFilepath, projectDir, repoId, commitHash) {
  const docName = path.parse(qmdFilepath).name;
  const outputXmlFilename = `${docName}.xml`;
  
  // Define a single cache directory for this specific render
  const renderCacheDir = path.join(CACHE_DIR, 'renders', String(repoId), commitHash);
  const cachedXmlPath = path.join(renderCacheDir, outputXmlFilename);

  // 1. Check if a cached version already exists.
  try {
    await fs.access(cachedXmlPath);
    console.log(`Cache hit for ${repoId}/${commitHash}. Reading from cache at ${cachedXmlPath}.`);
    const jatsXml = await fs.readFile(cachedXmlPath, 'utf8');
    // Assets are in the same directory, so we pass the directory path.
    return { jatsXml, assetsCachePath: renderCacheDir };
  } catch (error) {
    // Cache miss, proceed with rendering.
    console.log(`Cache miss for ${repoId}/${commitHash}. Rendering document.`);
  }

  // If we've reached here, it's a cache miss.
  const tempRenderDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quartorium-render-'));

  try {
    // 2. Copy the project into the temporary directory to keep the original clean.
    await fs.cp(projectDir, tempRenderDir, { recursive: true });

    // 3. Construct the Quarto command WITHOUT specifying output.
    const inputFilename = path.basename(qmdFilepath);
    const command = `quarto render "${inputFilename}" --to jats`;

    // 4. Execute the command from *inside the temporary directory*.
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

    // 5. Locate the output XML file. Quarto might place it in a subdirectory.
    const findXmlOutput = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Avoid recursing into the assets directory, which can be large.
                if (!entry.name.endsWith('_files')) {
                    const result = await findXmlOutput(fullPath);
                    if (result) return result;
                }
            } else if (entry.name === outputXmlFilename) {
                return fullPath;
            }
        }
        return null;
    };

    const renderedXmlPath = await findXmlOutput(tempRenderDir);
    if (!renderedXmlPath) {
        throw new Error(`Could not find the rendered XML file '${outputXmlFilename}' in the output.`);
    }

    const outputDir = path.dirname(renderedXmlPath);
    const renderedAssetsPath = path.join(outputDir, `${docName}_files`);

    // 6. Move the located files to the permanent cache.
    await fs.mkdir(renderCacheDir, { recursive: true });
    
    // Move XML file
    await fs.rename(renderedXmlPath, cachedXmlPath);
    
    // Move assets directory if it exists
    try {
      await fs.access(renderedAssetsPath);
      await fs.rename(renderedAssetsPath, path.join(renderCacheDir, `${docName}_files`));
    } catch (e) {
      console.log(`No assets directory found at ${renderedAssetsPath} to move.`);
    }

    // 7. Read the XML file that is now in the cache.
    const jatsXml = await fs.readFile(cachedXmlPath, 'utf8');
    
    return { jatsXml, assetsCachePath: renderCacheDir };

  } catch (e) {
    console.error("Failed during JATS rendering process.", e);
    // Attempt to clean up the partially created cache directory on failure.
    await fs.rm(renderCacheDir, { recursive: true, force: true }).catch(err => 
      console.error(`Failed to clean up cache directory ${renderCacheDir}`, err)
    );
    throw new Error("Failed to process Quarto's JATS output.");
  } finally {
    // 8. Clean up the temporary directory.
    await fs.rm(tempRenderDir, { recursive: true, force: true });
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
 * @param {string} commitHash - The commit hash.
 * @param {string} docFilepath - The path to the original document file.
 * @returns {Array} An array of ProseMirror nodes.
 */
function transformBodyNodes(nodes, repoId, context, commitHash, docFilepath) {
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
                        content: transformBodyNodes(el.childNodes, repoId, context, commitHash, docFilepath)
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
                            pmNodes.push(processFig(figEl, repoId, code, language, commitHash, docFilepath));
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
                        pmNodes.push(...transformBodyNodes(el.childNodes, repoId, context, commitHash, docFilepath));
                    }
                    break;
                case 'fig':
                    pmNodes.push(processFig(el, repoId, '', null, commitHash, docFilepath));
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
 * @param {string} commitHash - The commit hash.
 * @param {string} docFilepath - The path to the original document file.
 * @returns {object} A ProseMirror quartoBlock node.
 */
function processFig(figElement, repoId, code, language, commitHash, docFilepath) {
  const originalDocNameFiles = path.parse(docFilepath).name + '_files';
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
  // The imageSrc from JATS is already relative to the output directory root,
  // so it includes the necessary '..._files' directory.
  const rewrittenSrc = imageSrc ? `/api/assets/${repoId}/${commitHash}/${imageSrc}` : '';
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
 * @param {string} commitHash - The commit hash.
 * @param {string} docFilepath - The path to the original document file.
 * @returns {Promise<object>} The ProseMirror JSON document.
 */
async function jatsToProseMirrorJSON(jatsXml, repoId, commitHash, docFilepath) {
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
        const content = transformBodyNodes(bodyEl.childNodes, repoId, context, commitHash, docFilepath);
        
        // Create and prepend a metadata block if metadata is available
        const finalContent = [];
        if (metadata && Object.keys(metadata).length > 0 && (metadata.title || metadata.authors?.length > 0)) {
            finalContent.push({
                type: 'quartoBlock',
                attrs: {
                    metadata: metadata,
                    // Set other attributes to default/null values
                    htmlOutput: '',
                    code: '',
                    language: 'metadata',
                    figId: '',
                    figCaption: '',
                    figLabel: ''
                }
            });
        }
        finalContent.push(...content);

        // 6. Assemble the final ProseMirror document
        return {
            type: 'doc',
            attrs: {
                metadata: metadata,
                bibliography: context.references
            },
            content: finalContent,
        };
    } catch (error) {
        console.error("Error transforming JATS XML to ProseMirror JSON:", error);
        throw new Error("Failed to parse or transform JATS XML with JSDOM.");
    }
}

// Don't forget to export your main functions
module.exports = { renderToJATS, jatsToProseMirrorJSON };