import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ja_JP' },
  }),
}));

import { NewsImage } from './NewsImage';

const VALID_URL = 'https://growilabs.github.io/growi-news-feed/images/x.png';

describe('NewsImage', () => {
  test('renders the image with lazy loading and no referrer', () => {
    render(<NewsImage url={VALID_URL} alt={{ ja_JP: '代替', en_US: 'alt' }} />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe(VALID_URL);
    expect(img.getAttribute('alt')).toBe('代替');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  test('resolves alt with the locale fallback chain', () => {
    render(<NewsImage url={VALID_URL} alt={{ en_US: 'english only' }} />);
    expect(screen.getByRole('img').getAttribute('alt')).toBe('english only');
  });

  test('renders empty alt when none is provided', () => {
    const { container } = render(<NewsImage url={VALID_URL} />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  describe('render-time safety re-check', () => {
    test.each([
      ['javascript:alert(1)'],
      ['data:image/png;base64,xxxx'],
      ['file:///etc/passwd'],
    ])('renders nothing for unsafe scheme %s', (url) => {
      const { container } = render(<NewsImage url={url} />);
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('load-failure fallback', () => {
    test('hides only the image when loading fails', () => {
      const { container } = render(<NewsImage url={VALID_URL} />);

      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      if (img == null) throw new Error('unreachable');
      fireEvent.error(img);

      expect(container.querySelector('img')).toBeNull();
    });

    // Contract with the caller: NewsImage is rendered with key={url}, so a URL
    // change remounts the component and MUST NOT inherit the error state.
    test('shows a new image after remount even if the previous one errored', () => {
      const { container, rerender } = render(
        <NewsImage key={VALID_URL} url={VALID_URL} />,
      );

      const img = container.querySelector('img');
      if (img == null) throw new Error('unreachable');
      fireEvent.error(img);
      expect(container.querySelector('img')).toBeNull();

      const nextUrl =
        'https://growilabs.github.io/growi-news-feed/images/y.png';
      rerender(<NewsImage key={nextUrl} url={nextUrl} />);

      expect(container.querySelector('img')?.getAttribute('src')).toBe(nextUrl);
    });
  });
});
