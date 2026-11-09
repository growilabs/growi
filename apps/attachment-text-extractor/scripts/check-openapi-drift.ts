/** JSON Pointers where `actual` differs from `committed`, annotation descriptions aside. */
export const openApiDrift = (
  _actual: unknown,
  _committed: unknown,
): readonly string[] => {
  throw new Error('not implemented: scripts/check-openapi-drift.openApiDrift');
};
