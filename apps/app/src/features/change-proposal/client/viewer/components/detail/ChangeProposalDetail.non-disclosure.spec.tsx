// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SWRResponse } from 'swr';

import type {
  ChangeProposalView,
  OperationView,
  ProposalEntry,
} from '../../../../interfaces';
import type { ChangeProposalFetchResult } from '../../stores/use-swrx-change-proposal';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import { ChangeProposalDetail } from './ChangeProposalDetail';

// Interpolation values are rendered, so a count passed to t() shows up in the text.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options == null ? key : `${key}${JSON.stringify(options)}`,
  }),
}));

vi.mock('~/components/User/UserDate', () => ({
  default: ({ dateTime }: { dateTime: string }) => <span>{dateTime}</span>,
}));

vi.mock('../../stores/use-swrx-change-proposal', () => ({
  useSWRxChangeProposal: vi.fn(),
}));

vi.mock('../OperationDiff', () => ({
  OperationDiff: () => null,
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: () => false,
  useIsReadOnlyUser: () => false,
}));

vi.mock('../../stores/proposal-actions', () => ({
  revertOperations: vi.fn(),
  sendRevertRequest: vi.fn(),
}));

vi.mock('../../stores/use-revert-progress', () => ({
  useRevertProgress: vi.fn(),
}));

vi.mock('../requester-only-sections', () => ({
  REQUESTER_ONLY_SECTIONS: {},
}));

const PAGE_GONE = 'change_proposal_viewer.operation.page_gone';
const PATH_MARK = '<path>';
const ENTRIES: readonly ProposalEntry[] = ['ai-chat', 'vault', 'mcp', 'revert'];
const VISIBLE_COUNTS: readonly number[] = [1, 4, 12];

// Digit-free names, so that any digit in the display can only come from the viewer.
const letterName = (n: number): string =>
  `page${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

const buildAppliedEdit = (n: number): OperationView => ({
  key: `key${letterName(n)}`,
  type: 'edit',
  status: 'applied',
  page: { id: `id${letterName(n)}`, path: `/team/${letterName(n)}` },
  baseRevisionId: 'revbase',
  resultRevisionId: 'revresult',
  revertability: { revertible: true },
});

const buildProposal = (
  overrides: Partial<ChangeProposalView>,
): ChangeProposalView => ({
  id: 'proposalabc',
  requester: { id: 'userabc', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  modelLabel: 'modelx',
  createdAt: 'CREATEDAT',
  lastAppliedAt: 'LASTAPPLIEDAT',
  status: 'applied',
  isRequester: false,
  operations: [],
  ...overrides,
});

const mockFound = (proposal: ChangeProposalView): void => {
  const response: SWRResponse<ChangeProposalFetchResult, Error> = {
    data: { type: 'found', proposal },
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  };
  vi.mocked(useSWRxChangeProposal).mockReturnValue(response);
};

const pathsOf = (proposal: ChangeProposalView): string[] =>
  proposal.operations.flatMap((op) => {
    const path = op.page?.path ?? op.path;
    return path == null ? [] : [path];
  });

// The text split at each listed path: what surrounds the first and the last
// path, and every distinct text found between two paths.
type Shape = {
  readonly head: string;
  readonly tail: string;
  readonly between: readonly string[];
};

const shapeOf = (text: string, paths: readonly string[]): Shape => {
  const marked = paths.reduce(
    (acc, path) => acc.replaceAll(path, PATH_MARK),
    text,
  );
  const segments = marked.split(PATH_MARK);
  return {
    head: segments[0],
    tail: segments[segments.length - 1],
    between: [...new Set(segments.slice(1, -1))],
  };
};

const expectSameShapeForEveryCount = (
  shapes: ReadonlyMap<number, Shape>,
): void => {
  const [first, ...rest] = [...shapes.values()];
  const withBetween = [...shapes.entries()].filter(([count]) => count > 1);
  for (const shape of rest) {
    expect(shape.head).toBe(first.head);
    expect(shape.tail).toBe(first.tail);
  }
  for (const [, shape] of withBetween) {
    expect(shape.between).toHaveLength(1);
    expect(shape.between).toEqual(withBetween[0][1].between);
  }
};

describe('ChangeProposalDetail does not disclose how many operations exist', () => {
  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
  });

  it.each(
    ENTRIES,
  )('renders the same page and confirmation for 1, 4 and 12 visible operations, with no digit, for the %s entry', async (entry) => {
    const pageShapes = new Map<number, Shape>();
    const confirmShapes = new Map<number, Shape>();

    for (const count of VISIBLE_COUNTS) {
      const proposal = buildProposal({
        entry,
        revertOf: entry === 'revert' ? 'originalproposal' : undefined,
        operations: Array.from({ length: count }, (_, n) =>
          buildAppliedEdit(n),
        ),
      });
      mockFound(proposal);
      const { container, unmount } = render(
        <ChangeProposalDetail proposalId="proposalabc" />,
      );
      const pageText = container.textContent ?? '';
      // biome-ignore lint/performance/noAwaitInLoops: one rendering per count
      await userEvent.click(
        screen.getByRole('button', {
          name: 'change_proposal_viewer.revert_all.button',
        }),
      );
      const confirmText = (await screen.findByRole('dialog')).textContent ?? '';

      expect(pageText).not.toMatch(/\d/);
      expect(confirmText).not.toMatch(/\d/);
      const paths = pathsOf(proposal);
      pageShapes.set(count, shapeOf(pageText, paths));
      confirmShapes.set(count, shapeOf(confirmText, paths));
      unmount();
    }

    expectSameShapeForEveryCount(pageShapes);
    expectSameShapeForEveryCount(confirmShapes);
  });
});

describe('ChangeProposalDetail shows gone pages only as core returned them', () => {
  const pathTexts = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('code')].map((el) => el.textContent ?? '');

  const countOf = (text: string, word: string): number =>
    text.split(word).length - 1;

  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
  });

  it('shows the requester the recorded paths and the page-gone text, and nothing else, for operations whose pages are gone', () => {
    const proposal = buildProposal({
      isRequester: true,
      status: 'partially-reverted',
      operations: [
        {
          key: 'keycreated',
          index: 0,
          type: 'create',
          status: 'reverted',
          path: '/recorded/created',
          proposedBody: 'body of /made/up/from/body',
          revertedByProposalId: 'revertproposal',
        },
        {
          key: 'keyedited',
          index: 1,
          type: 'edit',
          status: 'applied',
          path: '/recorded/edited',
          baseRevisionId: 'revbase',
          resultRevisionId: 'revresult',
        },
        {
          key: 'keyunrecorded',
          index: 2,
          type: 'edit',
          status: 'applied',
          proposedBody: 'body of /made/up/from/body',
          baseRevisionId: 'revbase',
          resultRevisionId: 'revresult',
        },
      ],
    });
    mockFound(proposal);

    const { container } = render(
      <ChangeProposalDetail proposalId="proposalabc" />,
    );

    expect(pathTexts(container)).toEqual([
      '/recorded/created',
      '/recorded/edited',
    ]);
    const text = container.textContent ?? '';
    expect(countOf(text, PAGE_GONE)).toBe(1);
    expect(text).not.toContain('/made/up');
  });

  it('shows the revert counterpart the recorded path and the page-gone text, and nothing else, for deletions whose pages are gone', () => {
    const proposal = buildProposal({
      entry: 'revert',
      revertOf: 'originalproposal',
      operations: [
        {
          key: 'keydeleted',
          type: 'delete-completely',
          status: 'applied',
          path: '/recorded/created',
          revertTarget: {
            proposalId: 'originalproposal',
            operationKey: 'keyoriginalcreate',
          },
        },
        {
          key: 'keydeletedunrecorded',
          type: 'delete-completely',
          status: 'applied',
          revertTarget: {
            proposalId: 'originalproposal',
            operationKey: 'keyothercreate',
          },
        },
      ],
    });
    mockFound(proposal);

    const { container } = render(
      <ChangeProposalDetail proposalId="proposalabc" />,
    );

    expect(pathTexts(container)).toEqual(['/recorded/created']);
    const text = container.textContent ?? '';
    expect(countOf(text, PAGE_GONE)).toBe(1);
    expect(text).not.toContain('keyothercreate');
  });
});
