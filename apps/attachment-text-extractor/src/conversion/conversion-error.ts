import type { FailureKind } from '../contract';

/** Thrown inside the conversion layer; only convert() turns it into an outcome. */
export class ConversionError extends Error {
  readonly kind: FailureKind;
  readonly detail: string;

  constructor(kind: FailureKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.detail = detail;
  }
}
