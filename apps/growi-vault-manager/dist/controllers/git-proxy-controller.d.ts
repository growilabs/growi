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
import type { Request, Response } from 'express';
export declare class GitProxyController {
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
  advertiseRefs(viewRef: string, req: Request, res: Response): void;
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
  uploadPack(viewRef: string, req: Request, res: Response): void;
}
