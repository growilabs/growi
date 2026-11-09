export type Route = 'pdf' | 'pptx' | 'xlsx' | 'office' | 'text';

export type AnydocFormat =
  | 'doc'
  | 'docx'
  | 'odt'
  | 'ppt'
  | 'pptx'
  | 'rtf'
  | 'epub'
  | 'xlsx'
  | 'ods'
  | 'odp'
  | 'csv';

export type TextKind = 'plain' | 'html' | 'xml' | 'ipynb' | 'csv';

export interface ResolvedFormat {
  readonly route: Route;
  readonly mimeType: string;
  readonly anydocFormat: AnydocFormat | null;
  readonly textKind: TextKind | null;
}

/** null means the format is not supported. */
export const resolveFormat = (
  _fileName: string,
  _mimeHint: string | null,
): ResolvedFormat | null => {
  throw new Error('not implemented: formats/format-table.resolveFormat');
};
