export const SearchTypes = {
  FORWARD: 'forward',
  PARTIAL: 'partial',
  BACKWORD: 'backword',
} as const;

export type SearchType = (typeof SearchTypes)[keyof typeof SearchTypes];

export const PageActionOnGroupDelete = {
  publicize: 'publicize',
  delete: 'delete',
  transfer: 'transfer',
} as const;
export type PageActionOnGroupDelete =
  (typeof PageActionOnGroupDelete)[keyof typeof PageActionOnGroupDelete];
