// @vitest-environment happy-dom

import type { ComponentType, JSX } from 'react';
import { render, screen } from '@testing-library/react';

import type { ChangeProposalView } from '../../../interfaces';
import { RequesterOnlySection } from './RequesterOnlySection';
import type { RequesterOnlySectionProps } from './requester-only-sections';

const mocks = vi.hoisted(() => {
  const sections: Record<string, unknown> = {};
  return { loader: vi.fn(), sections };
});

vi.mock('./requester-only-sections', () => ({
  REQUESTER_ONLY_SECTIONS: mocks.sections,
}));

const TestSection = ({
  proposalId,
}: RequesterOnlySectionProps): JSX.Element => (
  <div data-testid="requester-only-content">{proposalId}</div>
);

const createView = (
  overrides: Partial<ChangeProposalView>,
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'pending',
  isRequester: true,
  operations: [],
  ...overrides,
});

describe('RequesterOnlySection', () => {
  beforeEach(() => {
    mocks.loader.mockReset();
    mocks.loader.mockImplementation(
      async (): Promise<ComponentType<RequesterOnlySectionProps>> =>
        TestSection,
    );
    for (const key of Object.keys(mocks.sections)) {
      delete mocks.sections[key];
    }
    mocks.sections['ai-chat'] = mocks.loader;
  });

  it('renders the declared component with the proposal id for the requester', async () => {
    render(<RequesterOnlySection view={createView({})} />);

    const content = await screen.findByTestId('requester-only-content');
    expect(content.textContent).toBe('proposal-1');
    expect(mocks.loader).toHaveBeenCalledTimes(1);
  });

  it('renders nothing and never loads the component for a non-requester', async () => {
    const { container } = render(
      <RequesterOnlySection view={createView({ isRequester: false })} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(mocks.loader).not.toHaveBeenCalled();
  });

  it('renders nothing for the requester when the table has no row for the entry', async () => {
    const { container } = render(
      <RequesterOnlySection view={createView({ entry: 'vault' })} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(mocks.loader).not.toHaveBeenCalled();
  });
});
