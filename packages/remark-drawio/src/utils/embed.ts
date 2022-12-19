// transplanted from https://github.com/jgraph/drawio-tools/blob/d46977060ffad70cae5a9059a2cbfcd8bcf420de/tools/convert.html
import pako from 'pako';
import xmldoc from 'xmldoc';

export const extractCodeFromMxfile = (input: string): string => {
  const doc = new xmldoc.XmlDocument(input);
  return doc.valueWithPath('diagram');
};

const validateInputData = (input: string): boolean => {
  let data = input;

  try {
    data = extractCodeFromMxfile(data);
  }
  catch (e) {
    // ignore
  }

  try {
    data = Buffer.from(data, 'base64').toString('binary');
  }
  catch (e) {
    throw new Error(`Base64 to binary failed: ${e}`);
  }

  if (data.length > 0) {
    try {
      data = pako.inflateRaw(Uint8Array.from(data, c => c.charCodeAt(0)), { to: 'string' });
    }
    catch (e) {
      throw new Error(`inflateRaw failed: ${e}`);
    }
  }

  try {
    data = decodeURIComponent(data);
  }
  catch (e) {
    throw new Error(`decodeURIComponent failed: ${e}`);
  }

  return true;
};

const escapeHTML = (string): string => {
  if (typeof string !== 'string') {
    return string;
  }
  return string.replace(/[&'`"<>]/g, (match): string => {
    return {
      '&': '&amp;',
      "'": '&#x27;',
      '`': '&#x60;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    }[match] ?? match;
  });
};

export const generateMxgraphData = (code: string): string => {
  const trimedCode = code.trim();
  if (!trimedCode) {
    return '';
  }

  validateInputData(trimedCode);

  let xml;
  try {
    // may be XML Format <mxfile><diagram> ... </diagram></mxfile>
    const doc = new xmldoc.XmlDocument(trimedCode);
    const diagram = doc.valueWithPath('diagram');
    if (diagram) {
      xml = trimedCode;
    }
  }
  catch (e) {
    // may be NOT XML Format
    xml = `
<mxfile version="6.8.9" editor="www.draw.io" type="atlas">
  <mxAtlasLibraries/>
  <diagram>${trimedCode}</diagram>
</mxfile>
`;
  }

  // see options: https://drawio.freshdesk.com/support/solutions/articles/16000042542-embed-html
  const mxGraphData = {
    editable: false,
    highlight: '#0000ff',
    nav: false,
    toolbar: null,
    edit: null,
    resize: true,
    lightbox: 'false',
    xml,
  };

  return escapeHTML(JSON.stringify(mxGraphData));
};
