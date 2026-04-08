import { EditorView } from '@codemirror/view';

// Shared design tokens
const AVATAR_SIZE = '20px';
const IDLE_OPACITY = '0.6';

export const richCursorsTheme = EditorView.baseTheme({
  // Caret line — negative margins cancel out border width to avoid text shift.
  // Modeled after yRemoteSelectionsTheme in y-codemirror.next.
  '.cm-yRichCaret': {
    position: 'relative',
    borderLeft: '1px solid',
    borderRight: '1px solid',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
    display: 'inline',
  },

  // Overlay flag — positioned below the caret.
  // pointer-events: auto so the avatar itself is a hover/click target.
  '.cm-yRichCursorFlag': {
    position: 'absolute',
    top: '100%',
    left: '-9px', // center the avatar on the 1px caret
    zIndex: '10',
    opacity: IDLE_OPACITY,
    transition: 'opacity 0.3s ease',
  },
  '.cm-yRichCaret:hover .cm-yRichCursorFlag, .cm-yRichCursorFlag:hover': {
    opacity: '1',
  },
  '.cm-yRichCursorFlag.cm-yRichCursorActive': {
    opacity: '1',
  },

  // Avatar image
  '.cm-yRichCursorAvatar': {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
    display: 'block',
  },

  // Initials fallback
  '.cm-yRichCursorInitials': {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '9px',
    fontWeight: 'bold',
  },

  // Name label — hidden by default, shown on hover.
  // Sits behind the avatar; left border-radius matches the avatar circle.
  '.cm-yRichCursorInfo': {
    display: 'none',
    position: 'absolute',
    top: '0',
    left: '0',
    zIndex: '-1',
    whiteSpace: 'nowrap',
    padding: `0 6px 0 calc(${AVATAR_SIZE} + 4px)`,
    borderRadius: `calc(${AVATAR_SIZE} / 2) 3px 3px calc(${AVATAR_SIZE} / 2)`,
    color: 'white',
    fontSize: '12px',
    height: AVATAR_SIZE,
    lineHeight: AVATAR_SIZE,
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
    opacity: IDLE_OPACITY,
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
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
  },
  '.cm-offScreenInitials': {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '9px',
    fontWeight: 'bold',
  },
});
