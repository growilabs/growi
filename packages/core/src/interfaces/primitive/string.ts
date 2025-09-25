/**
 * A branded type representing a string that is guaranteed to be non-empty (length > 0).
 * This type allows distinguishing non-empty strings from regular strings at compile time.
 */
export type NonEmptyString = string & { readonly __brand: unique symbol };

/**
 * Checks if a value is a non-empty string.
 * @param value - The value to check
 * @returns True if the value is a string with length > 0, false otherwise
 */
export const isNonEmptyString = (
  value: string | null | undefined,
): value is NonEmptyString => {
  return value != null && value.length > 0;
};

/**
 * Converts a string to NonEmptyString type.
 * @param value - The string to convert
 * @returns The string as NonEmptyString type
 * @throws Error if the value is null, undefined, or empty string
 */
export const toNonEmptyString = (value: string): NonEmptyString => {
  // throw Error if the value is null, undefined or empty
  if (!isNonEmptyString(value))
    throw new Error(`Expected a non-empty string, but received: ${value}`);
  return value;
};

/**
 * Converts a string to NonEmptyString type or returns undefined.
 * @param value - The string to convert
 * @returns The string as NonEmptyString type, or undefined if the value is null, undefined, or empty
 */
export const toNonEmptyStringOrUndefined = (
  value: string | null | undefined,
): NonEmptyString | undefined => {
  // return undefined if the value is null, undefined or empty
  if (!isNonEmptyString(value)) return undefined;
  return value;
};

/**
 * A branded type representing a string that is guaranteed to be non-blank.
 * A non-blank string contains at least one non-whitespace character.
 * This type allows distinguishing non-blank strings from regular strings at compile time.
 */
export type NonBlankString = string & { readonly __brand: unique symbol };

/**
 * Checks if a value is a non-blank string.
 * A non-blank string is a string that contains at least one non-whitespace character.
 * @param value - The value to check
 * @returns True if the value is a string with trimmed length > 0, false otherwise
 */
export const isNonBlankString = (
  value: string | null | undefined,
): value is NonBlankString => {
  return value != null && value.trim().length > 0;
};

/**
 * Converts a string to NonBlankString type.
 * @param value - The string to convert
 * @returns The string as NonBlankString type
 * @throws Error if the value is null, undefined, empty string, or contains only whitespace characters
 */
export const toNonBlankString = (value: string): NonBlankString => {
  // throw Error if the value is null, undefined or empty
  if (!isNonBlankString(value))
    throw new Error(`Expected a non-blank string, but received: ${value}`);
  return value;
};

/**
 * Converts a string to NonBlankString type or returns undefined.
 * @param value - The string to convert
 * @returns The string as NonBlankString type, or undefined if the value is null, undefined, empty, or contains only whitespace characters
 */
export const toNonBlankStringOrUndefined = (
  value: string | null | undefined,
): NonBlankString | undefined => {
  // return undefined if the value is null, undefined or blank (empty or whitespace only)
  if (!isNonBlankString(value)) return undefined;
  return value;
};
