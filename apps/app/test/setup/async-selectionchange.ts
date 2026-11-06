// happy-dom fires `selectionchange` synchronously, and on every Selection.collapse/extend even
// when nothing changed, whereas browsers queue it as a task and fire it only on a real change.
// CodeMirror's DOMObserver handles that event by calling EditorView.update, which throws when the
// selection was set from inside an update, and re-setting the selection from the handler would
// loop forever if the event were merely deferred.
const dispatchEvent = document.dispatchEvent.bind(document);

type SelectionPoint = readonly [Node | null, number, Node | null, number];

const readSelection = (): SelectionPoint => {
  const sel = document.getSelection();
  return [
    sel?.anchorNode ?? null,
    sel?.anchorOffset ?? 0,
    sel?.focusNode ?? null,
    sel?.focusOffset ?? 0,
  ];
};

const isSameSelection = (a: SelectionPoint, b: SelectionPoint): boolean =>
  a.every((value, i) => value === b[i]);

let delivered = readSelection();

document.dispatchEvent = (event: Event): boolean => {
  if (event.type !== 'selectionchange') {
    return dispatchEvent(event);
  }
  queueMicrotask(() => {
    const current = readSelection();
    if (isSameSelection(delivered, current)) {
      return;
    }
    delivered = current;
    dispatchEvent(event);
  });
  return true;
};
