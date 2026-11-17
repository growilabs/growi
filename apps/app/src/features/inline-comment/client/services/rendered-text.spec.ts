// @vitest-environment happy-dom

import { GROWI_DECORATION_ATTR } from '@growi/core/dist/consts';

import { IMAGE_TOKEN, isCountedImage, renderedTextOf } from './rendered-text';

/**
 * Builds a container whose structure mirrors what GROWI's markdown renderer produces
 * for a page containing: a KaTeX-rendered inline formula, a fenced code block, and an
 * lsx/drawio-like widget that has already settled (per rendered-text's calling contract).
 */
const createSettledContainer = (): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = `
    <p>Before math <span class="katex"><span class="katex-mathml">x^2 MathML content</span><span class="katex-html" aria-hidden="true">x²</span></span> after math.</p>
    <pre><code>const x = 1;</code></pre>
    <div class="lsx" data-lsx-resolved="true">Resolved lsx list output</div>
  `;
  return container;
};

/**
 * Mirrors a heading's conditionally-rendered edit button (Header.tsx's `EditLink`):
 * an icon `<span>` whose text content is the icon's ligature name, wrapped in
 * `aria-hidden="true"` so it does not leak into the read-aloud/body text.
 */
const createContainerWithHiddenIcon = (): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = `
    <h2>Section Title<span aria-hidden="true" class="material-symbols-outlined">edit_square</span></h2>
    <p>With more content below.</p>
  `;
  return container;
};

describe('renderedTextOf', () => {
  it('excludes the text content of a .katex subtree, including its nested katex-mathml/katex-html children', () => {
    const container = createSettledContainer();

    const { text } = renderedTextOf(container);

    expect(text).not.toContain('MathML content');
    expect(text).not.toContain('x²');
  });

  it('includes text from a code block', () => {
    const container = createSettledContainer();

    const { text } = renderedTextOf(container);

    expect(text).toContain('const x = 1;');
  });

  it('includes text from an lsx/drawio-like widget (does not special-case such elements)', () => {
    const container = createSettledContainer();

    const { text } = renderedTextOf(container);

    expect(text).toContain('Resolved lsx list output');
  });

  it('includes the surrounding prose text while excluding only the math', () => {
    const container = createSettledContainer();

    const { text } = renderedTextOf(container);

    expect(text).toContain('Before math');
    expect(text).toContain('after math.');
  });

  it('excludes the text content of an aria-hidden="true" subtree, the same as a .katex subtree', () => {
    const container = createContainerWithHiddenIcon();

    const { text } = renderedTextOf(container);

    expect(text).not.toContain('edit_square');
    expect(text).toContain('Section Title');
    expect(text).toContain('With more content below.');
  });

  describe('resolveDomPosition', () => {
    it('round-trips: the text reconstructed from the resolved DOM position onward matches the tail of text from that offset', () => {
      const container = createSettledContainer();
      const { text, resolveDomPosition } = renderedTextOf(container);

      // Pick a few offsets scattered across different text nodes (prose, code, widget).
      const offsetsToCheck = [
        0,
        text.indexOf('after math.'),
        text.indexOf('const x = 1;') + 6, // mid code-block text node
        text.indexOf('Resolved lsx list output') + 9, // mid widget text node
      ];

      for (const offset of offsetsToCheck) {
        const position = resolveDomPosition(offset);
        expect(position).not.toBeNull();

        const { node, offset: nodeOffset } = position as {
          node: Node;
          offset: number;
        };
        const nodeValue = node.nodeValue ?? '';
        // The tail of this text node from nodeOffset must be a prefix of the tail of
        // `text` from the resolved offset (the rest of `text` continues into later nodes).
        const nodeTail = nodeValue.slice(nodeOffset);
        const textTail = text.slice(offset);
        expect(textTail.startsWith(nodeTail)).toBe(true);
      }
    });

    it('returns null for an offset beyond text.length', () => {
      const container = createSettledContainer();
      const { text, resolveDomPosition } = renderedTextOf(container);

      expect(resolveDomPosition(text.length + 1)).toBeNull();
    });
  });

  describe('textOffsetOf', () => {
    it('round-trips text -> DOM -> text exactly for offsets scattered across the non-excluded ranges', () => {
      const container = createSettledContainer();
      const { text, resolveDomPosition, textOffsetOf } =
        renderedTextOf(container);

      const offsetsToCheck = [
        0,
        text.indexOf('Before math'),
        text.indexOf('after math.'),
        text.indexOf('const x = 1;') + 6,
        text.indexOf('Resolved lsx list output') + 9,
        text.length,
      ];

      for (const offset of offsetsToCheck) {
        const position = resolveDomPosition(offset);
        expect(position).not.toBeNull();

        const { node, offset: nodeOffset } = position as {
          node: Node;
          offset: number;
        };
        expect(textOffsetOf(node, nodeOffset)).toBe(offset);
      }
    });

    it('round-trips DOM -> text -> DOM to an equivalent position', () => {
      const container = createSettledContainer();
      const { text, resolveDomPosition, textOffsetOf } =
        renderedTextOf(container);

      const codeTextNode = (container.querySelector('code') as HTMLElement)
        .firstChild as Text;

      const textOffset = textOffsetOf(codeTextNode, 6);
      const position = resolveDomPosition(textOffset);
      expect(position).not.toBeNull();

      const { node, offset: nodeOffset } = position as {
        node: Node;
        offset: number;
      };
      expect(
        text
          .slice(textOffset)
          .startsWith((node.nodeValue ?? '').slice(nodeOffset)),
      ).toBe(true);
    });

    it('accepts an element boundary point (Range.setEnd(element, childIndex) form)', () => {
      const container = createContainerWithHiddenIcon();
      const { text, textOffsetOf } = renderedTextOf(container);

      const heading = container.querySelector('h2') as HTMLElement;

      // Boundary just after the heading's first child (the "Section Title" text node).
      expect(textOffsetOf(heading, 1)).toBe(
        text.indexOf('Section Title') + 'Section Title'.length,
      );
    });

    it('maps a boundary inside a .katex subtree to the length up to just before that subtree', () => {
      const container = createSettledContainer();
      const { textOffsetOf } = renderedTextOf(container);

      const paragraph = container.querySelector('p') as HTMLElement;
      const proseBeforeKatex = paragraph.childNodes[0] as Text;
      const katexInnerTextNode = (
        paragraph.querySelector('.katex-mathml') as HTMLElement
      ).firstChild as Text;

      expect(textOffsetOf(katexInnerTextNode, 3)).toBe(
        textOffsetOf(
          proseBeforeKatex,
          (proseBeforeKatex.nodeValue ?? '').length,
        ),
      );
    });

    it('maps a boundary inside an aria-hidden="true" subtree to the length up to just before that subtree', () => {
      const container = createContainerWithHiddenIcon();
      const { textOffsetOf } = renderedTextOf(container);

      const heading = container.querySelector('h2') as HTMLElement;
      const headingText = heading.childNodes[0] as Text;
      const hiddenIconTextNode = (
        heading.querySelector('[aria-hidden="true"]') as HTMLElement
      ).firstChild as Text;

      expect(textOffsetOf(hiddenIconTextNode, 4)).toBe(
        textOffsetOf(headingText, (headingText.nodeValue ?? '').length),
      );
    });
  });
});

describe('renderedTextOf with images', () => {
  const createContainerWithImage = (): HTMLElement => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>Before <button type="button"><img src="/a.png" alt="a"></button> after</p>';
    return container;
  };

  it('counts each image as a single IMAGE_TOKEN at its position', () => {
    const { text } = renderedTextOf(createContainerWithImage());

    expect(text).toBe(`Before ${IMAGE_TOKEN} after`);
  });

  it('does not count an image inside an aria-hidden="true" subtree', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>Text<span aria-hidden="true"><img src="/icon.png" alt=""></span></p>';

    const { text } = renderedTextOf(container);

    expect(text).toBe('Text');
  });

  it('does not count an image or text inside a decoration subtree', () => {
    const container = document.createElement('div');
    container.innerHTML = `<p>Text<span ${GROWI_DECORATION_ATTR}><img src="/avatar.png" alt="Alice">Alice</span> after</p>`;

    const { text } = renderedTextOf(container);

    expect(text).toBe('Text after');
  });

  it("resolves the token's start and end to a Range that holds exactly the image", () => {
    const container = createContainerWithImage();
    const { resolveDomPosition } = renderedTextOf(container);
    const tokenStart = 'Before '.length;

    const start = resolveDomPosition(tokenStart);
    const end = resolveDomPosition(tokenStart + 1, 'end');
    const range = document.createRange();
    range.setStart(start?.node as Node, start?.offset as number);
    range.setEnd(end?.node as Node, end?.offset as number);

    expect(range.toString()).toBe('');
    expect(range.cloneContents().querySelectorAll('img')).toHaveLength(1);
  });

  it('maps the boundaries just before and just after an image to the two sides of its token', () => {
    const container = createContainerWithImage();
    const { textOffsetOf } = renderedTextOf(container);
    const wrapper = container.querySelector('button') as HTMLElement;

    expect(textOffsetOf(wrapper, 0)).toBe('Before '.length);
    expect(textOffsetOf(wrapper, 1)).toBe('Before '.length + 1);
  });
});

describe('isCountedImage', () => {
  it('accepts exactly the images that renderedTextOf counts as IMAGE_TOKEN', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <p>A <button type="button"><img data-name="content" src="/a.png" alt=""></button></p>
      <p><span aria-hidden="true"><img data-name="hidden" src="/b.png" alt=""></span></p>
      <p><span ${GROWI_DECORATION_ATTR}><span><img data-name="decoration" src="/c.png" alt=""></span></span></p>
      <p><span class="katex"><img data-name="katex" src="/d.png" alt=""></span></p>
      <p>B <img data-name="inline" src="/e.png" alt=""></p>
    `;
    const images = Array.from(container.querySelectorAll('img'));

    const counted = images.filter((image) => isCountedImage(image, container));

    expect(counted.map((image) => image.dataset.name)).toEqual([
      'content',
      'inline',
    ]);
    expect(renderedTextOf(container).text.split(IMAGE_TOKEN)).toHaveLength(
      counted.length + 1,
    );
  });

  it('rejects an image outside the container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('img');

    expect(isCountedImage(outside, container)).toBe(false);
  });
});
