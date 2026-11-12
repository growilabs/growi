import { fireEvent, render } from '@testing-library/react';

import { NewsMarkdownBody } from './NewsMarkdownBody';

const FEED_IMAGE = 'https://growilabs.github.io/growi-news-feed/images/x.png';

describe('NewsMarkdownBody', () => {
  describe('renders allowed Markdown', () => {
    test('headings, emphasis, lists, and multiple items in order', () => {
      const { container } = render(
        <NewsMarkdownBody body={'# Title\n\n**bold**\n\n- a\n- b'} />,
      );
      // heading shifted down 2 levels (h1 -> h3)
      expect(container.querySelector('h3')?.textContent).toBe('Title');
      expect(container.querySelector('strong')?.textContent).toBe('bold');
      expect(container.querySelectorAll('li')).toHaveLength(2);
    });

    test('GFM tables', () => {
      const { container } = render(
        <NewsMarkdownBody body={'| h |\n| - |\n| c |'} />,
      );
      expect(container.querySelector('table')).not.toBeNull();
      expect(container.querySelector('td')?.textContent).toBe('c');
    });

    test('a valid relative image resolves to the feed origin', () => {
      const { container } = render(
        <NewsMarkdownBody body={'![alt](images/x.png)'} />,
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe(FEED_IMAGE);
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    });

    test('external links open in a new tab with rel', () => {
      const { container } = render(
        <NewsMarkdownBody body={'[x](https://example.com)'} />,
      );
      const a = container.querySelector('a');
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    // Only external http(s) links get target=_blank; a fragment/mailto link
    // opened in a new tab would point at nothing (ids are not allow-listed).
    test('a fragment link stays in the same tab', () => {
      const { container } = render(<NewsMarkdownBody body={'[s](#section)'} />);
      const a = container.querySelector('a');
      expect(a?.getAttribute('href')).toBe('#section');
      expect(a?.getAttribute('target')).toBeNull();
    });

    test('a mailto link stays in the same tab', () => {
      const { container } = render(
        <NewsMarkdownBody body={'[m](mailto:a@example.com)'} />,
      );
      const a = container.querySelector('a');
      expect(a?.getAttribute('href')).toBe('mailto:a@example.com');
      expect(a?.getAttribute('target')).toBeNull();
    });
  });

  // These fail if `[rehypeSanitize, newsSanitizeSchema]` is removed from the
  // pipeline: the elements below are produced by remark-gfm and are removed
  // ONLY by sanitize (raw HTML is already unparsed, and the media plugin only
  // touches <img>). They pin sanitize as the active defense, which the earlier
  // tests did not.
  describe('sanitize is wired into the pipeline', () => {
    test('a GFM task-list <input> is removed', () => {
      const { container } = render(
        <NewsMarkdownBody body={'- [ ] todo\n- [x] done'} />,
      );
      expect(container.querySelector('input')).toBeNull();
    });

    test('a GFM footnote section does not leak', () => {
      const { container } = render(
        <NewsMarkdownBody body={'text[^1]\n\n[^1]: a footnote'} />,
      );
      expect(container.querySelector('.footnotes')).toBeNull();
      expect(container.textContent).not.toContain('a footnote');
    });
  });

  describe('blocks unsafe content', () => {
    test('raw HTML in body is not parsed into elements', () => {
      const { container } = render(
        <NewsMarkdownBody
          body={
            '<script>alert(1)</script><iframe src="https://evil"></iframe>text'
          }
        />,
      );
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('iframe')).toBeNull();
    });

    test('a javascript: link is neutralized', () => {
      const { container } = render(
        <NewsMarkdownBody body={'[x](javascript:alert(1))'} />,
      );
      const a = container.querySelector('a');
      expect(a?.getAttribute('href') ?? '').not.toContain('javascript:');
    });

    test('an off-origin image is dropped', () => {
      const { container } = render(
        <NewsMarkdownBody
          body={'![x](https://evil.example.com/images/x.png)'}
        />,
      );
      expect(container.querySelector('img')).toBeNull();
    });

    test('a subdirectory image path is dropped (flat only)', () => {
      const { container } = render(
        <NewsMarkdownBody body={'![x](images/sub/x.png)'} />,
      );
      expect(container.querySelector('img')).toBeNull();
    });

    test('a data: image URL is dropped', () => {
      const { container } = render(
        <NewsMarkdownBody body={'![x](data:image/png;base64,iVBORw0KGgo=)'} />,
      );
      expect(container.querySelector('img')).toBeNull();
    });

    test('an inline <img onerror> written as raw HTML is not parsed', () => {
      const { container } = render(
        <NewsMarkdownBody body={'<img src=x onerror="alert(1)">'} />,
      );
      // raw HTML is not parsed (no rehype-raw) → no img element at all
      expect(container.querySelector('img')).toBeNull();
    });
  });

  test('hides only the image when it fails to load', () => {
    const { container } = render(
      <NewsMarkdownBody body={'text\n\n![x](images/x.png)'} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    if (img == null) throw new Error('unreachable');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('text');
  });

  // Guard: a failed image at a tree position must not keep hiding a DIFFERENT
  // image that replaces it when the body changes (React may reuse the instance).
  test('shows a new image after a previous one at the same position errored', () => {
    const { container, rerender } = render(
      <NewsMarkdownBody body={'![x](images/old.png)'} />,
    );
    const first = container.querySelector('img');
    if (first == null) throw new Error('unreachable');
    fireEvent.error(first);
    expect(container.querySelector('img')).toBeNull();

    rerender(<NewsMarkdownBody body={'![x](images/new.png)'} />);

    const second = container.querySelector('img');
    expect(second?.getAttribute('src')).toBe(
      'https://growilabs.github.io/growi-news-feed/images/new.png',
    );
  });
});
