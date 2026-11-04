import { extractDocument } from './extract-client';
import {
  jsonReply,
  type StubExtractor,
  startStubExtractor,
} from './spec-support';

const TOKEN = 'spec-token-5f2c';

const file = {
  fileName: 'txt-shift-jis.txt',
  mimeType: 'text/plain',
  bytes: new Uint8Array([0x8b, 0x63, 0x8e, 0x96, 0x98, 0x5e]),
};

describe('extractDocument', () => {
  let stub: StubExtractor;

  beforeEach(async () => {
    stub = await startStubExtractor();
  });

  afterEach(async () => {
    await stub.close();
  });

  const endpoint = (timeoutMs = 5000) => ({
    baseUrl: stub.baseUrl,
    token: TOKEN,
    timeoutMs,
  });

  it('posts the file as multipart "file" with its name, MIME type and bytes, and a Bearer token', async () => {
    await extractDocument(endpoint(), file);

    expect(stub.received).toHaveLength(1);
    const [request] = stub.received;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/extract');
    expect(request.authorization).toBe(`Bearer ${TOKEN}`);
    const sent = request.form.get('file');
    expect(sent).toBeInstanceOf(File);
    if (!(sent instanceof File)) return;
    expect(sent.name).toBe('txt-shift-jis.txt');
    expect(sent.type).toBe('text/plain');
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(file.bytes);
  });

  it('accepts a base URL with a trailing slash', async () => {
    await extractDocument({ ...endpoint(), baseUrl: `${stub.baseUrl}/` }, file);

    expect(stub.received[0].url).toBe('/extract');
  });

  it('returns the pages of a 200 response', async () => {
    stub.setReply(
      jsonReply(200, {
        pages: [
          { pageNumber: 1, label: '売上', content: '売上高' },
          { pageNumber: null, label: null, content: '' },
        ],
        mimeType: 'text/plain',
        extractedCharacters: 3,
      }),
    );

    expect(await extractDocument(endpoint(), file)).toEqual({
      ok: true,
      pages: [
        { pageNumber: 1, label: '売上', content: '売上高' },
        { pageNumber: null, label: null, content: '' },
      ],
    });
  });

  it.each([
    [
      401,
      { code: 'unauthorized', message: 'Missing or invalid Bearer token' },
      /401.*unauthorized/,
    ],
    [415, { code: 'unsupported_media_type' }, /415.*unsupported_media_type/],
    [503, { code: 'busy' }, /503.*busy/],
  ])('reports HTTP %i as a failure naming the status and error code', async (status, body, reason) => {
    stub.setReply(jsonReply(status, body));

    const outcome = await extractDocument(endpoint(), file);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(reason);
  });

  it('reports a 500 without a JSON body as a failure naming the status', async () => {
    stub.setReply((res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    });

    const outcome = await extractDocument(endpoint(), file);

    expect(outcome).toEqual({ ok: false, reason: 'HTTP 500' });
  });

  it('reports a 200 whose body is not the extraction response as a failure', async () => {
    stub.setReply(
      jsonReply(200, { pages: [{ pageNumber: '1', content: 'x' }] }),
    );

    const outcome = await extractDocument(endpoint(), file);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/unexpected response/);
  });

  it('reports a service that does not answer in time as a failure', async () => {
    stub.setReply(() => {
      // never answers
    });

    const outcome = await extractDocument(endpoint(200), file);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/timed out/);
  });

  it('reports a service that is not listening as a failure', async () => {
    await stub.close();

    const outcome = await extractDocument(endpoint(), file);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).not.toContain(TOKEN);
  });
});
