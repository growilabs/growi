import type { FailureKind } from './failure-kind';

export interface PageInfo {
  readonly pageNumber: number | null;
  readonly label: string | null;
  readonly content: string;
}

export type ConversionOutcome =
  | {
      readonly kind: 'ok';
      readonly mimeType: string;
      readonly pages: readonly PageInfo[];
    }
  | {
      readonly kind: 'failed';
      readonly failure: FailureKind;
      readonly detail: string;
    };
