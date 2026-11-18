/** One element of the `pages[]` that `POST /extract` returns. */
export interface ExtractedPage {
  readonly pageNumber: number | null;
  readonly label: string | null;
  readonly content: string;
}

/** What one `POST /extract` call came to: the pages, or why it failed. */
export type ExtractOutcome =
  | { readonly ok: true; readonly pages: readonly ExtractedPage[] }
  | { readonly ok: false; readonly reason: string };
