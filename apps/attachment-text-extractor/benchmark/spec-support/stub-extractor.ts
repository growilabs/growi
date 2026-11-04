import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

// A stand-in extraction service on a free local port for the specs. It
// records each request, with its multipart body parsed, and answers with
// whatever reply the spec sets (per uploaded file name, or by default).

export interface ReceivedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly form: FormData;
}

export type StubReply = (res: ServerResponse) => void;

export interface StubExtractor {
  readonly baseUrl: string;
  readonly received: readonly ReceivedRequest[];
  /** Sets the reply for every request, or for the file with this name. */
  setReply(reply: StubReply, fileName?: string): void;
  close(): Promise<void>;
}

export const jsonReply =
  (status: number, body: unknown): StubReply =>
  (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const uploadedName = (form: FormData): string | undefined => {
  const file = form.get('file');
  return file instanceof File ? file.name : undefined;
};

export const startStubExtractor = async (): Promise<StubExtractor> => {
  const received: ReceivedRequest[] = [];
  const replies = new Map<string, StubReply>();
  let defaultReply: StubReply = jsonReply(200, { pages: [] });
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const form = await new Response(new Uint8Array(body), {
      headers: { 'content-type': req.headers['content-type'] ?? '' },
    }).formData();
    received.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      form,
    });
    (replies.get(uploadedName(form) ?? '') ?? defaultReply)(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('the stub is not listening on a TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    received,
    setReply: (reply, fileName) => {
      if (fileName == null) {
        defaultReply = reply;
      } else {
        replies.set(fileName, reply);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
