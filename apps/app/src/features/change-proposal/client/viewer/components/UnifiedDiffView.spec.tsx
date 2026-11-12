// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { createPatch } from 'diff';
import { vi } from 'vitest';

import { UnifiedDiffView } from './UnifiedDiffView';

vi.mock('~/stores-universal/use-next-themes', () => ({
  Themes: { DARK: 'dark', LIGHT: 'light' },
  useNextThemes: () => ({ theme: undefined }),
}));
vi.mock('~/stores/admin/customize', () => ({
  useSWRxGrowiThemeSetting: () => ({ data: undefined }),
}));

describe('UnifiedDiffView', () => {
  it('renders the removed and added lines of the diff', () => {
    const patch = createPatch('page', 'old line\n', 'new line\n');

    const { container } = render(<UnifiedDiffView unifiedDiff={patch} />);

    expect(container.textContent).toContain('old line');
    expect(container.textContent).toContain('new line');
  });
});
