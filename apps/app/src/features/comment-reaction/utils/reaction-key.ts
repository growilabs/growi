import emojiNativeLookup, { aliases } from '@growi/emoji-mart-data';

import type {
  ParsedReactionKey,
  ReactionKey,
  ReactionKeyError,
  Result,
  SkinTone,
} from '../interfaces';

const SUPPORTED_NAMESPACE = 'unicode';
const SKIN_TONE_SEPARATOR = '::';
const SKIN_TONE_SUFFIX_PATTERN = /^skin-tone-([2-6])$/;
const SKIN_TONE_VARIANT_COUNT = 6;

type KeyStructure = {
  readonly namespace: string;
  readonly shortcode: string;
  readonly skinTone: SkinTone | null;
};

const malformed = (): Result<never, ReactionKeyError> => ({
  ok: false,
  error: { kind: 'malformed' },
});

const toSkinTone = (value: number): SkinTone | null =>
  value >= 2 && value <= 6 ? (value as SkinTone) : null;

const parseStructure = (
  input: string,
): Result<KeyStructure, ReactionKeyError> => {
  const namespaceEnd = input.indexOf(':');
  if (namespaceEnd <= 0) {
    return malformed();
  }
  const namespace = input.slice(0, namespaceEnd);
  const rest = input.slice(namespaceEnd + 1);

  const separatorAt = rest.indexOf(SKIN_TONE_SEPARATOR);
  const shortcode = separatorAt < 0 ? rest : rest.slice(0, separatorAt);
  if (shortcode === '' || shortcode.includes(':')) {
    return malformed();
  }
  if (separatorAt < 0) {
    return { ok: true, value: { namespace, shortcode, skinTone: null } };
  }

  const suffix = rest.slice(separatorAt + SKIN_TONE_SEPARATOR.length);
  const match = SKIN_TONE_SUFFIX_PATTERN.exec(suffix);
  const skinTone = match == null ? null : toSkinTone(Number(match[1]));
  if (skinTone == null) {
    return malformed();
  }
  return { ok: true, value: { namespace, shortcode, skinTone } };
};

const resolveCanonicalId = (shortcode: string): string | null => {
  if (Object.hasOwn(emojiNativeLookup, shortcode)) {
    return shortcode;
  }
  if (Object.hasOwn(aliases, shortcode)) {
    const canonical = aliases[shortcode];
    return Object.hasOwn(emojiNativeLookup, canonical) ? canonical : null;
  }
  return null;
};

const buildKey = (
  shortcode: string,
  skinTone: SkinTone | null,
): ReactionKey => {
  const suffix =
    skinTone == null ? '' : `${SKIN_TONE_SEPARATOR}skin-tone-${skinTone}`;
  // The only place a ReactionKey is minted: callers can obtain one solely through validation.
  return `${SUPPORTED_NAMESPACE}:${shortcode}${suffix}` as ReactionKey;
};

/** Validates and canonicalizes (alias -> id). The only way to obtain a ReactionKey. */
export const normalizeReactionKey = (
  input: string,
): Result<ReactionKey, ReactionKeyError> => {
  const structure = parseStructure(input);
  if (!structure.ok) {
    return structure;
  }
  const { namespace, shortcode, skinTone } = structure.value;

  if (namespace !== SUPPORTED_NAMESPACE) {
    return { ok: false, error: { kind: 'unsupported-namespace', namespace } };
  }
  const canonical = resolveCanonicalId(shortcode);
  if (canonical == null) {
    return { ok: false, error: { kind: 'unknown-emoji', shortcode } };
  }
  if (
    skinTone != null &&
    emojiNativeLookup[canonical].skins.length !== SKIN_TONE_VARIANT_COUNT
  ) {
    return {
      ok: false,
      error: { kind: 'skin-tone-not-supported', shortcode },
    };
  }
  return { ok: true, value: buildKey(canonical, skinTone) };
};

/** Non-throwing counterpart of parseReactionKey, for persisted keys that may outlive the emoji data or be malformed. */
export const tryParseReactionKey = (key: string): ParsedReactionKey | null => {
  const structure = parseStructure(key);
  if (!structure.ok || structure.value.namespace !== SUPPORTED_NAMESPACE) {
    return null;
  }
  const { shortcode, skinTone } = structure.value;
  return { namespace: SUPPORTED_NAMESPACE, shortcode, skinTone };
};

export const parseReactionKey = (key: ReactionKey): ParsedReactionKey => {
  const parsed = tryParseReactionKey(key);
  if (parsed == null) {
    throw new Error(`Not a valid reaction key: ${key}`);
  }
  return parsed;
};

/** Strips the namespace: 'unicode:+1::skin-tone-3' -> '+1::skin-tone-3'. */
export const toSlackReactionName = (key: ReactionKey): string =>
  key.slice(SUPPORTED_NAMESPACE.length + 1);

/** Mirrors the picker's selection; `kind` selects the key namespace. */
type PickerSelection = {
  readonly kind: 'native';
  readonly id: string;
  readonly skin?: number;
};

const fromNativeSelection = (
  id: string,
  skin: number | undefined,
): Result<ReactionKey, ReactionKeyError> => {
  if (id.includes(':')) {
    return malformed();
  }
  if (skin == null || skin === 1) {
    return normalizeReactionKey(`${SUPPORTED_NAMESPACE}:${id}`);
  }
  const skinTone = Number.isInteger(skin) ? toSkinTone(skin) : null;
  if (skinTone == null) {
    return malformed();
  }
  return normalizeReactionKey(
    `${SUPPORTED_NAMESPACE}:${id}${SKIN_TONE_SEPARATOR}skin-tone-${skinTone}`,
  );
};

/** Converts a picker selection to a key, dispatching on `kind`. For native, skin 1 or absent = no tone. */
export const fromPickerSelection = (
  selection: PickerSelection,
): Result<ReactionKey, ReactionKeyError> => {
  switch (selection.kind) {
    case 'native':
      return fromNativeSelection(selection.id, selection.skin);
    default: {
      // Fails to compile when a kind is added to PickerSelection without a case above.
      const _unsupported: never = selection.kind;
      return malformed();
    }
  }
};

/** Native glyph for display; null when the emoji data no longer knows the key. */
export const resolveReactionGlyph = (key: ReactionKey): string | null => {
  // A persisted key can outlive the emoji data, so resolve defensively instead of throwing.
  const structure = parseStructure(key);
  if (!structure.ok || structure.value.namespace !== SUPPORTED_NAMESPACE) {
    return null;
  }
  const { shortcode, skinTone } = structure.value;
  if (!Object.hasOwn(emojiNativeLookup, shortcode)) {
    return null;
  }
  const { skins } = emojiNativeLookup[shortcode];
  return skins[skinTone == null ? 0 : skinTone - 1]?.native ?? null;
};
