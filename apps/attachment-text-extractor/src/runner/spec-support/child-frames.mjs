// Blocking frame I/O for the small test children next to this file: they read
// the runner's two input frames from fd 0 and write one result to fd 3.
import { readSync, writeSync } from 'node:fs';

const INPUT_FD = 0;
const RESULT_FD = 3;

const readExact = (length) => {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    let read;
    try {
      read = readSync(INPUT_FD, buffer, filled, length - filled, null);
    } catch (error) {
      if (error.code === 'EAGAIN') {
        continue;
      }
      throw error;
    }
    if (read === 0) {
      throw new Error('input ended early');
    }
    filled += read;
  }
  return buffer;
};

const readFrame = () => readExact(readExact(4).readUInt32BE(0));

/** The header frame (ignored) and the file frame. */
export const readInputFile = () => {
  readFrame();
  return readFrame();
};

const writeAll = (data) => {
  let written = 0;
  while (written < data.length) {
    try {
      written += writeSync(RESULT_FD, data, written, data.length - written);
    } catch (error) {
      if (error.code !== 'EAGAIN') {
        throw error;
      }
    }
  }
};

export const sendSuccess = (content) => {
  const body = Buffer.from(
    JSON.stringify({
      ok: true,
      pages: [{ pageNumber: null, label: null, content }],
      mimeType: 'text/plain',
    }),
    'utf8',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  writeAll(header);
  writeAll(body);
};
