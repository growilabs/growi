// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
  calloutInsertion,
  lsxInsertion,
  plantumlInsertion,
} from './insertion-builders.js';

const createView = (doc: string, from: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(from)]),
    extensions: [markdown({ base: markdownLanguage })],
  });
  return new EditorView({ state });
};

const PLANTUML_BODY = '```plantuml\n\n```';
const PLANTUML_CURSOR = '```plantuml\n'.length;

describe('plantumlInsertion', () => {
  it('at line start: inserts the fence with the cursor on the empty inner line', () => {
    const view = createView('', 0);

    const result = plantumlInsertion(view, 0);

    expect(result.insert).toBe(PLANTUML_BODY);
    expect(result.cursorOffset).toBe(PLANTUML_CURSOR);
    // cursor is on an empty line: newline on both sides
    expect(result.insert[result.cursorOffset - 1]).toBe('\n');
    expect(result.insert[result.cursorOffset]).toBe('\n');
  });

  it('treats a whitespace-only prefix as line start (no separator)', () => {
    const view = createView('  ', 2);

    expect(plantumlInsertion(view, 2).insert).toBe(PLANTUML_BODY);
  });

  it('mid-line: prefixes a blank line so the fence is not absorbed into the paragraph', () => {
    const view = createView('foo ', 4);

    const result = plantumlInsertion(view, 4);

    expect(result.insert).toBe(`\n\n${PLANTUML_BODY}`);
    expect(result.cursorOffset).toBe('\n\n'.length + PLANTUML_CURSOR);
  });
});

describe('calloutInsertion', () => {
  it('at line start: inserts the directive with the cursor on the empty body line', () => {
    const view = createView('', 0);

    const result = calloutInsertion('warning')(view, 0);

    expect(result.insert).toBe(':::warning\n\n:::');
    expect(result.cursorOffset).toBe(':::warning\n'.length);
    expect(result.insert[result.cursorOffset - 1]).toBe('\n');
    expect(result.insert[result.cursorOffset]).toBe('\n');
  });

  it('builds the directive for each type', () => {
    const view = createView('', 0);

    expect(calloutInsertion('note')(view, 0).insert).toBe(':::note\n\n:::');
    expect(calloutInsertion('tip')(view, 0).insert).toBe(':::tip\n\n:::');
    expect(calloutInsertion('caution')(view, 0).insert).toBe(
      ':::caution\n\n:::',
    );
  });

  it('mid-line: prefixes a blank line', () => {
    const view = createView('foo ', 4);

    const result = calloutInsertion('info')(view, 4);

    expect(result.insert).toBe('\n\n:::info\n\n:::');
    expect(result.cursorOffset).toBe('\n\n'.length + ':::info\n'.length);
  });
});

describe('lsxInsertion', () => {
  it('inserts `$lsx()` with the cursor inside the parentheses', () => {
    const result = lsxInsertion();

    expect(result.insert).toBe('$lsx()');
    expect(result.cursorOffset).toBe('$lsx('.length);
    // cursor sits right after `(`, before `)`
    expect(result.insert[result.cursorOffset - 1]).toBe('(');
    expect(result.insert[result.cursorOffset]).toBe(')');
  });

  it('is inline: never prefixes a separator (no replaceFromOffset)', () => {
    const result = lsxInsertion();

    expect(result.insert.startsWith('\n')).toBe(false);
    expect(result.replaceFromOffset ?? 0).toBe(0);
  });
});
