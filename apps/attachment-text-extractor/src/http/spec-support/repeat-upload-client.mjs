// A client in its own process for the early-answer tests (research.md 16.5,
// `rep30.mjs`): sends the same oversized upload `count` times, each on a new
// connection that Node closes after answering, writing the body in 64 KiB
// pieces and stopping once a write fails, then reads whatever answer arrived.
// It must not share the server's process: there, the answer is read before
// the reset that loses it on a real client (the 4.4 review's measurement).
//
// usage: node repeat-upload-client.mjs <port> <token> <http10|close|chunked-close> <count> <fileBytes>
// prints: {"answers":[{"status":413,"connection":"close"}, ...]} (status null: no answer)
import { connect } from 'node:net';

const [portArg, token, mode, countArg, sizeArg] = process.argv.slice(2);
const port = Number(portArg);
const count = Number(countArg);
const fileBytes = Number(sizeArg);
const BOUNDARY = 'repeat-upload-b0undary';
const PIECE = 64 * 1024;

const fileHead = Buffer.from(
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  'latin1',
);
const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1');
const body = Buffer.concat([fileHead, Buffer.alloc(fileBytes, 0x78), tail]);

const headLines = (lines) =>
  Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
const common = [
  `Authorization: Bearer ${token}`,
  `Content-Type: multipart/form-data; boundary=${BOUNDARY}`,
];

const chunkFrame = (bytes) =>
  Buffer.concat([
    Buffer.from(`${bytes.length.toString(16)}\r\n`, 'latin1'),
    bytes,
    Buffer.from('\r\n', 'latin1'),
  ]);

/** The request as the pieces it is written in. */
const pieces = () => {
  if (mode === 'chunked-close') {
    const frames = [];
    for (let at = 0; at < body.length; at += PIECE)
      frames.push(chunkFrame(body.subarray(at, at + PIECE)));
    frames.push(Buffer.from('0\r\n\r\n', 'latin1'));
    return [
      headLines([
        'POST /extract HTTP/1.1',
        'Host: test',
        ...common,
        'Transfer-Encoding: chunked',
        'Connection: close',
      ]),
      ...frames,
    ];
  }
  const head =
    mode === 'http10'
      ? headLines([
          'POST /extract HTTP/1.0',
          'Host: test',
          ...common,
          `Content-Length: ${body.length}`,
        ])
      : headLines([
          'POST /extract HTTP/1.1',
          'Host: test',
          ...common,
          `Content-Length: ${body.length}`,
          'Connection: close',
        ]);
  const parts = [head];
  for (let at = 0; at < body.length; at += PIECE)
    parts.push(body.subarray(at, at + PIECE));
  return parts;
};

const once = () =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    let received = Buffer.alloc(0);
    const finish = () => {
      const head = received.toString('latin1').split('\r\n\r\n')[0] ?? '';
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(head);
      const connection = /\r\nconnection: *([^\r\n]*)/i.exec(head);
      resolve({
        status: status === null ? null : Number(status[1]),
        connection: connection?.[1]?.toLowerCase() ?? null,
      });
    };
    socket.on('data', (data) => {
      received = Buffer.concat([received, data]);
    });
    socket.on('error', () => {});
    socket.on('close', finish);
    socket.on('connect', async () => {
      for (const piece of pieces()) {
        const written = await new Promise((done) =>
          socket.write(piece, (error) => done(error == null)),
        );
        if (!written) break;
      }
    });
    setTimeout(() => socket.destroy(), 10_000).unref();
  });

const answers = [];
for (let i = 0; i < count; i++) {
  answers.push(await once());
}
process.stdout.write(`${JSON.stringify({ answers })}\n`);
