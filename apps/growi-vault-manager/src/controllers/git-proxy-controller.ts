/**
 * GitProxyController
 *
 * Implements the git smart HTTP lower-half for vault-manager:
 *
 *   GET  /internal/git/info/refs?service=git-upload-pack
 *     → spawns `git upload-pack --stateless-rpc --advertise-refs` and streams
 *       stdout as the HTTP response body (requirement 5.1).
 *
 *   POST /internal/git/git-upload-pack
 *     → spawns `git upload-pack --stateless-rpc`, pipes the request body into
 *       its stdin, and streams stdout as the HTTP response body (requirement 5.2).
 *
 * Both endpoints:
 * - Require the X-Vault-View-Ref header identifying the per-user view ref
 *   (passed as GIT_NAMESPACE to git so only the user's namespace is visible).
 * - Are protected by SharedSecretAuth (requirement 7.1).
 * - Stream stdout directly to the HTTP body without buffering
 *   (O(1) memory — requirement 5.3).
 * - Kill the git child process on client disconnect or error (requirement 5.5).
 */

import { pipeline } from 'node:stream/promises';
import { HeaderParams, Req, Res, UseBefore } from '@tsed/common';
import { Controller } from '@tsed/di';
import { AcceptMime, Get, Post } from '@tsed/schema';
import type { Request, Response } from 'express';

import { SharedSecretAuth } from '../middlewares/shared-secret-auth.js';
import { encodePktLine } from '../services/vault-pkt-line.js';
import { getRepoPath } from '../services/vault-repo-storage.js';
import {
  findUnsupportedFilters,
  PUBLISHED_SPARSE_FILTERS,
} from '../services/vault-sparse-filter.js';
import { spawnUploadPack } from '../services/vault-upload-pack-spawner.js';
import {
  findWantsOutsideView,
  peekWantSection,
} from '../services/vault-want-guard.js';

/** Header name that carries the per-user view ref name. */
const VIEW_REF_HEADER = 'x-vault-view-ref';

/**
 * Smart-HTTP service-advertisement header prepended to /info/refs responses.
 *
 * `git upload-pack --advertise-refs` does not emit this prefix; the HTTP layer
 * (normally `git-http-backend` CGI) is responsible for adding it. Without it
 * the client reports "fatal: invalid server response".
 *
 * Format (pkt-line):
 *   001e# service=git-upload-pack\n
 *   0000
 *
 * 0x001e = length of `# service=git-upload-pack\n` (26) + 4 length bytes = 30.
 */
const SERVICE_ADVERTISEMENT_PREFIX = Buffer.from(
  '001e# service=git-upload-pack\n0000',
  'utf8',
);

/**
 * Response sent instead of a pack when the client asks for an object its view
 * does not reach, or when the request head cannot be parsed.
 *
 * A pkt-line `ERR` with HTTP 200 is what upload-pack itself emits on refusal,
 * so the git client reports `fatal: remote error: <message>` rather than a
 * transport failure. The wording is deliberately the same for "not in your
 * view" and "does not exist", so the response reveals nothing about which
 * objects the repository holds (requirement 2.3).
 */
const REFUSAL_RESPONSE = encodePktLine(
  'ERR vault: requested object is not available in this view\n',
);

/** Response sent when the request head is not a protocol v0 want section. */
const MALFORMED_REQUEST_RESPONSE = encodePktLine(
  'ERR vault: malformed upload-pack request\n',
);

/**
 * Response sent when the client asks for a partial-clone filter this server does
 * not serve (requirement 5.9).
 *
 * Unlike the refusal above, this message is deliberately specific: it describes
 * what this server offers, not what the repository holds, and a client that is
 * told nothing here would instead see its clone succeed and its checkout fail
 * with a wall of per-object errors.
 */
const UNSUPPORTED_FILTER_RESPONSE = encodePktLine(
  'ERR vault: unsupported partial-clone filter; this server serves only --filter=sparse:oid=<published spec> (see the vault-manager README)\n',
);

@Controller('/internal/git')
@UseBefore(SharedSecretAuth)
export class GitProxyController {
  /**
   * Advertise refs for git clone / fetch negotiation.
   *
   * The git client sends this request first to discover what refs the server
   * exposes.  We spawn upload-pack in --advertise-refs mode and stream its
   * stdout back as the response body.
   *
   * Content-Type follows the git smart HTTP specification:
   * application/x-git-upload-pack-advertisement
   *
   * @param viewRef - Per-user view ref name from X-Vault-View-Ref header.
   * @param req     - Express request (used for client-disconnect detection).
   * @param res     - Express response (stdout is piped here).
   */
  @Get('/info/refs')
  @AcceptMime('application/x-git-upload-pack-advertisement')
  async advertiseRefs(
    @HeaderParams(VIEW_REF_HEADER) viewRef: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader(
      'Content-Type',
      'application/x-git-upload-pack-advertisement',
    );
    res.setHeader('Cache-Control', 'no-cache');

    const { stdout, stderr, exitCode, kill } = spawnUploadPack({
      mode: 'advertise',
      viewRef,
    });

    // Kill the child process when the client disconnects early.
    req.on('close', kill);

    stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[git-proxy advertise stderr] ${chunk.toString()}`);
    });

    // Prepend the smart-HTTP service-advertisement header that
    // `git upload-pack --advertise-refs` does not emit on its own.
    res.write(SERVICE_ADVERTISEMENT_PREFIX);

    try {
      await pipeline(stdout, res);
    } catch (err) {
      process.stderr.write(
        `[git-proxy advertise] pipeline error: ${(err as Error).message}\n`,
      );
    }

    const code = await exitCode;
    if (code !== 0) {
      process.stderr.write(
        `[git-proxy advertise] git upload-pack exited with code ${code}\n`,
      );
      if (!res.writableEnded) {
        res.status(502).end();
      }
    }
  }

  /**
   * Serve the pack for a git clone / fetch.
   *
   * The git client sends its want/have lines in the request body.  We pipe
   * that body into upload-pack's stdin and stream its stdout (the pack data)
   * back to the client.
   *
   * Content-Type follows the git smart HTTP specification:
   * application/x-git-upload-pack-result
   *
   * @param viewRef - Per-user view ref name from X-Vault-View-Ref header.
   * @param req     - Express request; body is piped to git stdin.
   * @param res     - Express response; git stdout is piped here.
   */
  @Post('/git-upload-pack')
  @AcceptMime('application/x-git-upload-pack-result')
  async uploadPack(
    @HeaderParams(VIEW_REF_HEADER) viewRef: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
    res.setHeader('Cache-Control', 'no-cache');

    // Authorise the client's wants before upload-pack runs (requirement 5.4).
    // git would serve any blob or tree in the shared object store here, whether
    // or not this view reaches it — see the vault-manager research.md.
    const peeked = await peekWantSection(req);
    if (peeked.status === 'invalid') {
      process.stderr.write(
        `[git-proxy upload-pack] refused a request that is not a v0 want section (view=${viewRef}): ${peeked.reason}\n`,
      );
      res.end(MALFORMED_REQUEST_RESPONSE);
      req.destroy();
      return;
    }

    // A filter this server does not serve is refused here rather than left to
    // fail the client's checkout later (requirement 5.9).
    const unsupportedFilters = findUnsupportedFilters(
      peeked.filters,
      PUBLISHED_SPARSE_FILTERS,
    );
    if (unsupportedFilters.length > 0) {
      process.stderr.write(
        `[git-proxy upload-pack] refused an unsupported filter (view=${viewRef}): ${unsupportedFilters.join(', ')}\n`,
      );
      res.end(UNSUPPORTED_FILTER_RESPONSE);
      req.destroy();
      return;
    }

    const deniedWants = await findWantsOutsideView({
      repoPath: getRepoPath(),
      viewRef,
      wants: peeked.wants,
    });
    if (deniedWants.length > 0) {
      process.stderr.write(
        `[git-proxy upload-pack] refused ${deniedWants.length} want(s) not reachable from the view (view=${viewRef}): ${deniedWants.join(', ')}\n`,
      );
      res.end(REFUSAL_RESPONSE);
      req.destroy();
      return;
    }

    const { stdout, stderr, exitCode, kill } = spawnUploadPack({
      mode: 'rpc',
      viewRef,
      // req itself is a Readable stream carrying the client's pack negotiation.
      stdin: req,
      // Replay the head that the guard already took off the stream.
      stdinPrefix: peeked.prefix,
    });

    // Kill the child process if the RESPONSE channel closes prematurely
    // (i.e. the upstream client disconnected before receiving the pack).
    // Do NOT listen on req.close: when req body is fully consumed Node.js
    // emits 'close' on req even though the response is still in flight,
    // which would kill git before it produces any output.
    res.on('close', kill);

    stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(
        `[git-proxy upload-pack stderr] ${chunk.toString()}`,
      );
    });

    try {
      await pipeline(stdout, res);
    } catch (err) {
      process.stderr.write(
        `[git-proxy upload-pack] pipeline error: ${(err as Error).message}\n`,
      );
    }

    const code = await exitCode;
    if (code !== 0) {
      process.stderr.write(
        `[git-proxy upload-pack] git upload-pack exited with code ${code}\n`,
      );
      if (!res.writableEnded) {
        res.status(502).end();
      }
    }
  }
}
