import * as pathUtils from '../utils/path-utils';

// https://regex101.com/r/BahpKX/2
const PATTERN_INCLUDE_DATE =
  /^(.+\/[^/]+)\/(\d{4}|\d{4}\/\d{2}|\d{4}\/\d{2}\/\d{2})$/;

export class DevidedPagePath {
  isRoot: boolean;

  isFormerRoot: boolean;

  former: string;

  latter: string;

  constructor(path: string, skipNormalize = false, evalDatePath = false) {
    this.isRoot = false;
    this.isFormerRoot = false;
    this.former = '';

    // root
    if (path == null || path === '' || path === '/') {
      this.isRoot = true;
      this.latter = '/';
      return;
    }

    const pagePath = skipNormalize ? path : pathUtils.normalizePath(path);
    this.latter = pagePath;

    // evaluate date path
    if (evalDatePath) {
      const matchDate = pagePath.match(PATTERN_INCLUDE_DATE);
      if (matchDate != null) {
        this.former = matchDate[1];
        this.latter = matchDate[2];
        return;
      }
    }

    let PATTERN_DEFAULT = /^((.*)\/(?!em>))?(.+)$/; // this will ignore em's end tags
    try {
      // for non-chrome browsers
      // biome-ignore lint/complexity/useRegexLiterals: ignore
      PATTERN_DEFAULT = new RegExp('^((.*)(?<!<)\\/)?(.+)$'); // https://regex101.com/r/HJNvMW/1
    } catch {
      // lookbehind regex is not supported on non-chrome browsers
    }

    const matchDefault = pagePath.match(PATTERN_DEFAULT);
    if (matchDefault != null) {
      this.isFormerRoot = matchDefault[1] === '/';
      this.former = matchDefault[2];
      this.latter = matchDefault[3];
    }
  }
}
