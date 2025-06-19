/**
 * Extracts the comments appendix from a QMD string.
 *
 * @param {string} qmdString - The QMD string.
 * @returns {{comments: Array<Object>, remainingQmdString: string}} - An object containing the parsed comments and the QMD string without the appendix.
 */
function extractCommentsAppendix(qmdString) {
  const appendixRegex = /<!-- Comments Appendix -->\s*<div id="quartorium-comments" style="display:none;">\s*```json\s*([\s\S]*?)\s*```\s*<\/div>/s;
  const match = qmdString.match(appendixRegex);

  if (!match) {
    return { comments: [], remainingQmdString: qmdString };
  }

  const jsonString = match[1];
  let commentsData;

  try {
    commentsData = JSON.parse(jsonString);
  } catch (error) {
    console.error("Invalid JSON in comments appendix:", error);
    return { comments: [], remainingQmdString: qmdString.replace(appendixRegex, "").trim() }; // Added .trim()
  }

  // The JSON structure has a top-level "comments" key
  const comments = commentsData.comments || [];

  const remainingQmdString = qmdString.replace(appendixRegex, "").trim();

  return { comments, remainingQmdString };
}

module.exports = { extractCommentsAppendix };
