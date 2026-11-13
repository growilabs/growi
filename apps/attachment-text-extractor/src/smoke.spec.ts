import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import { buildTextPdf } from '../test/fixtures/pdf';

describe('@growi/attachment-text-extractor package', () => {
  it('runs vitest on Node', () => {
    expect(typeof process.versions.node).toBe('string');
  });
});

// Each adopted runtime dependency is imported dynamically inside its own case,
// so a missing or broken package fails only the case that names it.
describe('adopted runtime dependencies', () => {
  it('hono answers a request routed through an app', async () => {
    const { Hono } = await import('hono');
    const app = new Hono().get('/healthz', (c) => c.text('ok'));

    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('@hono/node-server serves a Hono app over a Node HTTP server', async () => {
    const { Hono } = await import('hono');
    const { getRequestListener } = await import('@hono/node-server');
    const app = new Hono().get('/healthz', (c) => c.text('ok'));
    const server = createServer(getRequestListener(app.fetch));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );

    try {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        throw new Error(`unexpected server address: ${address}`);
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/healthz`);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('@firecrawl/anydoc loads its native binding and converts CSV bytes', async () => {
    const { formatFromExtension, toMarkdownBytes } = await import(
      '@firecrawl/anydoc'
    );

    const markdown = await toMarkdownBytes(
      Buffer.from('a,b\n1,2\n'),
      formatFromExtension('csv'),
    );

    expect(markdown).toContain('a');
    expect(markdown).toContain('2');
  });

  it('@embedpdf/pdfium loads the bundled WASM binary and counts PDF pages', async () => {
    const { init } = await import('@embedpdf/pdfium');
    const wasmPath = createRequire(import.meta.url).resolve(
      '@embedpdf/pdfium/pdfium.wasm',
    );
    const pdfium = await init({
      wasmBinary: new Uint8Array(await readFile(wasmPath)).buffer,
    });
    pdfium.PDFiumExt_Init();
    const pdf = buildTextPdf(['first page', 'second page']);

    const ptr = pdfium.pdfium.wasmExports.malloc(pdf.length);
    expect(ptr).not.toBe(0);
    try {
      pdfium.pdfium.HEAPU8.set(pdf, ptr);
      const doc = pdfium.FPDF_LoadMemDocument(ptr, pdf.length, '');
      expect(doc).not.toBe(0);
      try {
        expect(pdfium.FPDF_GetPageCount(doc)).toBe(2);
      } finally {
        pdfium.FPDF_CloseDocument(doc);
      }
    } finally {
      pdfium.pdfium.wasmExports.free(ptr);
    }
  });

  it('htmlparser2 Tokenizer reports the text between tags', async () => {
    const { Tokenizer } = await import('htmlparser2');
    const markup = '<p>hello</p>';
    const texts: string[] = [];
    const ignore = () => {};
    const tokenizer = new Tokenizer(
      { decodeEntities: true, recognizeSelfClosing: true },
      {
        onattribdata: ignore,
        onattribentity: ignore,
        onattribend: ignore,
        onattribname: ignore,
        oncdata: ignore,
        onclosetag: ignore,
        oncomment: ignore,
        ondeclaration: ignore,
        onend: ignore,
        onopentagend: ignore,
        onopentagname: ignore,
        onprocessinginstruction: ignore,
        onselfclosingtag: ignore,
        ontext: (start, end) => texts.push(markup.slice(start, end)),
        ontextentity: ignore,
      },
    );

    tokenizer.write(markup);
    tokenizer.end();

    expect(texts).toEqual(['hello']);
  });

  it('entities decodes HTML character references', async () => {
    const { decodeHTML } = await import('entities');

    expect(decodeHTML('a&amp;b&#x3042;')).toBe('a&bあ');
  });

  it('@xmldom/xmldom parses XML into a DOM', async () => {
    const { DOMParser } = await import('@xmldom/xmldom');

    const doc = new DOMParser().parseFromString(
      '<root><a>text</a></root>',
      'text/xml',
    );

    expect(doc.documentElement?.textContent).toBe('text');
  });

  it('a ZIP written by yazl reads back through yauzl with the same entry', async () => {
    const { ZipFile } = await import('yazl');
    const yauzl = await import('yauzl');
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from('entry body'), 'dir/entry.txt');
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) {
      chunks.push(Buffer.from(chunk));
    }

    const entries = await new Promise<Record<string, string>>(
      (resolve, reject) => {
        yauzl.fromBuffer(
          Buffer.concat(chunks),
          { lazyEntries: true },
          (openError, zipfile) => {
            if (openError != null) return reject(openError);
            const read: Record<string, string> = {};
            zipfile.on('entry', (entry: import('yauzl').Entry) => {
              zipfile.openReadStream(entry, async (streamError, stream) => {
                if (streamError != null) return reject(streamError);
                const parts: Buffer[] = [];
                for await (const part of stream) parts.push(Buffer.from(part));
                read[entry.fileName] = Buffer.concat(parts).toString('utf8');
                zipfile.readEntry();
              });
            });
            zipfile.on('end', () => resolve(read));
            zipfile.on('error', reject);
            zipfile.readEntry();
          },
        );
      },
    );

    expect(entries).toEqual({ 'dir/entry.txt': 'entry body' });
  });

  it('ajv validates data against a JSON schema', async () => {
    const { Ajv } = await import('ajv');
    const validate = new Ajv().compile({
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    });

    expect(validate({ code: 'ok' })).toBe(true);
    expect(validate({})).toBe(false);
  });
});
