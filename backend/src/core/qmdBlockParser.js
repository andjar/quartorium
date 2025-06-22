/**
 * Parses a QMD string into a map of its special blocks (YAML and code chunks).
 * The map's keys are the block labels (e.g., 'fig-plot') and values are the raw block content.
 * Enhanced to handle more block types and provide better block identification.
 * 
 * @param {string} qmdString - The raw content of the .qmd file.
 * @returns {{ blockMap: Map<string, string>, blockOrder: Array<string> }} An object containing the map and order.
 */
function parseQmd(qmdString) {
    const lines = qmdString.split('\n');
    const blockMap = new Map();
    const blockOrder = []; // Track the order of blocks for potential reconstruction
  
    let currentBlockLines = [];
    let inYaml = false;
    let inCode = false;
    let codeFence = '';
    let currentBlockKey = null;
    let blockMetadata = {}; // Store metadata found within the block
  
    console.log('Parsing QMD with', lines.length, 'lines');
  
    for (const line of lines) {
      // Handle YAML frontmatter
      if (line.trim() === '---' && !inCode) {
        currentBlockLines.push(line);
        if (!inYaml) {
          inYaml = true;
          currentBlockKey = '__YAML_BLOCK__';
          console.log('Found YAML start, key:', currentBlockKey);
        } else {
          const raw = currentBlockLines.join('\n');
          blockMap.set(currentBlockKey, raw);
          blockOrder.push(currentBlockKey);
          console.log('Found YAML end, stored as:', currentBlockKey);
          console.log('YAML content:', raw.substring(0, 200) + '...');
          currentBlockLines = [];
          inYaml = false;
          currentBlockKey = null;
        }
        continue;
      }
  
      // Handle fenced code blocks
      if (line.trim().startsWith('```') && !inYaml) {
        currentBlockLines.push(line);
        if (!inCode) {
          inCode = true;
          codeFence = line.trim();
          blockMetadata = {}; // Reset metadata for new block
          
          // Extract the label to use as the key. This is the crucial link.
          // Try multiple label formats:
          let key = null;
          
          // Format 1: {r, label="fig-cars"} (standard Quarto format)
          const labelMatch1 = line.match(/label\s*=\s*["']([^"']+)["']/);
          if (labelMatch1) {
            key = labelMatch1[1].trim();
          }
          
          // Format 2: {r, label=fig-cars} (without quotes)
          if (!key) {
            const labelMatch2 = line.match(/label\s*=\s*([a-zA-Z0-9_-]+)/);
            if (labelMatch2) {
              key = labelMatch2[1].trim();
            }
          }
          
          // Format 3: {r fig-cars} (shorthand format)
          if (!key) {
            const labelMatch3 = line.match(/\{([^}]+)\}/);
            if (labelMatch3) {
              const options = labelMatch3[1];
              const parts = options.split(/\s+/);
              // Look for a part that looks like a figure label
              for (const part of parts) {
                if (part.startsWith('fig-') || part.startsWith('tbl-') || part.startsWith('eq-')) {
                  key = part;
                  break;
                }
              }
            }
          }
          
          // If no specific label found, generate a generic key
          if (!key) {
            key = `__CODE_BLOCK_${blockOrder.length}__`;
          }
          
          currentBlockKey = key;
          console.log('Found code block start, key:', currentBlockKey);
        } else if (line.trim() === codeFence || line.trim() === '```') {
          const raw = currentBlockLines.join('\n');
          if (currentBlockKey) {
            blockMap.set(currentBlockKey, raw);
            blockOrder.push(currentBlockKey);
            console.log('Found code block end, stored as:', currentBlockKey);
            console.log('Code content:', raw.substring(0, 100) + '...');
          }
          currentBlockLines = [];
          inCode = false;
          currentBlockKey = null;
          blockMetadata = {};
        }
        continue;
      }
  
      // Handle Quarto cell metadata within code blocks
      if (inCode && line.trim().startsWith('#|')) {
        const metadataMatch = line.match(/#\|\s*(\w+):\s*(.+)/);
        if (metadataMatch) {
          const [, key, value] = metadataMatch;
          blockMetadata[key.trim()] = value.trim();
          
          // If this is a label, update the block key
          if (key.trim() === 'label') {
            const labelValue = value.trim().replace(/["']/g, ''); // Remove quotes
            if (labelValue && currentBlockKey) {
              // Update the block key to use the label
              const oldKey = currentBlockKey;
              currentBlockKey = labelValue;
              
              // If we already have content for the old key, move it to the new key
              if (blockMap.has(oldKey)) {
                const content = blockMap.get(oldKey);
                blockMap.delete(oldKey);
                blockMap.set(currentBlockKey, content);
                // Update the order array
                const oldIndex = blockOrder.indexOf(oldKey);
                if (oldIndex !== -1) {
                  blockOrder[oldIndex] = currentBlockKey;
                }
              }
              console.log('Updated code block key from', oldKey, 'to', currentBlockKey);
            }
          }
        }
      }
  
      if (inYaml || inCode) {
        currentBlockLines.push(line);
      }
    }
  
    // After the loop, parse for non-fenced blocks like tables and equations
    const remainingText = qmdString
        .replace(/---[\s\S]*?---/, '') // Remove YAML
        .replace(/```[\s\S]*?```/g, ''); // Remove code blocks

    const tableRegex = /((?:\|.*\|\n)+(?::.*?)?)(:.*\{#((?:tbl|fig)-[^\s}]+)\})?/g;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(remainingText)) !== null) {
        const tableContent = tableMatch[1].trim();
        const fullBlock = tableMatch[0].trim();
        let key = `__TABLE_BLOCK_${blockOrder.length}__`; // Default key

        // Check if there is a caption with a label
        if (tableMatch[3]) {
            key = tableMatch[3];
        } else {
            // If no label in caption, check for a label in the table content itself
            const labelInContentMatch = fullBlock.match(/\{#(tbl-[^\s}]+)\}/);
            if (labelInContentMatch) {
                key = labelInContentMatch[1];
            }
        }
        
        blockMap.set(key, fullBlock);
        blockOrder.push(key);
        console.log('Found table block, stored as:', key);
    }
    
    const equationRegex = /(\$\$[\s\S]*?\$\$)\s*(\{\s*#((?:eq|eqn)-[^\s}]+)\s*\})?/g;
    let eqMatch;
    while ((eqMatch = equationRegex.exec(remainingText)) !== null) {
        const fullBlock = eqMatch[0].trim();
        let key = `__EQ_BLOCK_${blockOrder.length}__`; // Default key
        
        // The label is in the second capturing group, the key in the third
        if (eqMatch[3]) {
            key = eqMatch[3];
        }

        blockMap.set(key, fullBlock);
        blockOrder.push(key);
        console.log('Found equation block, stored as:', key);
    }
  
    // Handle any remaining block content
    if (currentBlockLines.length > 0 && currentBlockKey) {
      const raw = currentBlockLines.join('\n');
      blockMap.set(currentBlockKey, raw);
      blockOrder.push(currentBlockKey);
      console.log('Stored remaining block as:', currentBlockKey);
    }
  
    console.log('Final blockMap keys:', Array.from(blockMap.keys()));
    return { blockMap, blockOrder };
  }
  
  module.exports = { parseQmd };