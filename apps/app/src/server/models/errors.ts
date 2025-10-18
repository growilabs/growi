import ExtensibleCustomError from 'extensible-custom-error';

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
