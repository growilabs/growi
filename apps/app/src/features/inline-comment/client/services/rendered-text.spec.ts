// @vitest-environment happy-dom

import { renderedTextOf } from './rendered-text';

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
});
