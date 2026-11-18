/**
 * Why a page operation (duplicate, rename, ...) was refused for a reason the
 * requester can act on, as opposed to an unexpected failure.
 */
export const PageOperationRefusalReason = {
  GRANT_NOT_ASSIGNABLE: 'grant_not_assignable',
  OPERATION_IN_PROGRESS: 'operation_in_progress',
} as const;
export type PageOperationRefusalReason =
  (typeof PageOperationRefusalReason)[keyof typeof PageOperationRefusalReason];

export class PageOperationRefusedError extends Error {
  readonly reason: PageOperationRefusalReason;

  constructor(reason: PageOperationRefusalReason, message: string) {
    super(message);
    this.name = 'PageOperationRefusedError';
    this.reason = reason;
  }
}
