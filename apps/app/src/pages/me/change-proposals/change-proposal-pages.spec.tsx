// @vitest-environment happy-dom

import type { ComponentProps, ReactNode } from 'react';
import { useRouter } from 'next/router';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

// biome-ignore lint/style/noRestrictedImports: the spec checks the page routes against the URLs these client modules build
import { buildProposalHref } from '~/features/change-proposal/client/shared/proposal-links';
// biome-ignore lint/style/noRestrictedImports: the spec checks the page routes against the URLs these client modules build
import { CHANGE_PROPOSAL_LIST_HREF } from '~/features/change-proposal/client/viewer/consts';

import ChangeProposalDetailPage from './[id].page';
import ChangeProposalListPage from './index.page';

const detailRendered = vi.hoisted(() => vi.fn());
const listRendered = vi.hoisted(() => vi.fn());

vi.mock('next/router', () => ({ useRouter: vi.fn() }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const source = String(loader);
    if (source.includes('ChangeProposalDetail')) {
      return (props: { proposalId: string }) => {
        detailRendered(props);
        return <div data-testid="detail-component" />;
      };
    }
    return () => {
      listRendered();
      return <div data-testid="list-component" />;
    };
  },
}));
vi.mock('~/components/Layout/BasicLayout', () => ({
  BasicLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/Navbar/GroundGlassBar', () => ({
  GroundGlassBar: () => null,
}));
vi.mock('~/pages/basic-layout-page', () => ({
  getServerSideBasicLayoutProps: vi.fn(),
}));
vi.mock('~/pages/basic-layout-page/hydrate', () => ({
  useHydrateBasicLayoutConfigurationAtoms: vi.fn(),
}));
vi.mock('../../common-props', () => ({
  getServerSideCommonEachProps: vi.fn(),
  getServerSideCommonInitialProps: vi.fn(),
  getServerSideI18nProps: vi.fn(),
}));
vi.mock('../../utils/page-title-customization', () => ({
  useCustomTitle: (title: string) => title,
}));

const detailProps = mock<ComponentProps<typeof ChangeProposalDetailPage>>();
const listProps = mock<ComponentProps<typeof ChangeProposalListPage>>();

const VALID_ID = '65f1a2b3c4d5e6f708192a3b';

const mockQuery = (query: Record<string, string | string[] | undefined>) => {
  vi.mocked(useRouter).mockReturnValue({
    query,
  } as ReturnType<typeof useRouter>);
};

describe('change proposal page routes', () => {
  const pagesDir = join(__dirname, '..', '..');

  it('has a detail page file whose route resolves to buildProposalHref(id)', () => {
    const detailFile = 'me/change-proposals/[id].page.tsx';
    expect(existsSync(join(pagesDir, detailFile))).toBe(true);

    const route = `/${detailFile.replace(/\.page\.tsx$/, '')}`;
    expect(route.replace('[id]', VALID_ID)).toBe(buildProposalHref(VALID_ID));
  });

  it('has a list page file whose route resolves to the list URL', () => {
    const listFile = 'me/change-proposals/index.page.tsx';
    expect(existsSync(join(pagesDir, listFile))).toBe(true);

    const route = `/${listFile.replace(/\/index\.page\.tsx$/, '')}`;
    expect(route).toBe(CHANGE_PROPOSAL_LIST_HREF);
  });
});

describe('ChangeProposalDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the detail component with the id for a valid ObjectId', () => {
    mockQuery({ id: VALID_ID });
    render(<ChangeProposalDetailPage {...detailProps} />);

    expect(screen.getByTestId('detail-component')).toBeTruthy();
    expect(detailRendered).toHaveBeenCalledWith({ proposalId: VALID_ID });
  });

  it.each([
    ['a non-ObjectId string', 'not-an-object-id'],
    ['a too-short hex string', '65f1a2b3'],
    ['an array', ['a', 'b']],
    ['undefined', undefined],
  ])('shows not-found without rendering the detail component for %s', (_label, id) => {
    mockQuery({ id });
    render(<ChangeProposalDetailPage {...detailProps} />);

    expect(
      screen.getByText('change_proposal_viewer.detail.not_found'),
    ).toBeTruthy();
    expect(screen.queryByTestId('detail-component')).toBeNull();
    expect(detailRendered).not.toHaveBeenCalled();
  });
});

describe('ChangeProposalListPage', () => {
  it('renders the list component under the list title', () => {
    render(<ChangeProposalListPage {...listProps} />);

    expect(screen.getByTestId('list-component')).toBeTruthy();
    expect(screen.getByText('change_proposal_viewer.list.title')).toBeTruthy();
  });
});
