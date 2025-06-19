const { jatsToProseMirrorJSON } = require('../src/core/astParser');
const { parseQmd } = require('../src/core/qmdBlockParser');

// Test with the actual JATS XML structure
async function testJatsParsing() {
    console.log('=== Testing JATS XML Parsing ===\n');
    
    // The actual JATS XML from Quarto
    const jatsXml = `<?xml version="1.0" encoding="utf-8" ?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving
and Interchange DTD v1.2 20190208//EN" "JATS-archivearticle1.dtd">

<article xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:xlink="http://www.w3.org/1999/xlink" dtd-version="1.2" article-type="other">

<front>
<article-meta>
<title-group>
<article-title>Quartorium</article-title>
</title-group>
<contrib-group>
<contrib contrib-type="author" corresp="yes">
<name>
<surname>Jones</surname>
<given-names>Norah</given-names>
</name>
<string-name>Norah Jones</string-name>
<role vocab="https://credit.niso.org" vocab-term="writing – original
draft" vocab-term-identifier="https://credit.niso.org/contributor-roles/writing-original-draft/">writing</role>
<xref ref-type="aff" rid="aff-1">a</xref>
<xref ref-type="corresp" rid="cor-1">&#x002A;</xref>
</contrib>
</contrib-group>
<aff id="aff-1">
<institution-wrap>
<institution>The University</institution>
</institution-wrap>
</aff>
<author-notes>
<corresp id="cor-1"></corresp>
</author-notes>
<history></history>
</article-meta>
</front>

<body>
<sec id="section">
  <title>Section</title>
  <p>This is a simple placeholder for the manuscript's main document
  (<xref alt="Knuth 1984" rid="ref-knuth84" ref-type="bibr">Knuth
  1984</xref>).</p>
  <fig id="fig-plot">
    <caption><p>Figure 1: A simple plot</p></caption>
    <graphic mimetype="image" mime-subtype="png" xlink:href="index_files/figure-jats/fig-plot-1.png" />
  </fig>
  <p><xref alt="Figure 1" rid="fig-plot">Figure 1</xref> is a simple
  plot.</p>
</sec>
</body>

<back>
<ref-list>
  <title></title>
  <ref id="ref-knuth84">
    <element-citation publication-type="article-journal">
      <person-group person-group-type="author">
        <name><surname>Knuth</surname><given-names>Donald E.</given-names></name>
      </person-group>
      <article-title>Literate programming</article-title>
      <source>Comput. J.</source>
      <publisher-name>Oxford University Press, Inc.</publisher-name>
      <publisher-loc>USA</publisher-loc>
      <year iso-8601-date="1984-05">1984</year><month>05</month>
      <volume>27</volume>
      <issue>2</issue>
      <issn>0010-4620</issn>
      <uri>https://doi.org/10.1093/comjnl/27.2.97</uri>
      <pub-id pub-id-type="doi">10.1093/comjnl/27.2.97</pub-id>
      <fpage>97</fpage>
      <lpage>111</lpage>
    </element-citation>
  </ref>
</ref-list>
</back>

<sub-article article-type="notebook" id="nb-1-nb-article">
<front-stub>
<title-group>
<article-title>Quartorium</article-title>
</title-group>
<contrib-group>
<contrib contrib-type="author" corresp="yes">
<name>
<surname>Jones</surname>
<given-names>Norah</given-names>
</name>
<string-name>Norah Jones</string-name>
<role vocab="https://credit.niso.org" vocab-term="writing – original
draft" vocab-term-identifier="https://credit.niso.org/contributor-roles/writing-original-draft/">writing</role>
<xref ref-type="aff" rid="aff-1-nb-article">a</xref>
<xref ref-type="corresp" rid="cor-1-nb-article">&#x002A;</xref>
</contrib>
</contrib-group>
<aff id="aff-1-nb-article">
<institution-wrap>
<institution>The University</institution>
</institution-wrap>
</aff>
<author-notes>
<corresp id="cor-1-nb-article"></corresp>
</author-notes>
</front-stub>

<body>
<sec id="section-nb-article">
  <title>Section</title>
  <p>This is a simple placeholder for the manuscript's main document
  (<xref alt="Knuth 1984" rid="ref-knuth84-nb-article" ref-type="bibr">Knuth
  1984</xref>).</p>
  <sec id="cell-fig-plot-nb-article" specific-use="notebook-content">
  <code language="r script">plot(1)</code>
  <fig id="fig-plot-nb-article">
    <caption><p>Figure 1: A simple plot</p></caption>
    <graphic mimetype="image" mime-subtype="png" xlink:href="index_files/figure-jats/fig-plot-1.png" />
  </fig>
  </sec>
  <p><xref alt="Figure 1" rid="fig-plot-nb-article">Figure 1</xref> is a simple
  plot.</p>
</sec>
</body>

<back>
<ref-list>
  <title></title>
  <ref id="ref-knuth84-nb-article">
    <element-citation publication-type="article-journal">
      <person-group person-group-type="author">
        <name><surname>Knuth</surname><given-names>Donald E.</given-names></name>
      </person-group>
      <article-title>Literate programming</article-title>
      <source>Comput. J.</source>
      <publisher-name>Oxford University Press, Inc.</publisher-name>
      <publisher-loc>USA</publisher-loc>
      <year iso-8601-date="1984-05">1984</year><month>05</month>
      <volume>27</volume>
      <issue>2</issue>
      <issn>0010-4620</issn>
      <uri>https://doi.org/10.1093/comjnl/27.2.97</uri>
      <pub-id pub-id-type="doi">10.1093/comjnl/27.2.97</pub-id>
      <fpage>97</fpage>
      <lpage>111</lpage>
    </element-citation>
  </ref>
</ref-list>
</back>

</sub-article>

</article>`;

    // The original QMD content
    const originalQmd = `---
title: Quartorium
authors:
  - name: Norah Jones
    affiliation: The University
    roles: writing
    corresponding: true
bibliography: references.bib
---

## Section
This is a simple placeholder for the manuscript's main document [@knuth84].

\`\`\`{r}
#| label: fig-plot
#| fig-cap: "A simple plot"
plot(1)
\`\`\`

@fig-plot is a simple plot.
`;

    try {
        console.log('1. Parsing original QMD to get blockMap...');
        const { blockMap, blockOrder } = parseQmd(originalQmd);
        console.log('BlockMap keys:', Array.from(blockMap.keys()));
        console.log('BlockOrder:', blockOrder);
        
        console.log('\n2. Converting JATS to ProseMirror...');
        const pmDoc = await jatsToProseMirrorJSON(jatsXml, blockMap, 'test-repo', 'test-commit', 'test.qmd');
        
        console.log('\n3. ProseMirror document structure:');
        console.log('Document attrs:', JSON.stringify(pmDoc.attrs, null, 2));
        console.log('Content nodes count:', pmDoc.content?.length || 0);
        
        pmDoc.content?.forEach((node, index) => {
            console.log(`\nNode ${index}:`, node.type);
            console.log('  Attrs:', JSON.stringify(node.attrs, null, 2));
            if (node.content) {
                console.log(`  Content:`, node.content.length, 'items');
                node.content.forEach((contentNode, contentIndex) => {
                    console.log(`    Content ${contentIndex}:`, contentNode.type, contentNode.attrs || contentNode.text);
                });
            }
        });
        
        console.log('\n✅ JATS parsing test completed successfully!');
        
    } catch (error) {
        console.error('❌ Error in JATS parsing test:', error);
        console.error(error.stack);
    }
}

testJatsParsing(); 