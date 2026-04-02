const MONGO_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Check if a string is a valid MongoDB ObjectID (24-char hex string).
 * Lightweight replacement for validator.isMongoId() to avoid pulling
 * the entire validator package (113 modules) into the client bundle.
 */
export const isMongoId = (value: string): boolean => {
  return MONGO_ID_PATTERN.test(value);
};
