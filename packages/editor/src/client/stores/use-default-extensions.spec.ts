import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDefaultExtensionsArg,
  createSlashCommandExtension,
} from './use-default-extensions.js';

/**
 * WHY the cast: `TFunction` is a large overloaded interface with no reasonable
 * non-cast construction; `createSlashCommandExtension` only depends on its
 * `(key) => string` shape (it passes `t` straight to `resolveSlashCommands`).
 */
const t = vi.fn((key: string) => key) as unknown as TFunction;

describe('buildDefaultExtensionsArg', () => {
  it('nests the whole set as a single top-level element (one Compartment per call)', () => {
    // Load-bearing invariant: appendExtensions wraps every top-level element with
    // the SAME Compartment, so a flat multi-element array would throw "Duplicate
    // use of compartment in extensions" at runtime (see the function's JSDoc).
    const arg = buildDefaultExtensionsArg(createSlashCommandExtension(t));

    expect(arg).toHaveLength(1);
    expect(Array.isArray(arg[0])).toBe(true);
  });
});
