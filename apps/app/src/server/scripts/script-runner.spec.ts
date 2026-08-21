/**
 * Unit test for the standalone-script helpers.
 *
 * Contract under test: `redactMongoUri()` produces a line an admin can use to
 * confirm WHICH database a destructive script is about to rewrite (scheme, host
 * set, db name) while never revealing a credential — neither the userinfo nor
 * anything hidden in the connection options.
 */
import type { Logger } from '@growi/logger';
import type { MockInstance } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { exitAfterLogFlush, redactMongoUri } from './script-runner';

describe('redactMongoUri', () => {
  it('keeps the host and database of a plain URI', () => {
    expect(redactMongoUri('mongodb://mongo:27017/growi')).toBe(
      'mongodb://mongo:27017/growi',
    );
  });

  it('keeps the host and database of the silent default', () => {
    // The fallback getMongoUri() uses when no MONGO*_URI env var is set — the
    // whole reason the target is logged at all.
    expect(redactMongoUri('mongodb://mongo/growi')).toBe(
      'mongodb://mongo/growi',
    );
  });

  it('drops the username and password', () => {
    expect(
      redactMongoUri('mongodb://admin:s3cr3t@mongo:27017/growi'),
    ).not.toContain('s3cr3t');
    expect(redactMongoUri('mongodb://admin:s3cr3t@mongo:27017/growi')).toBe(
      'mongodb://mongo:27017/growi',
    );
  });

  it('drops the whole option string, which can itself carry secrets', () => {
    const redacted = redactMongoUri(
      'mongodb://admin:s3cr3t@mongo:27017/growi?replicaSet=rs0&tlsCertificateKeyFilePassword=p4ss',
    );
    expect(redacted).toBe('mongodb://mongo:27017/growi');
    expect(redacted).not.toContain('p4ss');
  });

  it('keeps every host of a replica-set URI so the target is unambiguous', () => {
    expect(
      redactMongoUri(
        'mongodb://u:p@mongo-a:27017,mongo-b:27017,mongo-c:27017/growi?replicaSet=rs0',
      ),
    ).toBe('mongodb://mongo-a:27017,mongo-b:27017,mongo-c:27017/growi');
  });

  it('handles mongodb+srv URIs', () => {
    expect(redactMongoUri('mongodb+srv://u:p@cluster0.example.net/growi')).toBe(
      'mongodb+srv://cluster0.example.net/growi',
    );
  });

  it('reports the host when the URI names no database', () => {
    expect(redactMongoUri('mongodb://mongo:27017')).toBe(
      'mongodb://mongo:27017',
    );
  });

  it('withholds everything rather than leak part of an un-encoded password', () => {
    // A '/' inside the credentials must be percent-encoded; when it is not, the
    // authority cannot be located, so nothing is shown.
    expect(redactMongoUri('mongodb://admin:pa/ss@mongo:27017/growi')).toBe(
      '(unparsable mongodb uri)',
    );
  });

  it('withholds everything rather than leak part of a password containing an un-encoded "?"', () => {
    // A '?' inside the credentials must be percent-encoded too. When it is not,
    // it looks like the start of the option string, so cutting the options off
    // first would leave the password PREFIX standing in for the host.
    const redacted = redactMongoUri(
      'mongodb://admin:p4ss?word@mongo:27017/growi',
    );
    expect(redacted).not.toContain('p4ss');
    expect(redacted).not.toContain('admin');
    expect(redacted).toBe('(unparsable mongodb uri)');
  });

  it('withholds everything when an un-encoded "?" precedes an un-encoded "/" in the password', () => {
    const redacted = redactMongoUri(
      'mongodb://admin:p4?ss/word@mongo:27017/growi',
    );
    expect(redacted).not.toContain('p4');
    expect(redacted).toBe('(unparsable mongodb uri)');
  });

  it('keeps the host when the password contains a properly placed "@"', () => {
    // The userinfo ends at the LAST '@' before the authority delimiter, so a
    // literal '@' earlier in the password must not shift the host detection.
    const redacted = redactMongoUri('mongodb://admin:p@ss@mongo:27017/growi');
    expect(redacted).toBe('mongodb://mongo:27017/growi');
    expect(redacted).not.toContain('p@ss');
  });

  it('keeps the host when the URI names no database but carries options', () => {
    expect(
      redactMongoUri('mongodb://admin:s3cr3t@mongo:27017/?authSource=admin'),
    ).toBe('mongodb://mongo:27017');
  });

  it('keeps an IPv6 host', () => {
    expect(redactMongoUri('mongodb://u:p@[::1]:27017/growi')).toBe(
      'mongodb://[::1]:27017/growi',
    );
  });

  it('withholds an empty string', () => {
    expect(redactMongoUri('')).toBe('(unparsable mongodb uri)');
  });

  it('withholds a string that is not a URI at all', () => {
    expect(redactMongoUri('not-a-uri')).toBe('(unparsable mongodb uri)');
  });
});

describe('exitAfterLogFlush', () => {
  // The scripts bootstrap Crowi (cron, socket.io, S2S), so nothing else ends the
  // process — this helper is their only exit path. It has to flush first because
  // the logger writes through a pino transport worker: a bare process.exit()
  // truncates the very abort/result line the admin needs.
  let exitSpy: MockInstance<(code?: number) => never>;

  beforeEach(() => {
    vi.useFakeTimers();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('flushes the logger before exiting', () => {
    const logger = mock<Logger>();

    exitAfterLogFlush(logger, 0, 10);

    expect(logger.flush).toHaveBeenCalledOnce();
    // Still inside the grace period: the transport has not been given its window.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with the given code once the grace period elapses', () => {
    const logger = mock<Logger>();

    exitAfterLogFlush(logger, 1, 10);
    vi.advanceTimersByTime(10);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('passes a success code through unchanged', () => {
    const logger = mock<Logger>();

    exitAfterLogFlush(logger, 0, 10);
    vi.advanceTimersByTime(10);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
