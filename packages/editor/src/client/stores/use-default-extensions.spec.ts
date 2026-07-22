// @vitest-environment jsdom
import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultExtensionsArg,
  createSlashCommandExtension,
} from './use-default-extensions.js';

/**
 * WHY the cast: `TFunction` is a large overloaded interface with no reasonable
 * non-cast construction; the builder only depends on its `(key) => string` shape
 * (it passes `t` straight to `resolveSlashCommands`). The cast is confined to the
 * call site so the spy stays typed for assertions.
 */

describe('createSlashCommandExtension', () => {
  it('resolves slash-command labels via the provided t (slash source is wired in)', () => {
    const t = vi.fn((key: string) => key);

    createSlashCommandExtension(t as unknown as TFunction);

    // The unified completion must resolve slash-command display strings through t;
    // this proves the slash source is composed in alongside the emoji source, so a
    // regression that drops the slash source would surface here.
    expect(t).toHaveBeenCalledWith(expect.stringMatching(/^slash_command\./));
  });
});

describe('buildDefaultExtensionsArg (Compartment-safe registration shape)', () => {
  const views: EditorView[] = [];
  afterEach(() => {
    // EditorView schedules a jsdom-incompatible layout measure via rAF; destroy to cancel.
    for (const view of views.splice(0)) view.destroy();
  });

  const makeView = (): EditorView => {
    const view = new EditorView({ state: EditorState.create({ doc: '' }) });
    views.push(view);
    return view;
  };

  const completionExtension = createSlashCommandExtension(
    vi.fn((key: string) => key) as unknown as TFunction,
  );

  it('returns a single top-level element so one Compartment wraps the whole set', () => {
    const arg = buildDefaultExtensionsArg(completionExtension);

    // The load-bearing invariant: a flat multi-element array would make
    // appendExtensions reuse one Compartment across elements → RangeError.
    expect(arg).toHaveLength(1);
    expect(Array.isArray(arg[0])).toBe(true);
  });

  // Mirrors useAppendExtensions (services/.../utils/append-extensions.ts): a single
  // Compartment wraps every top-level element of the argument.
  const appendViaSharedCompartment = (
    view: EditorView,
    arg: Extension[],
  ): void => {
    const compartment = new Compartment();
    view.dispatch({
      effects: arg.map((ext) =>
        StateEffect.appendConfig.of(compartment.of(ext)),
      ),
    });
  };

  it('registers through a shared Compartment without a "Duplicate use of compartment" error', () => {
    const view = makeView();
    expect(() =>
      appendViaSharedCompartment(
        view,
        buildDefaultExtensionsArg(completionExtension),
      ),
    ).not.toThrow();
  });

  it('proves the guard is real: a flat multi-element arg DOES throw the duplicate-compartment error', () => {
    const view = makeView();
    // The pre-fix shape: spreading the set into top-level elements.
    const flat = buildDefaultExtensionsArg(
      completionExtension,
    )[0] as Extension[];
    expect(() => appendViaSharedCompartment(view, flat)).toThrow(
      /Duplicate use of compartment/,
    );
  });
});
