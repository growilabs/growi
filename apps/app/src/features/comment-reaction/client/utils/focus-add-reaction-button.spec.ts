// @vitest-environment happy-dom

import {
  focusAddReactionButton,
  reactionAddButtonAttributes,
  reactionBarAttributes,
} from './focus-add-reaction-button';

const attributesOf = (attributes: Record<string, string>): string =>
  Object.entries(attributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');

const bar = (commentId: string, extra = ''): string =>
  `<div ${attributesOf(reactionBarAttributes(commentId))}><button ${attributesOf(reactionAddButtonAttributes)} data-testid="add-${commentId}${extra}"></button></div>`;

describe('focusAddReactionButton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the add button of the comment nearest to the origin, not the same comment elsewhere', () => {
    document.body.innerHTML = `
      <div id="thread">${bar('c1', '-thread')}</div>
      <div id="popover"><div id="header"><span id="origin"></span></div>${bar('c1', '-popover')}</div>`;

    focusAddReactionButton('c1', document.getElementById('origin'));

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'add-c1-popover',
    );
  });

  it('ignores the bars of other comments', () => {
    document.body.innerHTML = `<div><span id="origin"></span>${bar('c2')}</div>`;

    focusAddReactionButton('c1', document.getElementById('origin'));

    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus alone when it is already on another element', () => {
    document.body.innerHTML = `<input id="other" /><div><span id="origin"></span>${bar('c1')}</div>`;
    document.getElementById('other')?.focus();

    focusAddReactionButton('c1', document.getElementById('origin'));

    expect(document.activeElement?.id).toBe('other');
  });

  it('does nothing without an origin or when the origin has left the document', () => {
    document.body.innerHTML = bar('c1');
    const detached = document.createElement('span');

    focusAddReactionButton('c1', null);
    focusAddReactionButton('c1', detached);

    expect(document.activeElement).toBe(document.body);
  });
});
