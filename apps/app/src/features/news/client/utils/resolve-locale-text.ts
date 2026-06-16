/**
 * Resolve a localized text from a locale-keyed map with fallback chain:
 * requested locale → ja_JP → en_US → first available key → ''.
 *
 * Shared by NewsItem (title) and NewsItemModal (title / body) so the
 * fallback behaviour stays identical across the list row and the detail modal.
 */
export const resolveLocaleText = (
  map: Record<string, string>,
  locale: string,
): string => {
  if (map[locale]) return map[locale];
  if (map.ja_JP) return map.ja_JP;
  if (map.en_US) return map.en_US;
  const keys = Object.keys(map);
  return keys.length > 0 ? map[keys[0]] : '';
};
