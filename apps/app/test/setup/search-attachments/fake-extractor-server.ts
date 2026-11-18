import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the attachment-text-extractor service, for integration
 * tests that run the real generated client against it.
 *
 * A file built with `fixtureFileContent` tells the server what to answer: the
 * number of pages and a word each page contains. Any other file (attachments
 * left by other test files sharing the database) gets one empty page.
 */

export type ExtractorReply = {
  readonly status: number;
  readonly body: unknown;
};

export type ReceivedExtractRequest = {
  readonly authorization: string | undefined;
  readonly body: string;
};

type Hold = {
  readonly reached: Promise<void>;
  readonly release: () => void;
};

export type FakeExtractorServer = {
  readonly url: string;
  readonly requests: readonly ReceivedExtractRequest[];
  /** Replaces the default reply for every request; null restores it. */
  setReply(reply: ((body: string) => ExtractorReply) | null): void;
  /**
   * Holds the answer to the request for a file with this hold key until
   * `release` is called. `reached` resolves once that request has arrived.
   */
  hold(key: string): Hold;
  /** Releases every hold, e.g. after a test failed while holding one. */
  releaseAll(): void;
  close(): Promise<void>;
};

const FIXTURE_PATTERN = /FIXTURE pages=(\d+) word=(\S+)(?: hold=(\S+))? END/;

export const fixtureFileContent = ({
  pages,
  word,
  hold,
}: {
  pages: number;
  word: string;
  hold?: string;
}): string =>
  `FIXTURE pages=${pages} word=${word}${hold != null ? ` hold=${hold}` : ''} END`;

const successReply = (body: string): ExtractorReply => {
  const match = FIXTURE_PATTERN.exec(body);
  const pageCount = match != null ? Number(match[1]) : 1;
  const word = match?.[2];
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    label: null,
    content: word != null ? `${word} page ${i + 1}` : '',
  }));
  return {
    status: 200,
    body: {
      mimeType: 'text/plain',
      extractedCharacters: pages.reduce((n, p) => n + p.content.length, 0),
      pages,
    },
  };
};

export const startFakeExtractorServer =
  async (): Promise<FakeExtractorServer> => {
    const requests: ReceivedExtractRequest[] = [];
    const holds = new Map<
      string,
      { arrived: () => void; released: Promise<void>; release: () => void }
    >();
    let customReply: ((body: string) => ExtractorReply) | null = null;

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ authorization: req.headers.authorization, body });

        const holdKey = FIXTURE_PATTERN.exec(body)?.[3];
        const hold = holdKey != null ? holds.get(holdKey) : undefined;
        if (hold != null) {
          hold.arrived();
          await hold.released;
        }

        const reply = (customReply ?? successReply)(body);
        res.statusCode = reply.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(reply.body));
      });
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      );
    });

    return {
      url: `http://127.0.0.1:${port}`,
      requests,
      setReply(reply) {
        customReply = reply;
      },
      hold(key) {
        let arrived: () => void = () => {};
        let release: () => void = () => {};
        const reached = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        holds.set(key, { arrived, released, release });
        return {
          reached,
          release: () => {
            holds.delete(key);
            release();
          },
        };
      },
      releaseAll() {
        for (const held of holds.values()) held.release();
        holds.clear();
      },
      close() {
        this.releaseAll();
        return new Promise((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        });
      },
    };
  };
