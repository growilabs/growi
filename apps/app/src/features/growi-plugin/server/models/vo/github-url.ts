import sanitize from 'sanitize-filename';

// https://regex101.com/r/fK2rV3/1
const githubReposIdPattern = new RegExp(/^\/([^/]+)\/([^/]+)$/);

// https://regex101.com/r/CQjSuz/1
const sanitizeSymbolsChars = new RegExp(/[^a-zA-Z0-9_.]+/g);
// https://regex101.com/r/ARgXvb/1
// GitHub will return a zip file with the v removed if the tag or branch name is "v + number"
const sanitizeVersionChars = new RegExp(/^v[\d]/gi);

export class GitHubUrl {
  private _organizationName: string;

  private _reposName: string;

  private _branchName: string;

  private _tagName: string;

  get organizationName(): string {
    return this._organizationName;
  }

  get reposName(): string {
    return this._reposName;
  }

  get branchName(): string {
    return this._branchName;
  }

  get tagName(): string {
    return this._tagName;
  }

  get archiveUrl(): string {
    const encodedBranchName = encodeURIComponent(this.branchName);
    const encodedTagName = encodeURIComponent(this.tagName);
    const zipUrl =
      encodedTagName !== ''
        ? `tags/${encodedTagName}`
        : `heads/${encodedBranchName}`;
    const ghUrl = new URL(
      `/${this.organizationName}/${this.reposName}/archive/refs/${zipUrl}.zip`,
      'https://github.com',
    );
    return ghUrl.toString();
  }

  get extractedArchiveDirName(): string {
    const name = this._tagName !== '' ? this._tagName : this._branchName;
    return name
      .replace(sanitizeVersionChars, (m) => m.substring(1))
      .replaceAll(sanitizeSymbolsChars, '-');
  }

  constructor(url: string, branchName = 'main', tagName = '') {
    let matched: RegExpMatchArray | null;
    try {
      const ghUrl = new URL(url);

      matched = ghUrl.pathname.match(githubReposIdPattern);

      if (ghUrl.hostname !== 'github.com' || matched == null) {
        throw new Error();
      }
    } catch (err) {
      throw new Error(`The specified URL is invalid. : url='${url}'`);
    }

    this._branchName = branchName;
    this._tagName = tagName;

    this._organizationName = sanitize(matched[1]);
    this._reposName = sanitize(matched[2]);
  }
}
