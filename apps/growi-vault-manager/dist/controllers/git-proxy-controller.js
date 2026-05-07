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

import { HeaderParams, Req, Res, UseBefore } from '@tsed/common';
import { Controller } from '@tsed/di';
import { Get, Post } from '@tsed/schema';
import { __decorate, __metadata, __param } from 'tslib';

import { SharedSecretAuth } from '../middlewares/shared-secret-auth.js';
import { spawnUploadPack } from '../services/vault-upload-pack-spawner.js';

/** Header name that carries the per-user view ref name. */
const VIEW_REF_HEADER = 'x-vault-view-ref';
let GitProxyController = class GitProxyController {
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
  advertiseRefs(viewRef, req, res) {
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
    stderr.on('data', (chunk) => {
      process.stderr.write(`[git-proxy advertise stderr] ${chunk.toString()}`);
    });
    stdout.pipe(res);
    exitCode.then((code) => {
      if (code !== 0) {
        process.stderr.write(
          `[git-proxy advertise] git upload-pack exited with code ${code}\n`,
        );
        // The response may already be partially written; end it to signal EOF.
        if (!res.writableEnded) {
          res.status(502).end();
        }
      }
    });
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
  uploadPack(viewRef, req, res) {
    res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    const { stdout, stderr, exitCode, kill } = spawnUploadPack({
      mode: 'rpc',
      viewRef,
      // req itself is a Readable stream carrying the client's pack negotiation.
      stdin: req,
    });
    // Kill the child process when the client disconnects early.
    req.on('close', kill);
    stderr.on('data', (chunk) => {
      process.stderr.write(
        `[git-proxy upload-pack stderr] ${chunk.toString()}`,
      );
    });
    stdout.pipe(res);
    exitCode.then((code) => {
      if (code !== 0) {
        process.stderr.write(
          `[git-proxy upload-pack] git upload-pack exited with code ${code}\n`,
        );
        if (!res.writableEnded) {
          res.status(502).end();
        }
      }
    });
  }
};
__decorate(
  [
    Get('/info/refs'),
    __param(0, HeaderParams(VIEW_REF_HEADER)),
    __param(1, Req()),
    __param(2, Res()),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [String, Object, Object]),
    __metadata('design:returntype', void 0),
  ],
  GitProxyController.prototype,
  'advertiseRefs',
  null,
);
__decorate(
  [
    Post('/git-upload-pack'),
    __param(0, HeaderParams(VIEW_REF_HEADER)),
    __param(1, Req()),
    __param(2, Res()),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [String, Object, Object]),
    __metadata('design:returntype', void 0),
  ],
  GitProxyController.prototype,
  'uploadPack',
  null,
);
GitProxyController = __decorate(
  [Controller('/internal/git'), UseBefore(SharedSecretAuth)],
  GitProxyController,
);

export { GitProxyController };
//# sourceMappingURL=git-proxy-controller.js.map
