export declare class MarkdownTable {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static fromHTMLTableTag(str: any): MarkdownTable;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static fromDSV(str: any, delimiter: any): MarkdownTable;

  static fromMarkdownString(str: string): MarkdownTable;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(table: any, options: any);

  table: any;

  options: any;

  toString(): any;

  clone(): MarkdownTable;

  normalizeCells(): MarkdownTable;
}
