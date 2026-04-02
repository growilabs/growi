import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import bunyanFormat from './bunyan-format';

function createWithCapture(opts: { singleLine?: boolean } = {}) {
  const dest = new PassThrough();
  const chunks: string[] = [];
  dest.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const stream = bunyanFormat({ ...opts, colorize: false, destination: dest });
  return { stream, chunks };
}

function writeLine(
  stream: NodeJS.WritableStream,
  log: Record<string, unknown>,
) {
  stream.write(`${JSON.stringify(log)}\n`);
}

describe('bunyan-format transport', () => {
  it('returns a writable stream', () => {
    const { stream } = createWithCapture();
    expect(stream).toBeDefined();
    expect(stream).toBeInstanceOf(Writable);
  });

  it('formats log output as HH:mm:ss.SSSZ LEVEL name: message', async () => {
    const { stream, chunks } = createWithCapture({ singleLine: true });

    writeLine(stream, {
      level: 20,
      time: new Date('2026-03-30T10:06:30.419Z').getTime(),
      name: 'growi:service:page',
      msg: 'some message',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = chunks.join('');
    expect(output).toBe(
      '10:06:30.419Z DEBUG growi:service:page: some message\n',
    );
  });

  it('right-aligns level labels to 5 characters', async () => {
    const { stream, chunks } = createWithCapture({ singleLine: true });

    writeLine(stream, {
      level: 30,
      time: Date.now(),
      name: 'test',
      msg: 'info',
    });
    writeLine(stream, {
      level: 40,
      time: Date.now(),
      name: 'test',
      msg: 'warn',
    });
    writeLine(stream, {
      level: 10,
      time: Date.now(),
      name: 'test',
      msg: 'trace',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = chunks.join('');
    expect(output).toContain(' INFO test:');
    expect(output).toContain(' WARN test:');
    expect(output).toContain('TRACE test:');
  });

  it('appends extra fields on a new line when singleLine is false', async () => {
    const { stream, chunks } = createWithCapture({ singleLine: false });

    writeLine(stream, {
      level: 20,
      time: Date.now(),
      name: 'test',
      msg: 'hello',
      extra: 'value',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = chunks.join('');
    expect(output).toContain('hello');
    expect(output).toContain('\n    {"extra":"value"}');
  });

  it('appends extra fields inline when singleLine is true', async () => {
    const { stream, chunks } = createWithCapture({ singleLine: true });

    writeLine(stream, {
      level: 30,
      time: Date.now(),
      name: 'test',
      msg: 'hello',
      extra: 'value',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = chunks.join('');
    expect(output).toContain('hello {"extra":"value"}');
  });

  it('excludes pid and hostname from extra fields', async () => {
    const { stream, chunks } = createWithCapture({ singleLine: true });

    writeLine(stream, {
      level: 30,
      time: Date.now(),
      name: 'test',
      msg: 'hello',
      pid: 12345,
      hostname: 'myhost',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = chunks.join('');
    expect(output).not.toContain('pid');
    expect(output).not.toContain('hostname');
  });
});
