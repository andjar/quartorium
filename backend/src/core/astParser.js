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
 * Enhanced to better handle Quarto's JATS output format.
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

    console.log('Building context from JATS document...');

    // Use querySelectorAll to find all elements with an ID attribute. This is much cleaner.
    const elementsWithId = document.querySelectorAll('[id]');
    console.log(`Found ${elementsWithId.length} elements with IDs`);

    elementsWithId.forEach(el => {
        const id = el.id;
        const tagName = el.tagName.toLowerCase();
        
        console.log(`Processing element: ${tagName} with id: ${id}`);
        
        switch (tagName) {
            case 'aff':
                const inst = el.querySelector('institution');
                context.affiliations[id] = cleanText(inst?.textContent) || cleanText(el.textContent);
                console.log(`Added affiliation: ${id} -> ${context.affiliations[id]}`);
                break;
            case 'corresp':
                context.notes[id] = cleanText(el.textContent) || 'Corresponding Author';
                console.log(`Added correspondence note: ${id} -> ${context.notes[id]}`);
                break;
            case 'ref':
                context.references[id] = parseReference(el);
                console.log(`Added reference: ${id} -> ${JSON.stringify(context.references[id])}`);
                break;
            case 'fig':
                const caption = el.querySelector('caption');
                context.figures[id] = { 
                    id, 
                    caption: cleanText(caption?.textContent),
                    element: el // Store the element for later processing
                };
                console.log(`Added figure: ${id} -> ${context.figures[id].caption}`);
                break;
            default:
                console.log(`Unhandled element type: ${tagName} with id: ${id}`);
                break;
        }
    });

    // Also look for references in the back matter
    const backMatter = document.querySelector('back');
    if (backMatter) {
        console.log('Found back matter, scanning for references...');
        const refList = backMatter.querySelector('ref-list');
        if (refList) {
            const refs = refList.querySelectorAll('ref');
            console.log(`Found ${refs.length} references in back matter`);
            refs.forEach(ref => {
                const id = ref.id;
                if (id && !context.references[id]) {
                    context.references[id] = parseReference(ref);
                    console.log(`Added back matter reference: ${id} -> ${JSON.stringify(context.references[id])}`);
                }
            });
        }
    }

    console.log(`Context built: ${Object.keys(context.affiliations).length} affiliations, ${Object.keys(context.references).length} references, ${Object.keys(context.figures).length} figures`);
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
 * Processes a figure element to extract rich rendering attributes.
 * @param {Element} figEl - The figure DOM element.
 * @param {string} repoId - The repository ID.
 * @param {string} codeContent - The code content if this is a code block.
 * @param {string} language - The programming language.
 * @param {string} commitHash - The commit hash.
 * @param {string} docFilepath - The path to the original document file.
 * @returns {object} Object with type and attrs containing the rich rendering attributes.
 */
function processFig(figEl, repoId, codeContent, language, commitHash, docFilepath) {
    const figId = figEl.id || '';
    const captionEl = figEl.querySelector('caption');
    const figCaption = cleanText(captionEl?.textContent) || '';
    
    // Extract figure label from caption or ID
    const figLabel = figId || '';
    
    // Try to extract the image HTML from the figure element
    let htmlOutput = '';
    
    // Check for a table first
    const tableWrapEl = figEl.querySelector('table-wrap');
    if (tableWrapEl) {
        console.log('Found table-wrap element, using its content.');
        htmlOutput = tableWrapEl.innerHTML; // This will contain the <table>...</table>
    }

    // Debug: Log the figure element structure
    console.log('Processing figure element:', figEl.outerHTML);
    
    // Try multiple ways to find image references
    const graphicEl = figEl.querySelector('graphic');
    const mediaEl = figEl.querySelector('media');
    const inlineGraphicEl = figEl.querySelector('inline-graphic');
    
    // Try graphic element first
    if (!htmlOutput && graphicEl) {
        console.log('Found graphic element:', graphicEl.outerHTML);
        const href = graphicEl.getAttribute('xlink:href') || graphicEl.getAttribute('href');
        if (href) {
            console.log('Found image href:', href);
            // Construct the asset URL using the assets route
            const assetUrl = `/api/assets/${repoId}/${commitHash}/${href}`;
            htmlOutput = `<img src="${assetUrl}" alt="${figCaption}" style="max-width: 100%; height: auto;" />`;
            console.log('Generated HTML output:', htmlOutput);
        }
    }
    
    // Try media element if no graphic found
    if (!htmlOutput && mediaEl) {
        console.log('Found media element:', mediaEl.outerHTML);
        const href = mediaEl.getAttribute('xlink:href') || mediaEl.getAttribute('href');
        if (href) {
            console.log('Found media href:', href);
            const assetUrl = `/api/assets/${repoId}/${commitHash}/${href}`;
            htmlOutput = `<img src="${assetUrl}" alt="${figCaption}" style="max-width: 100%; height: auto;" />`;
            console.log('Generated HTML output from media:', htmlOutput);
        }
    }
    
    // Try inline-graphic element if no other image found
    if (!htmlOutput && inlineGraphicEl) {
        console.log('Found inline-graphic element:', inlineGraphicEl.outerHTML);
        const href = inlineGraphicEl.getAttribute('xlink:href') || inlineGraphicEl.getAttribute('href');
        if (href) {
            console.log('Found inline-graphic href:', href);
            const assetUrl = `/api/assets/${repoId}/${commitHash}/${href}`;
            htmlOutput = `<img src="${assetUrl}" alt="${figCaption}" style="max-width: 100%; height: auto;" />`;
            console.log('Generated HTML output from inline-graphic:', htmlOutput);
        }
    }
    
    // If no graphic element found, try to extract any other HTML content
    if (!htmlOutput) {
        // Look for any other content that might be in the figure
        const contentElements = figEl.querySelectorAll('*:not(caption)');
        if (contentElements.length > 0) {
            console.log('No graphic element found, but found other content elements:', contentElements.length);
            // Convert the content to HTML string, but we'll need to handle this carefully
            // For now, let's just extract text content as a fallback
            htmlOutput = `<div>${cleanText(figEl.textContent)}</div>`;
        }
    }
    
    return {
        type: 'quartoBlock',
        attrs: {
            figId: figId,
            figCaption: figCaption,
            figLabel: figLabel,
            htmlOutput: htmlOutput,
            code: codeContent || '',
            language: language || 'text',
            metadata: null
        }
    };
}

/**
 * MODIFIED: Transforms JATS body nodes.
 * It now accepts blockMap to add a 'blockKey'.
 * Enhanced to handle more JATS formats from Quarto.
 */
function transformBodyNodes(nodes, blockMap, repoId, context, commitHash, docFilepath, level = 1) {
    const pmNodes = [];

    nodes.forEach(node => {
        if (node.nodeType === 3) { // Text Node
            const text = node.textContent;
            if (text.trim()) {
                // Clean up extra parentheses and brackets that JATS might add around citations
                let cleanedText = text.replace(/\s+/g, ' ');
                
                // Remove extra parentheses around citations: (( -> empty, )) -> empty
                cleanedText = cleanedText.replace(/\(+/g, '').replace(/\)+/g, '');
                
                // Remove extra brackets around citations: [[ -> [, ]] -> ]
                cleanedText = cleanedText.replace(/\[+/g, '[').replace(/\]+/g, ']');
                
                if (cleanedText.trim()) {
                    pmNodes.push({ type: 'text', text: cleanedText });
                }
            }
        }

        if (node.nodeType === 1) { // Element Node
            const el = node;
            const tagName = el.tagName.toLowerCase();

            switch (tagName) {
                case 'p': {
                    // Check if this paragraph is just a wrapper for a block element like a formula
                    const children = Array.from(el.childNodes);
                    const significantChildren = children.filter(c => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim().length > 0));

                    if (significantChildren.length === 1 && significantChildren[0].tagName?.toLowerCase() === 'styled-content') {
                        // This is a wrapper <p> for an equation. Process the styled-content directly as a block.
                        pmNodes.push(...transformBodyNodes(significantChildren, blockMap, repoId, context, commitHash, docFilepath, level));
                    } else {
                        // It's a normal paragraph
                        pmNodes.push({
                            type: 'paragraph',
                            content: transformBodyNodes(el.childNodes, blockMap, repoId, context, commitHash, docFilepath, level)
                        });
                    }
                    break;
                }
                case 'xref':
                    const refType = el.getAttribute('ref-type');
                    const rid = el.getAttribute('rid');
                    const textContent = cleanText(el.textContent);
                    const outerHTML = el.outerHTML;
                    
                    console.log(`Processing xref: ref-type="${refType}", rid="${rid}", textContent="${textContent}"`);
                    console.log(`XRef outerHTML: ${outerHTML}`);
                    
                    if (refType === 'bibr') {
                        console.log(`Found bibliography reference: ${rid}`);
                        // For citations, use the display text but keep the original key for reference
                        let citationKey = textContent;
                        
                        // Remove any extra parentheses or brackets that JATS might have added, and trailing punctuation
                        citationKey = citationKey.replace(/^\(+\[?/, '').replace(/[?\]\)]+$/, '');
                        
                        console.log(`Cleaned citation key: "${citationKey}" from "${textContent}"`);
                        
                        // Extract the original citation key from the rid for internal reference
                        const extractedKey = rid.replace(/^ref-/, '').replace(/-nb-article$/, '');
                        console.log(`Extracted key from rid: ${extractedKey}`);
                        
                        // Use the display text for the label, but store the original key in attrs
                        console.log(`Using display text for citation: ${citationKey}`);
                        pmNodes.push({
                            type: 'citation',
                            attrs: { 
                                rid: rid, 
                                label: citationKey,  // Display text
                                originalKey: extractedKey  // Original key for serialization
                            },
                        });
                    } else if (refType === 'fig') {
                        console.log(`Found figure reference: ${rid}`);
                        // For figure references, use the display text but keep the original key for reference
                        let figLabel = textContent;
                        
                        // Remove any extra formatting that JATS might have added
                        figLabel = figLabel.replace(/^@?\{?/, '').replace(/\}?$/, '');
                        
                        console.log(`Cleaned figure label: "${figLabel}" from "${textContent}"`);
                        
                        // Extract the original figure key from the rid for internal reference
                        const extractedKey = rid.replace(/-nb-article$/, '');
                        console.log(`Extracted figure key from rid: ${extractedKey}`);
                        
                        // Use the display text for the label, but store the original key in attrs
                        console.log(`Using display text for figure reference: ${figLabel}`);
                        pmNodes.push({
                            type: 'figureReference',
                            attrs: { 
                                rid: rid, 
                                label: figLabel,  // Display text
                                originalKey: extractedKey  // Original key for serialization
                            },
                        });
                    } else if (rid && rid.startsWith('tbl-')) {
                        console.log(`Found table reference: ${rid}`);
                        const tableLabel = textContent.replace(/^@?\{?/, '').replace(/\}?$/, '');
                        const extractedKey = rid.replace(/-nb-article$/, '');
                        pmNodes.push({
                            type: 'tableReference',
                            attrs: { 
                                rid: rid, 
                                label: tableLabel,
                                originalKey: extractedKey
                            },
                        });
                    } else if (rid && rid.startsWith('eq-')) {
                        console.log(`Found equation reference: ${rid}`);
                        const eqLabel = textContent.replace(/^@?\{?/, '').replace(/\}?$/, '');
                        const extractedKey = rid.replace(/-nb-article$/, '');
                        pmNodes.push({
                            type: 'equationReference',
                            attrs: { 
                                rid: rid, 
                                label: eqLabel,
                                originalKey: extractedKey
                            },
                        });
                    } else if ((refType === 'null' || refType === null || !refType) && rid && rid.startsWith('fig-')) {
                        // Handle figure references that don't have a proper ref-type
                        console.log(`Found figure reference with null/undefined ref-type: ${rid}`);
                        const extractedKey = rid.replace(/-nb-article$/, '');
                        console.log(`Using extracted figure key: ${extractedKey}`);
                        pmNodes.push({
                            type: 'figureReference',
                            attrs: { 
                                rid: rid, 
                                label: textContent,  // Display text
                                originalKey: extractedKey  // Original key for serialization
                            },
                        });
                    } else {
                        // Try to handle other reference types
                        console.log(`Unhandled xref type: ${refType}, rid: ${rid}`);
                        console.log(`refType === 'null': ${refType === 'null'}, rid.startsWith('fig-'): ${rid && rid.startsWith('fig-')}`);
                        
                        if (rid && (rid.startsWith('ref-') || rid.startsWith('fig-'))) {
                            // Try to extract the key from the rid
                            const key = rid.replace(/^ref-/, '').replace(/^fig-/, '').replace(/-nb-article$/, '');
                            if (rid.startsWith('ref-')) {
                                pmNodes.push({
                                    type: 'citation',
                                    attrs: { rid: rid, label: key },
                                });
                            } else if (rid.startsWith('fig-')) {
                                // For figure references, try to get the proper label
                                let label = textContent;
                                // If the text content is empty or generic, try the alt attribute
                                if (!label || label === 'plot' || label === 'fig') {
                                    const alt = el.getAttribute('alt');
                                    if (alt) {
                                        label = alt;
                                    } else {
                                        // Fallback to the extracted key
                                        label = key;
                                    }
                                }
                                console.log(`Figure reference label resolved to: ${label}`);
                                pmNodes.push({
                                    type: 'figureReference',
                                    attrs: { rid: rid, label: label },
                                });
                            }
                        } else {
                            // Fallback for other unhandled xrefs
                            pmNodes.push({ type: 'text', text: textContent });
                        }
                    }
                    break;
                case 'sec':
                    if (el.getAttribute('specific-use') === 'notebook-content') {
                        console.log('Found notebook-content section');
                        const codeEl = el.querySelector('code');
                        const figEl = el.querySelector('fig');
                        const code = codeEl ? codeEl.textContent : '';
                        const language = codeEl ? codeEl.getAttribute('language') : null;
                        
                        console.log(`Code element: ${codeEl ? 'found' : 'not found'}, language: ${language}`);
                        console.log(`Figure element: ${figEl ? 'found' : 'not found'}`);
                        
                        if (figEl) {
                            // 1. Get the perfectly constructed block from your original function
                            const pmBlock = processFig(figEl, repoId, code, language, commitHash, docFilepath);
                            
                            // 2. ENHANCE it with the blockKey
                            const blockKey = figEl.id; // The JATS fig id matches the QMD label
                            console.log(`Looking for blockKey: ${blockKey} in blockMap`);
                            if (blockMap.has(blockKey)) {
                                pmBlock.attrs.blockKey = blockKey;
                                console.log(`Added blockKey: ${blockKey}`);
                            } else {
                                console.log(`BlockKey not found: ${blockKey}`);
                                // Try to extract the key from the ID
                                const extractedKey = blockKey.replace(/-nb-article$/, '');
                                if (blockMap.has(extractedKey)) {
                                    pmBlock.attrs.blockKey = extractedKey;
                                    console.log(`Added extracted blockKey: ${extractedKey}`);
                                } else {
                                    // If still not found, try the original fig-plot key
                                    if (blockMap.has('fig-plot')) {
                                        pmBlock.attrs.blockKey = 'fig-plot';
                                        console.log(`Added fallback blockKey: fig-plot`);
                                    }
                                }
                            }
                            pmNodes.push(pmBlock);

                        } else if (code) {
                            // Fallback for un-keyed or simple code blocks (this part is less critical)
                            pmNodes.push({
                                type: 'code_block',
                                attrs: { language: codeEl.getAttribute('language') },
                                content: [{ type: 'text', text: codeEl.textContent.replace(/\n$/, '') }]
                            });
                        }
                    } else {
                        // Handle normal <sec> elements (headings, etc.)
                        const titleEl = el.querySelector(':scope > title');
                        if (titleEl) {
                            pmNodes.push({
                                type: 'heading',
                                attrs: { level: level },
                                content: [{ type: 'text', text: cleanText(titleEl.textContent) }]
                            });
                            titleEl.remove();
                        }
                        pmNodes.push(...transformBodyNodes(el.childNodes, blockMap, repoId, context, commitHash, docFilepath, level + 1));
                    }
                    break;
                case 'styled-content': {
                    console.log('Found styled-content, checking for equation');
                    const dispFormula = el.querySelector('disp-formula');
                    if (dispFormula) {
                        const texMath = dispFormula.querySelector('tex-math');
                        if (texMath) {
                            const latex = texMath.textContent.trim();
                            const eqId = el.id || '';
                            const blockKey = eqId.replace(/-nb-article$/, '');
                            pmNodes.push({
                                type: 'quartoBlock',
                                attrs: {
                                    code: latex,
                                    language: 'latex',
                                    htmlOutput: '',
                                    figId: eqId,
                                    figCaption: '',
                                    figLabel: '',
                                    metadata: null,
                                    blockKey: blockMap.has(blockKey) ? blockKey : null
                                }
                            });
                            // Since we processed this, we don't need to process children.
                            break; 
                        }
                    }
                    // If not a formula we care about, fall through to process children
                    pmNodes.push(...transformBodyNodes(el.childNodes, blockMap, repoId, context, commitHash, docFilepath, level));
                    break;
                }
                case 'fig': {
                    console.log('Found standalone figure element');
                    // This handles figures outside of notebook cells
                    const pmBlock = processFig(el, repoId, '', null, commitHash, docFilepath);
                    const rawBlockKey = el.id;
                    const blockKey = rawBlockKey.replace(/-nb-article$/, '');
                    
                    console.log(`Looking for standalone figure/table blockKey: ${blockKey} (raw: ${rawBlockKey}) in blockMap`);
                    
                    if (blockMap.has(blockKey)) {
                        pmBlock.attrs.blockKey = blockKey;
                        console.log(`Added blockKey: ${blockKey}`);
                    } else {
                        console.warn(`Standalone figure/table blockKey not found in blockMap: ${blockKey}`);
                    }
                    pmNodes.push(pmBlock);
                    break;
                }
                case 'code':
                    // Handle standalone code blocks
                    console.log('Found standalone code element');
                    const codeLanguage = el.getAttribute('language') || 'text';
                    const codeContent = el.textContent;
                    pmNodes.push({
                        type: 'quartoBlock',
                        attrs: {
                            code: codeContent,
                            language: codeLanguage,
                            htmlOutput: '',
                            figId: '',
                            figCaption: '',
                            figLabel: '',
                            metadata: null
                        }
                    });
                    break;
                default:
                    // Recursively process other elements
                    pmNodes.push(...transformBodyNodes(el.childNodes, blockMap, repoId, context, commitHash, docFilepath, level));
                    break;
            }
        }
    });

    return pmNodes;
}

/**
 * MODIFIED: The main transformation function.
 * It now accepts blockMap as a new parameter.
 * Enhanced to handle Quarto's JATS structure with sub-articles.
 */
async function jatsToProseMirrorJSON(jatsXml, blockMap, repoId, commitHash, docFilepath) {
    try {
        const dom = new JSDOM(jatsXml, { contentType: "application/xml" });
        const { document } = dom.window;
        const context = buildContext(document);
        
        // Look for sub-article first (this contains the notebook content)
        const subArticle = document.querySelector('sub-article');
        const articleToParse = subArticle || document.querySelector('article');
        
        console.log(`Parsing ${subArticle ? 'sub-article' : 'main article'}`);
        
        const frontEl = articleToParse.querySelector('front, front-stub');
        const metadata = frontEl ? parseFront(frontEl, context) : {};
        
        // Pass blockMap to the body transformer
        const bodyEl = articleToParse.querySelector('body');
        const content = transformBodyNodes(bodyEl.childNodes, blockMap, repoId, context, commitHash, docFilepath);
        
        const finalContent = [];
        
        // MODIFICATION: Create the metadata block AND add the key
        if (metadata && Object.keys(metadata).length > 0 && (metadata.title || metadata.authors?.length > 0)) {
            finalContent.push({
                type: 'quartoBlock',
                attrs: {
                    // Your original attributes for rendering
                    metadata: metadata,
                    htmlOutput: '',
                    code: '',
                    language: 'metadata',
                    figId: '',
                    figCaption: '',
                    figLabel: '',
                    // The new key for serialization
                    blockKey: '__YAML_BLOCK__'
                }
            });
        }
        finalContent.push(...content);

        // The bibliography block is fine as-is, it's just data.
        const bibliography = context.references;
        if (bibliography && Object.keys(bibliography).length > 0) {
            finalContent.push({
                type: 'quartoBlock',
                attrs: {
                    bibliography: bibliography,
                    language: 'bibliography',
                    // ... other attrs null/empty ...
                    metadata: null,
                    htmlOutput: '',
                    code: '',
                    figId: '',
                    figCaption: '',
                    figLabel: ''
                }
            });
        }

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