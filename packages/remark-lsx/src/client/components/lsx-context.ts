import {
  OptionParser,
  type ParseRangeResult,
} from '@growi/core/dist/remark-plugins';

export class LsxContext {
  pagePath: string;

  options?: Record<string, string | undefined>;

  constructor(pagePath: string, options: Record<string, string | undefined>) {
    this.pagePath = pagePath;

    // remove undefined keys
    for (const key in options) {
      options[key] === undefined && delete options[key];
    }

    this.options = options;
  }

  getOptDepth(): ParseRangeResult | null {
    if (this.options?.depth == null) {
      return null;
    }
    return OptionParser.parseRange(this.options.depth);
  }

  getStringifiedAttributes(separator = ', '): string {
    const attributeStrs = [`prefix=${this.pagePath}`];
    if (this.options != null) {
      const optionEntries = Object.entries(this.options).sort();
      attributeStrs.push(
        ...optionEntries.map(([key, val]) => `${key}=${val || 'true'}`),
      );
    }

    return attributeStrs.join(separator);
  }

  /**
   * for printing errors
   * @returns
   */
  toString(): string {
    return `$lsx(${this.getStringifiedAttributes()})`;
  }
}
