export type EmojiEntry = { skins: { native: string }[] };

export type EmojiData = {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, EmojiEntry>;
  aliases?: Record<string, string>;
};

export type NativeLookup = Record<
  string,
  { skins: readonly [{ native: string }, ...{ native: string }[]] }
>;

export const EMOJI_CATEGORIES = [
  'people',
  'nature',
  'foods',
  'activity',
  'places',
  'objects',
  'symbols',
  'flags',
] as const;

// Build lookup in category order so consumers get UX-friendly suggestion order.
// Emojis that support skin tones keep all 6 variants (default + skin-tone-2..6).
export const buildLookup = (raw: EmojiData): NativeLookup => {
  const lookup: NativeLookup = {};
  for (const catId of EMOJI_CATEGORIES) {
    const cat = raw.categories.find((c) => c.id === catId);
    if (!cat) continue;
    for (const name of cat.emojis) {
      const [first, ...rest] = raw.emojis[name]?.skins ?? [];
      if (first?.native) {
        lookup[name] = {
          skins: [
            { native: first.native },
            ...rest.map(({ native }) => ({ native })),
          ],
        };
      }
    }
  }
  return lookup;
};

// Alias -> canonical id, restricted to targets present in the lookup.
export const buildAliases = (
  raw: EmojiData,
  lookup: NativeLookup,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(raw.aliases ?? {}).filter(([, id]) => id in lookup),
  );
