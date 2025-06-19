/**
 * Parses a QMD string into a map of its special blocks (YAML and code chunks).
 * The map's keys are the block labels (e.g., 'fig-plot') and values are the raw block content.
 * @param {string} qmdString - The raw content of the .qmd file.
 * @returns {{ blockMap: Map<string, string> }} An object containing the map.
 */
function parseQmd(qmdString) {
    const lines = qmdString.split('\n');
    const blockMap = new Map();
  
    let currentBlockLines = [];
    let inYaml = false;
    let inCode = false;
    let codeFence = '';
  
    for (const line of lines) {
      // Handle YAML frontmatter
      if (line.trim() === '---' && !inCode) {
        currentBlockLines.push(line);
        if (!inYaml) {
          inYaml = true;
        } else {
          const raw = currentBlockLines.join('\n');
          // Use a consistent, special key for the YAML block
          blockMap.set('__YAML_BLOCK__', raw);
          currentBlockLines = [];
          inYaml = false;
        }
        continue;
      }
  
      // Handle fenced code blocks
      if (line.trim().startsWith('```') && !inYaml) {
        currentBlockLines.push(line);
        if (!inCode) {
          inCode = true;
          codeFence = line.trim();
        } else if (line.trim() === codeFence || line.trim() === '```') {
          const raw = currentBlockLines.join('\n');
          // Extract the label to use as the key. This is the crucial link.
          // Try multiple label formats:
          let key = null;
          
          // Format 1: #| label: fig-cars
          const labelMatch1 = raw.match(/#\|\s*label:\s*(\S+)/);
          if (labelMatch1) {
            key = labelMatch1[1].trim();
          }
          
          // Format 2: {r, label="fig-cars"} (standard Quarto format)
          if (!key) {
            const labelMatch2 = raw.match(/label\s*=\s*["']([^"']+)["']/);
            if (labelMatch2) {
              key = labelMatch2[1].trim();
            }
          }
          
          // Format 3: {r, label=fig-cars} (without quotes)
          if (!key) {
            const labelMatch3 = raw.match(/label\s*=\s*([a-zA-Z0-9_-]+)/);
            if (labelMatch3) {
              key = labelMatch3[1].trim();
            }
          }
          
          if (key) {
            blockMap.set(key, raw);
          }
          currentBlockLines = [];
          inCode = false;
        }
        continue;
      }
  
      if (inYaml || inCode) {
        currentBlockLines.push(line);
      }
    }
  
    return { blockMap };
  }
  
  module.exports = { parseQmd };