// @vitest-environment happy-dom

import { render } from '@testing-library/react';

import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';

import { PageDuplicateInterruptedSubMsg } from './PageDuplicateInterruptedSubMsg';

// `t` echoes the key together with its interpolation values, so the test checks
// which keys are shown and which values are passed without depending on locale text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(options ?? {})}`,
  }),
}));

const validSnapshot = pageDuplicateInterruptedSnapshot.stringify({
  path: '/dest/top',
  fromPath: '/src/top',
  toPath: '/dest/top',
  copiedPageCount: 3,
  sourcePageCount: 7,
});

describe('PageDuplicateInterruptedSubMsg', () => {
  it('shows the paths, both counts and the remedial advice', () => {
    const { container } = render(
      <PageDuplicateInterruptedSubMsg snapshot={validSnapshot} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain(
      'in_app_notification.page_duplicate_interrupted.summary',
    );
    expect(text).toContain('"toPath":"/dest/top"');
    expect(text).toContain('"fromPath":"/src/top"');
    expect(text).toContain('"copiedPageCount":3');
    expect(text).toContain('"sourcePageCount":7');
    expect(text).toContain(
      'in_app_notification.page_duplicate_interrupted.advice',
    );
  });

  it.each([
    ['not json'],
    ['{"path":"/a"}'],
    [''],
  ])('renders nothing for a malformed snapshot (%j)', (snapshot) => {
    const { container } = render(
      <PageDuplicateInterruptedSubMsg snapshot={snapshot} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
