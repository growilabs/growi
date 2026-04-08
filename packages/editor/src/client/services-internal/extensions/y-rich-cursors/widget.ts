import { WidgetType } from '@codemirror/view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derives initials (up to 2 letters) from a display name. */
export function toInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return (words[0][0] ?? '').toUpperCase();
  return (
    (words[0][0] ?? '') + (words[words.length - 1][0] ?? '')
  ).toUpperCase();
}

export function createInitialsElement(
  name: string,
  color: string,
): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'cm-yRichCursorInitials';
  el.style.backgroundColor = color;
  el.textContent = toInitials(name);
  return el;
}

// ---------------------------------------------------------------------------
// RichCaretWidget
// ---------------------------------------------------------------------------

/**
 * CodeMirror WidgetType that renders a cursor caret with an overlay flag
 * containing avatar image (or initials fallback) and hover-revealed name label.
 *
 * DOM structure:
 * <span class="cm-yRichCaret" style="border-color: {color}">
 *   <span class="cm-yRichCursorFlag [cm-yRichCursorActive]">
 *     <img class="cm-yRichCursorAvatar" />  OR  <span class="cm-yRichCursorInitials" />
 *     <span class="cm-yRichCursorInfo" style="background-color: {color}">{name}</span>
 *   </span>
 * </span>
 */
export class RichCaretWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
    readonly imageUrlCached: string | undefined,
    readonly isActive: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span');
    caret.className = 'cm-yRichCaret';
    caret.style.borderColor = this.color;

    const flag = document.createElement('span');
    flag.className = 'cm-yRichCursorFlag';
    if (this.isActive) {
      flag.classList.add('cm-yRichCursorActive');
    }

    if (this.imageUrlCached) {
      const img = document.createElement('img');
      img.className = 'cm-yRichCursorAvatar';
      img.src = this.imageUrlCached;
      img.alt = this.name;
      img.onerror = () => {
        const initials = createInitialsElement(this.name, this.color);
        img.replaceWith(initials);
      };
      flag.appendChild(img);
    } else {
      flag.appendChild(createInitialsElement(this.name, this.color));
    }

    const info = document.createElement('span');
    info.className = 'cm-yRichCursorInfo';
    info.style.backgroundColor = this.color;
    info.textContent = this.name;
    flag.appendChild(info);

    caret.appendChild(flag);
    return caret;
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof RichCaretWidget)) return false;
    return (
      other.color === this.color &&
      other.name === this.name &&
      other.imageUrlCached === this.imageUrlCached &&
      other.isActive === this.isActive
    );
  }

  get estimatedHeight(): number {
    return -1;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
