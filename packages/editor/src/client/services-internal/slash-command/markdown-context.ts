import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

import { LIST_ITEM_PREFIX_REGEX } from './list-line-patterns.js';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** The nearest ancestor of `pos` named in `nodeNames`, or `null`. */
export const findAncestorNode = (
  state: EditorState,
  pos: number,
  nodeNames: ReadonlySet<string>,
): SyntaxNode | null => {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node != null) {
    if (nodeNames.has(node.name)) return node;
    node = node.parent;
  }
  return null;
};

/**
 * lezer-markdown node name for a list item. BulletList / OrderedList / TaskList
 * all wrap a `ListItem`, so this single name covers every list kind.
 */
const LIST_ITEM_NODE_NAMES: ReadonlySet<string> = new Set(['ListItem']);

/** Tab stop width CommonMark uses when measuring indentation. */
const TAB_WIDTH = 4;

/** Visual width of `text`, expanding tabs to the next tab stop. */
const visualWidth = (text: string): number => {
  let width = 0;
  for (const char of text) {
    width += char === '\t' ? TAB_WIDTH - (width % TAB_WIDTH) : 1;
  }
  return width;
};

/** Visual width of the leading whitespace on `lineText`. */
export const indentWidth = (lineText: string): number =>
  visualWidth(lineText.slice(0, lineText.length - lineText.trimStart().length));

export interface ListItemGeometry {
  /**
   * The text preceding the marker on the item's OWN line (indent and any
   * blockquote markers), verbatim. A marker placed after it becomes a sibling
   * item at the same nesting level.
   */
  readonly siblingPrefix: string;
  /**
   * `siblingPrefix` padded out to {@link contentColumn}, so a block placed after
   * it belongs to the item instead of ending the list. Only the marker is
   * widened into spaces, which keeps a `> ` prefix intact.
   */
  readonly insidePrefix: string;
  /** Visual column at which the item's own content begins. */
  readonly contentColumn: number;
}

/**
 * Geometry of the list item enclosing `pos`, or `null` when there is none.
 *
 * Derived from the ITEM's own line rather than the cursor's line, so it is the
 * same whether the cursor sits on the marker line (`- foo /`) or on one of the
 * item's continuation lines (`- foo` / `  bar /`) — both need the item's
 * prefixes to stay inside the list.
 */
export const listItemGeometryAt = (
  state: EditorState,
  pos: number,
): ListItemGeometry | null => {
  const item = findAncestorNode(state, pos, LIST_ITEM_NODE_NAMES);
  if (item == null) return null;

  const markerLine = state.doc.lineAt(item.from);
  const match = LIST_ITEM_PREFIX_REGEX.exec(
    markerLine.text.slice(item.from - markerLine.from),
  );
  if (match == null) return null;

  // The node starts AT the marker, so whatever precedes it on that line (indent,
  // blockquote markers) has to come from the line itself.
  const siblingPrefix = markerLine.text.slice(0, item.from - markerLine.from);
  const contentColumn = visualWidth(siblingPrefix) + visualWidth(match[0]);
  return {
    siblingPrefix,
    insidePrefix:
      siblingPrefix + ' '.repeat(contentColumn - visualWidth(siblingPrefix)),
    contentColumn,
  };
};
