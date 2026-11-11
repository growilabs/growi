import { ExtensibleCustomError } from '~/server/util/extensible-custom-error';

export class PathAlreadyExistsError extends ExtensibleCustomError {
  targetPath: string;

  constructor(message: string, targetPath: string) {
    super(message);
    this.targetPath = targetPath;
  }
}

/*
 * User Authentication
 */
export class NullUsernameToBeRegisteredError extends ExtensibleCustomError {}

// Invalid Parent bookmark folder error
export class InvalidParentBookmarkFolderError extends ExtensibleCustomError {}

export class BookmarkFolderNotFoundError extends ExtensibleCustomError {}
export class BookmarkFolderForbiddenError extends ExtensibleCustomError {}

// The page's latest revision moved away from the one the writer expected.
export class RevisionConflictError extends ExtensibleCustomError {
  pageId: string;

  expectedRevisionId: string;

  constructor(pageId: string, expectedRevisionId: string) {
    super(
      `The latest revision of page '${pageId}' is no longer '${expectedRevisionId}'`,
    );
    this.pageId = pageId;
    this.expectedRevisionId = expectedRevisionId;
  }
}
