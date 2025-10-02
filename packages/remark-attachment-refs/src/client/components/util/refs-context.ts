const GRID_DEFAULT_TRACK_WIDTH = 64;
const GRID_AVAILABLE_OPTIONS_LIST = [
  'autofill',
  'autofill-xs',
  'autofill-sm',
  'autofill-md',
  'autofill-lg',
  'autofill-xl',
  'col-2',
  'col-3',
  'col-4',
  'col-5',
  'col-6',
];

type tags = 'ref' | 'refs' | 'refimg' | 'refsimg';

/**
 * Context Object class for $ref() and $refimg()
 */
export class RefsContext {
  tag: tags;

  pagePath: string;

  options?: Record<string, string | undefined>;

  constructor(
    tag: tags,
    pagePath: string,
    options: Record<string, string | undefined>,
  ) {
    this.tag = tag;

    this.pagePath = pagePath;

    // remove undefined keys
    for (const key of Object.keys(options)) {
      if (options[key] === undefined) {
        delete options[key];
      }
    }

    this.options = options;
  }

  getStringifiedAttributes(separator = ', '): string {
    const attributeStrs = [`page=${this.pagePath}`];
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
    return `$${this.tag}(${this.getStringifiedAttributes()})`;
  }

  get isSingle(): boolean {
    return this.tag === 'ref' || this.tag === 'refimg';
  }

  get isExtractImage(): boolean {
    return this.tag === 'refimg' || this.tag === 'refsimg';
  }

  getOptGrid(): string | undefined {
    return GRID_AVAILABLE_OPTIONS_LIST.find(
      (item) => item === this.options?.grid,
    );
  }

  isOptGridColumnEnabled(): boolean {
    const optGrid = this.getOptGrid();
    return optGrid?.startsWith('col-') ?? false;
  }

  /**
   * return auto-calculated grid width
   * rules:
   *  1. when column mode (e.g. col-6, col5, ...), the width specification is disabled
   *  2. when width option is set, return it
   *  3. otherwise, the mode should be autofill and the width will be calculated according to the size
   */
  getOptGridWidth(): string | undefined {
    const grid = this.getOptGrid();
    const width = this.options?.width;

    // when Grid column mode
    if (this.isOptGridColumnEnabled()) {
      // not specify and ignore width
      return undefined;
    }

    // when width is specified
    if (width != null) {
      return width;
    }

    // when Grid autofill mode
    let autofillMagnification = 1;

    switch (grid) {
      case 'autofill-xl':
        autofillMagnification = 3;
        break;
      case 'autofill-lg':
        autofillMagnification = 2;
        break;
      case 'autofill-sm':
        autofillMagnification = 0.75;
        break;
      case 'autofill-xs':
        autofillMagnification = 0.5;
        break;
      case 'autofill':
      case 'autofill-md':
        break;
    }

    return `${GRID_DEFAULT_TRACK_WIDTH * autofillMagnification}px`;
  }

  /**
   * return auto-calculated grid height
   * rules:
   *  1. when height option is set, return it
   *  2. otherwise, the same value to the width will be returned
   */

  getOptGridHeight(): string | undefined {
    const height = this.options?.height;

    // when height is specified
    if (height != null) {
      return height;
    }

    // return the value which is same to width
    return this.getOptGridWidth();
  }

  getOptGridColumnsNum(): number | null {
    let columnsNum: number | null = null;

    switch (this.options?.grid) {
      case 'col-2':
        columnsNum = 2;
        break;
      case 'col-3':
        columnsNum = 3;
        break;
      case 'col-4':
        columnsNum = 4;
        break;
      case 'col-5':
        columnsNum = 5;
        break;
      case 'col-6':
        columnsNum = 6;
        break;
    }

    return columnsNum;
  }
}
