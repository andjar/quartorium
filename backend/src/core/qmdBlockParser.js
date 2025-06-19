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
          const labelMatch = raw.match(/#\|\s*label:\s*(\S+)/);
          if (labelMatch) {
            const key = labelMatch[1].trim();
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