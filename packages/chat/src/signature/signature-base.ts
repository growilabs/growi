// The RFC 9421 section 2.5 "signature base": the string that is actually
// signed and, on the other side, rebuilt to check the signature against.

import { serializeStringInnerList } from './structured-fields.js';

/** The value of a signature parameter: an RFC 8941 Integer or String. */
export type SignatureParamValue = number | string;

/**
 * The signature parameters (`created` / `expires` / `nonce` / `keyid` /
 * `alg`), in the order they are serialized.
 *
 * The order is the caller's, not this module's: the verifying side has to
 * rebuild the base from the parameters it parsed out of the incoming
 * `Signature-Input` header, and re-serializing those in an order of our own
 * would reject every peer that happens to serialize them differently.
 */
export type SignatureParams = ReadonlyMap<string, SignatureParamValue>;

/** The message the covered components are read from. */
export interface SignatureBaseMessage {
  /** Used for the `@method` derived component; emitted uppercased. */
  readonly method: string;
  /** Header field values, keyed by header name in any case. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Values for derived components other than `@method`, keyed by their
   * `@`-prefixed identifier.
   *
   * This exists so the RFC's own published test vectors -- which cover
   * `@authority` and `@path` -- can be reproduced in tests. Production code in
   * this package supplies none: `COVERED_COMPONENTS` deliberately covers
   * no component that carries the destination URL or path.
   */
  readonly derivedComponents?: Readonly<Record<string, string>>;
}

const SIGNATURE_PARAMS_COMPONENT = '@signature-params';

const METHOD_COMPONENT = '@method';

const resolveComponentValue = (
  component: string,
  message: SignatureBaseMessage,
): string => {
  if (component === METHOD_COMPONENT) {
    return message.method.toUpperCase();
  }

  if (component.startsWith('@')) {
    const value = message.derivedComponents?.[component];
    if (value == null) {
      throw new Error(
        `Cannot build the signature base: the covered derived component "${component}" has no value`,
      );
    }
    return value;
  }

  // Header names are case-insensitive, so the message may spell them any way.
  const entry = Object.entries(message.headers).find(
    ([name]) => name.toLowerCase() === component,
  );
  if (entry == null) {
    throw new Error(
      `Cannot build the signature base: the covered header field "${component}" is absent from the message`,
    );
  }
  // RFC 9421 section 2.1: leading and trailing whitespace is not part of the
  // field value.
  return entry[1].trim();
};

/**
 * Builds the RFC 9421 section 2.5 signature base.
 *
 * `coveredComponents` is a **parameter**, not something this module picks for
 * itself: the declaration lives in `covered-components.ts` and the signing and
 * verifying sides pass it in. That is what lets the tests run this function
 * against the RFC's own vectors, whose component lists differ from this
 * package's (`.claude/rules/coding-style.md`, "Executors Take Their Work-Set
 * as Input").
 *
 * The result carries no trailing newline (RFC 9421 section 2.5).
 *
 * @throws if a covered component has no value in the message, if the same
 * component is covered twice, or if `@signature-params` is listed -- RFC 9421
 * requires the construction to fail rather than sign a partial message.
 */
export const buildSignatureBase = (
  coveredComponents: readonly string[],
  message: SignatureBaseMessage,
  signatureParams: SignatureParams,
): string => {
  const identifiers = coveredComponents.map((component) =>
    component.toLowerCase(),
  );

  const seen = new Set<string>();
  for (const identifier of identifiers) {
    if (identifier === SIGNATURE_PARAMS_COMPONENT) {
      throw new Error(
        `Cannot build the signature base: "${SIGNATURE_PARAMS_COMPONENT}" is always covered and must not be listed as a component`,
      );
    }
    if (seen.has(identifier)) {
      throw new Error(
        `Cannot build the signature base: the component "${identifier}" is covered more than once`,
      );
    }
    seen.add(identifier);
  }

  const componentLines = identifiers.map(
    (identifier) =>
      `"${identifier}": ${resolveComponentValue(identifier, message)}`,
  );

  const paramsLine = `"${SIGNATURE_PARAMS_COMPONENT}": ${serializeStringInnerList(
    identifiers,
    signatureParams,
  )}`;

  return [...componentLines, paramsLine].join('\n');
};
