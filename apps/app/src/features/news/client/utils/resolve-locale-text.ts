/**
 * Resolve a localized text from a locale-keyed map with fallback chain:
 * requested locale → ja_JP → en_US → first available key → ''.
 *
 * Shared by NewsItem (title in the sidebar panel) and NewsFeed
 * (title / body on the full-page feed) so the fallback behaviour stays
 * identical across both surfaces.
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
