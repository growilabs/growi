import { act, render, screen } from '@testing-library/react';

import { PageSelectModal } from './PageSelectModal';

// --- Reproduce the "cold SWR cache" condition ---------------------------------
// ItemsTree calls `useSWRxRootPage({ suspense: true })`, so on the very first
// open (before the root page is cached) it SUSPENDS. We simulate that by
// throwing a promise until it is resolved, then rendering real content.
//
// Root cause (issue #11422): the scroller <div> that owns the callback ref
// lived INSIDE the <Suspense> boundary. When ItemsTree suspends, React hides
// the boundary's primary content and detaches that ref (calls it with null),
// which set `scrollerElem` back to null; that unmounts ItemsTree, the content
// reveals again, the ref re-attaches (sets `scrollerElem` again), ItemsTree
// suspends again -> an unbounded render loop ("Maximum update depth exceeded").
let itemsTreeRenderCount = 0;
let resolveRootPage: (() => void) | undefined;
let rootPageReady = false;
const rootPagePromise = new Promise<void>((resolve) => {
  resolveRootPage = () => {
    rootPageReady = true;
    resolve();
  };
});

vi.mock('~/features/page-tree/components', () => ({
  ItemsTree: () => {
    itemsTreeRenderCount += 1;
    if (!rootPageReady) {
      // Suspend, mimicking SWR's suspense on a cold cache.
      throw rootPagePromise;
    }
    return <div data-testid="items-tree">tree loaded</div>;
  },
}));

// TreeItemForModal is only passed as a prop to the (mocked) ItemsTree, so a
// stub is enough and avoids pulling in its SCSS module.
vi.mock('./TreeItemForModal', () => ({
  TreeItemForModal: () => null,
  treeItemForModalSize: 40,
}));

vi.mock('~/states/ui/modal/page-select', () => ({
  usePageSelectModalStatus: () => ({ isOpened: true, opts: {} }),
  usePageSelectModalActions: () => ({ open: vi.fn(), close: vi.fn() }),
  useSelectedPageInModal: () => null,
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: () => false,
  useIsReadOnlyUser: () => false,
}));

vi.mock('~/states/page', () => ({
  useCurrentPageData: () => ({ path: '/foo/bar' }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('PageSelectModal (issue #11422 root cause)', () => {
  it('renders the tree after suspense without an infinite render loop', async () => {
    // On the buggy structure this render() itself trips the render loop
    // (React "Maximum update depth exceeded" / reentrancy), failing the test.
    render(<PageSelectModal />);

    // Resolve the root-page fetch so ItemsTree can stop suspending.
    await act(async () => {
      resolveRootPage?.();
      await rootPagePromise;
    });

    expect(await screen.findByTestId('items-tree')).toBeInTheDocument();

    // A healthy component suspends ItemsTree only a bounded number of times.
    expect(itemsTreeRenderCount).toBeLessThan(10);
  });
});
