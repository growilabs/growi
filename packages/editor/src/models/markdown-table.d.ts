export declare class MarkdownTable {
  static fromHTMLTableTag(str: any): MarkdownTable;

  static fromDSV(str: any, delimiter: any): MarkdownTable;

  static fromMarkdownString(str: string): MarkdownTable;

  constructor(table: any, options: any);

  table: any;

  options: any;

  toString(): any;

  clone(): MarkdownTable;

  normalizeCells(): MarkdownTable;
}
