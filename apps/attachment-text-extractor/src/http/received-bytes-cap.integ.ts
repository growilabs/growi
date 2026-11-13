import { fakeRunner } from './spec-support/fake-runner';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './spec-support/multipart';
import { chunk, openConnection, requestHead } from './spec-support/raw-http';
import { useTestService } from './spec-support/test-service';

// Req 3.3: a body that declares no length is capped by the bytes that arrive
// (the file limit plus 64 KiB of framing), while it streams in. Refused at the
// cap, the answer names the request body; were only the file checked after
// the whole body was read, it would name the file instead (Python's
// FileTooLargeError texts, the same two).

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner, env: { MAX_FILE_SIZE_MB: '1' } };
});
const MIB = 1024 * 1024;

describe('a chunked body over the cap (MAX_FILE_SIZE_MB=1)', () => {
  it('is refused as a request body over the limit while it streams in', async () => {
    const connection = await openConnection(service.current().address);
    try {
      await connection.send(
        requestHead({
          token: service.current().token,
          contentType: multipartContentType(),
          chunked: true,
        }),
      );
      await connection.send(chunk(fileHead('a.txt')));
      for (let sent = 0; sent < 20 * MIB; sent += 64 * 1024) {
        if (!(await connection.send(chunk(Buffer.alloc(64 * 1024, 0x78)))))
          break;
      }
      await connection.send(
        Buffer.concat([chunk(bodyTail()), chunk(Buffer.alloc(0))]),
      );

      const answer = await connection.response(10_000);

      expect(answer?.status).toBe(413);
      expect(JSON.parse(answer?.text ?? '{}')).toEqual({
        code: 'file_too_large',
        message: 'Request body exceeds the 1 MiB file size limit',
      });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      connection.destroy();
    }
  });
});
