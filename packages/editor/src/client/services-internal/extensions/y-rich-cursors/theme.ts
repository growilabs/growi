import { EditorView } from '@codemirror/view';

export const richCursorsTheme = EditorView.baseTheme({
  // Caret line
  '.cm-yRichCaret': {
    position: 'relative',
    borderLeft: '2px solid',
  },

  // Overlay flag — positioned below the caret
  '.cm-yRichCursorFlag': {
    position: 'absolute',
    top: '100%',
    left: '-8px',
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '0.4',
    transition: 'opacity 0.3s ease',
  },
  '.cm-yRichCaret:hover .cm-yRichCursorFlag': {
    pointerEvents: 'auto',
    opacity: '1',
  },
  '.cm-yRichCursorFlag.cm-yRichCursorActive': {
    opacity: '1',
  },

  // Avatar image
  '.cm-yRichCursorAvatar': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'block',
  },

  // Initials fallback
  '.cm-yRichCursorInitials': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '8px',
    fontWeight: 'bold',
  },

  // Name label — hidden by default, shown on hover
  '.cm-yRichCursorInfo': {
    display: 'none',
    position: 'absolute',
    top: '0',
    left: '20px',
    whiteSpace: 'nowrap',
    padding: '2px 6px',
    borderRadius: '3px',
    color: 'white',
    fontSize: '12px',
    lineHeight: '16px',
  },
  '.cm-yRichCursorFlag:hover .cm-yRichCursorInfo': {
    display: 'block',
  },

  // --- Off-screen containers ---
  '.cm-offScreenTop, .cm-offScreenBottom': {
    position: 'absolute',
    left: '0',
    right: '0',
    display: 'flex',
    gap: '4px',
    padding: '2px 4px',
    pointerEvents: 'none',
    zIndex: '10',
  },
  '.cm-offScreenTop': {
    top: '0',
  },
  '.cm-offScreenBottom': {
    bottom: '0',
  },

  // Off-screen indicator
  '.cm-offScreenIndicator': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    opacity: '0.4',
    transition: 'opacity 0.3s ease',
  },
  '.cm-offScreenIndicator.cm-yRichCursorActive': {
    opacity: '1',
  },
  '.cm-offScreenArrow': {
    fontSize: '10px',
    lineHeight: '1',
  },
  '.cm-offScreenAvatar': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
  },
  '.cm-offScreenInitials': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '8px',
    fontWeight: 'bold',
  },
});
