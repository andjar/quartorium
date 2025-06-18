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

// ===================================================================
// JATS TRANSFORMATION LOGIC (REFACTORED AND IMPROVED)
// ===================================================================

// Helper to find a direct child by name
const findChild = (node, name) => node?.$$?.find(c => c['#name'] === name);

// Helper to find all direct children by name
const findChildren = (node, name) => node?.$$?.filter(c => c['#name'] === name) || [];

// Your robust text extraction helper (unchanged, it's great)
function extractText(node) {
    if (!node) return '';
    let text = '';
    if (node._) {
        text += node._;
    }
    if (node.$$) {
        node.$$.forEach(child => {
            text += extractText(child);
        });
    }
    return text.trim();
}

/**
 * First pass: Scans the JATS object to build maps of all referenceable items.
 * This makes resolving xrefs much easier later.
 * @param {object} articleNode - The root <article> node from xml2js.
 * @returns {object} A context object with maps for affiliations, refs, etc.
 */
function buildContext(articleNode) {
    const context = {
        affiliations: {},
        references: {},
        notes: {},
        figures: {}
    };

    // Find affiliations in <front>
    const articleMeta = findChild(findChild(articleNode, 'front'), 'article-meta');
    if (articleMeta) {
        findChildren(articleMeta, 'aff').forEach(aff => {
            const id = aff.$?.id;
            if (id) {
                // A more robust extraction of affiliation text
                const inst = findChild(findChild(aff, 'institution-wrap'), 'institution');
                context.affiliations[id] = extractText(inst) || extractText(aff);
            }
        });
        
        const authorNotes = findChild(articleMeta, 'author-notes');
        if (authorNotes) {
            findChildren(authorNotes, 'corresp').forEach(note => {
                const id = note.$?.id;
                if (id) {
                    context.notes[id] = extractText(note) || 'Corresponding Author';
                }
            });
        }
    }

    // Find references in <back>
    const back = findChild(articleNode, 'back');
    if (back) {
        findChildren(findChild(back, 'ref-list'), 'ref').forEach(ref => {
            const id = ref.$?.id;
            if (id) {
                context.references[id] = parseReference(ref);
            }
        });
    }
    
    // Recursively find all figures in the document
    function findAllFigs(node) {
        if (!node) return;
        if (node['#name'] === 'fig') {
            const id = node.$?.id;
            const caption = extractText(findChild(node, 'caption'));
            if (id) {
                context.figures[id] = { id, caption };
            }
        }
        if (node.$$) {
            node.$$.forEach(findAllFigs);
        }
    }
    findAllFigs(articleNode);

    return context;
}


/**
 * Parses a <ref> element into a structured object.
 * @param {object} refNode - The <ref> node.
 * @returns {object} Structured reference data.
 */
function parseReference(refNode) {
    const citation = findChild(refNode, 'element-citation') || findChild(refNode, 'mixed-citation');
    if (!citation) return { text: extractText(refNode) };

    const authors = findChildren(findChild(citation, 'person-group'), 'name')
        .map(name => ({
            surname: extractText(findChild(name, 'surname')),
            given: extractText(findChild(name, 'given-names')),
        }));

    return {
        id: refNode.$?.id,
        type: citation.$?.['publication-type'] || 'misc',
        authors: authors,
        title: extractText(findChild(citation, 'article-title')),
        source: extractText(findChild(citation, 'source')),
        year: extractText(findChild(citation, 'year')),
        volume: extractText(findChild(citation, 'volume')),
        issue: extractText(findChild(citation, 'issue')),
        fpage: extractText(findChild(citation, 'fpage')),
        lpage: extractText(findChild(citation, 'lpage')),
        doi: findChildren(citation, 'pub-id').find(pid => pid.$?.['pub-id-type'] === 'doi')?._,
        uri: extractText(findChild(citation, 'uri')),
        // A simple string representation for display
        text: extractText(citation)
    };
}


/**
 * Parses the <front> matter into a structured metadata object.
 * @param {object} frontNode - The <front> node.
 * @param {object} context - The context object with resolved affiliations.
 * @returns {object} Structured metadata.
 */
function parseFront(frontNode, context) {
    const meta = findChild(frontNode, 'article-meta');
    if (!meta) return {};

    const title = extractText(findChild(findChild(meta, 'title-group'), 'article-title'));
    
    const authors = findChildren(findChild(meta, 'contrib-group'), 'contrib')
        .filter(c => c.$?.['contrib-type'] === 'author')
        .map(contrib => {
            const affXrefs = findChildren(contrib, 'xref').filter(xref => xref.$?.['ref-type'] === 'aff');
            const correspXref = findChildren(contrib, 'xref').find(xref => xref.$?.['ref-type'] === 'corresp');
            
            return {
                name: extractText(findChild(contrib, 'string-name')) || `${extractText(findChild(findChild(contrib, 'name'), 'given-names'))} ${extractText(findChild(findChild(contrib, 'name'), 'surname'))}`,
                role: extractText(findChild(contrib, 'role')),
                isCorresponding: !!correspXref,
                affiliations: affXrefs.map(xref => ({
                    id: xref.$?.rid,
                    text: context.affiliations[xref.$?.rid] || ''
                }))
            };
        });

    return { title, authors };
}

/**
 * Transforms an array of JATS body nodes into an array of ProseMirror nodes.
 * @param {Array} children - An array of child nodes from xml2js's '$$' property.
 * @param {string} repoId - The repository ID for asset path rewriting.
 * @param {object} context - The context object for resolving xrefs.
 * @returns {Array} An array of ProseMirror nodes.
 */
function transformBodyNodes(children, repoId, context) {
  if (!children) return [];
  const pmNodes = [];

  children.forEach(node => {
    const nodeName = node['#name'];
    
    switch (nodeName) {
      case '__text__':
        if (node._.trim()) {
          pmNodes.push({ type: 'text', text: node._ });
        }
        break;

      case 'p':
        let p_content = [];
        if (node.$$) { // If there are child elements
          p_content = transformBodyNodes(node.$$, repoId, context);
        } else if (node._ && node._.trim()) { // Else if there's direct text content and it's not empty
          p_content = [{ type: 'text', text: node._.trim() }];
        }
        // If there are both direct text and children, xml2js typically wraps direct text
        // in its own __text__ node within $$. If not, this simplified logic might
        // miss direct text if $$ also exists. However, standard JATS usage and xml2js behavior
        // usually don't mix them at the same level without __text__ nodes for the direct text parts.
        // This change prioritizes explicit children if they exist, otherwise looks for direct text.

        pmNodes.push({
          type: 'paragraph',
          content: p_content
        });
        break;
      
      case 'xref':
        const refType = node.$?.['ref-type'];
        const rid = node.$?.rid;
        if (refType === 'bibr' && context.references[rid]) {
            // This is a bibliographic citation. Create a custom node or mark.
            // A custom node is more flexible.
            pmNodes.push({
                type: 'citation', // You'll need to define this in your ProseMirror schema
                attrs: {
                    rid: rid,
                    label: extractText(node)
                },
            });
        } else if (refType === 'fig' && context.figures[rid]) {
            // This is a cross-reference to a figure.
            // Could become a link that jumps to the figure. For now, text is fine.
            pmNodes.push({ type: 'text', text: extractText(node) });
        } else {
            // Fallback for other xref types (aff, corresp, etc.) which are handled
            // in the metadata, so we can often just render their text content here.
            pmNodes.push({ type: 'text', text: extractText(node) });
        }
        break;

      case 'sec':
        const secAttrs = node.$ || {};
        if (secAttrs['specific-use'] === 'notebook-content') {
          // Quarto Code Cell
          const codeChild = findChild(node, 'code');
          const figChild = findChild(node, 'fig');
          const code = extractText(codeChild);
          
          if (figChild) {
            pmNodes.push(processFig(figChild, repoId, code));
          } else if (code) {
            pmNodes.push({
              type: 'code_block',
              attrs: { language: codeChild?.$?.language || null },
              content: [{ type: 'text', text: code.replace(/\n$/, '') }] // remove trailing newline
            });
          }
        } else {
          // Regular Section
          const titleChild = findChild(node, 'title');
          const contentChildren = node.$$.filter(c => c['#name'] !== 'title');
          
          if (titleChild) {
            pmNodes.push({
              type: 'heading',
              attrs: { level: 2 }, // You might want to calculate level based on nesting
              content: [{ type: 'text', text: extractText(titleChild) }]
            });
          }
          pmNodes.push(...transformBodyNodes(contentChildren, repoId, context));
        }
        break;

      case 'fig':
        // Handles figures NOT inside a processed notebook cell
        pmNodes.push(processFig(node, repoId, ''));
        break;
      
      // TODO: Add cases for other elements like list, table, etc.
    }
  });

  return pmNodes;
}

/**
 * Processes a <fig> node from JATS into a ProseMirror 'quartoBlock' node.
 * (Your function was already very good, minor tweaks for robustness)
 * @param {object} figNode - The <fig> node from xml2js.
 * @param {string} repoId - The ID of the repository for asset rewriting.
 * @param {string} code - The source code associated with this figure.
 * @returns {object} A ProseMirror quartoBlock node.
 */
function processFig(figNode, repoId, code) {
  const figId = figNode.$?.id || '';
  
  const captionText = extractText(findChild(figNode, 'caption'));
  const figLabel = extractText(findChild(findChild(figNode, 'caption'), 'label')) || captionText.split(/[:.]/)[0] || '';
 
  const graphicChild = findChild(figNode, 'graphic');
  const attrs = graphicChild?.$ || {};
  
  // Quarto uses 'xlink:href', but standard JATS might just use 'href'
  const imageSrc = attrs['xlink:href'] || attrs.href || '';
  // IMPORTANT: The asset path needs to be relative to the *document*, not the repo root.
  // Your `renderToJATS` correctly identifies the assets dir. Let's assume the path is correct.
  const rewrittenSrc = imageSrc ? `/api/assets/${repoId}/${imageSrc}` : '';
  const imageHtml = rewrittenSrc ? `<img src="${rewrittenSrc}" alt="${captionText}" style="max-width: 100%; height: auto;" />` : '';
 
   return {
     type: 'quartoBlock',
     attrs: {
       htmlOutput: imageHtml,
       code: code,
       figId: figId,
       figCaption: captionText,
       figLabel: figLabel,
     }
   };
}


/**
 * Transforms a JATS XML string into a ProseMirror JSON document.
 * @param {string} jatsXml - The JATS XML content.
 * @param {string} repoId - The repository ID for asset path rewriting.
 * @returns {Promise<object>} The ProseMirror JSON document.
 */
async function jatsToProseMirrorJSON(jatsXml, repoId) {
  try {
    // 1. Parse XML to JS Object
    let cleanXml = jatsXml.trim();
    if (cleanXml.charCodeAt(0) === 0xFEFF) {
        cleanXml = cleanXml.substring(1);
    }
    const jatsObj = await parseStringPromise(cleanXml, { 
      attrkey: '$', charkey: '_', explicitCharkey: true, explicitChildren: true,
      preserveChildrenOrder: true, xmlns: false,
    });

    // 2. Decide which article content to use (main or sub-article)
    // The sub-article is often the primary source from computational notebooks.
    const mainArticle = jatsObj.article;
    const subArticle = mainArticle['sub-article']?.[0];
    const articleToParse = subArticle || mainArticle;

    if (!articleToParse) {
        throw new Error("Could not find <article> or <sub-article> element.");
    }

    // 3. First Pass: Build context for resolving IDs
    // We build it from the *main article* to ensure all references are available.
    const context = buildContext(mainArticle);

    // 4. Parse Metadata from <front>
    const frontNode = findChild(articleToParse, 'front') || findChild(articleToParse, 'front-stub');
    const metadata = frontNode ? parseFront(frontNode, context) : {};
    
    // 5. Parse Body Content
    const bodyNode = findChild(articleToParse, 'body');
    if (!bodyNode) {
        throw new Error("Could not find <body> in the selected article content.");
    }
    const content = transformBodyNodes(bodyNode.$$, repoId, context);

    // 6. Assemble the final ProseMirror document
    return {
       type: 'doc',
       attrs: {
         // This structure is much more organized for the frontend
         metadata: metadata,
         bibliography: context.references
       },
       content: content,
     };

   } catch (error) {
     console.error("Error transforming JATS XML to ProseMirror JSON:", error);
     throw new Error("Failed to parse or transform JATS XML.");
   }
}

module.exports = { renderToJATS, jatsToProseMirrorJSON };