// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import type { IPagePopulatedToShowRevision } from '@growi/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { PageContentFooter } from './PageContentFooter';

vi.mock('~/client/components/AuthorInfo', () => ({
  AuthorInfo: ({
    mode,
    proposalMark,
  }: {
    mode: string;
    proposalMark?: ReactNode;
  }) => (
    <div data-testid={`author-${mode}`}>
      {mode}
      {proposalMark}
    </div>
  ),
}));
vi.mock('~/features/change-proposal/client/viewer/marks', () => ({
  CurrentRevisionProposalMark: ({ pageId }: { pageId: string }) => (
    <span data-testid="current-mark">{pageId}</span>
  ),
}));

const page = mock<IPagePopulatedToShowRevision>({
  _id: 'page-1',
  isEmpty: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
});

describe('PageContentFooter', () => {
  it('shows the current-revision mark only next to the last-updated author', async () => {
    render(<PageContentFooter page={page} />);

    const update = await screen.findByTestId('author-update');
    const create = await screen.findByTestId('author-create');

    expect(
      update.querySelector('[data-testid="current-mark"]')?.textContent,
    ).toBe('page-1');
    expect(create.querySelector('[data-testid="current-mark"]')).toBeNull();
  });
});
