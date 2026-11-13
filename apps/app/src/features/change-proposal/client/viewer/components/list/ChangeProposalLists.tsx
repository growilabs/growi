import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import {
  useSWRInfxAppliedChangeProposals,
  useSWRInfxMyChangeProposals,
} from '../../stores/use-swrinfx-change-proposal-lists';
import { ChangeProposalSummaryItem } from './ChangeProposalSummaryItem';

const LIST_PAGE_SIZE = 20;

type ListBodyProps = {
  readonly items: readonly ChangeProposalSummaryView[];
  readonly dateOf: (proposal: ChangeProposalSummaryView) => string;
  readonly hasMore: boolean;
  readonly isLoaded: boolean;
  readonly isValidating: boolean;
  readonly hasError: boolean;
  readonly onLoadMore: () => void;
};

const ListBody = ({
  items,
  dateOf,
  hasMore,
  isLoaded,
  isValidating,
  hasError,
  onLoadMore,
}: ListBodyProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div>
      {items.length > 0 && (
        <ul className="list-group mb-3">
          {items.map((proposal) => (
            <ChangeProposalSummaryItem
              key={proposal.id}
              proposal={proposal}
              dateTime={dateOf(proposal)}
            />
          ))}
        </ul>
      )}
      {hasError && (
        <div className="alert alert-danger" role="alert">
          {t('change_proposal_viewer.list.error')}
        </div>
      )}
      {hasMore ? (
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={isValidating}
          onClick={onLoadMore}
        >
          {t('change_proposal_viewer.list.load_more')}
        </button>
      ) : (
        isLoaded &&
        !hasError && (
          <p className="text-muted">
            {items.length === 0
              ? t('change_proposal_viewer.list.empty')
              : t('change_proposal_viewer.list.no_more')}
          </p>
        )
      )}
    </div>
  );
};

const MyChangeProposalsList = (): JSX.Element => {
  const { data, error, size, setSize, isValidating } =
    useSWRInfxMyChangeProposals(LIST_PAGE_SIZE);

  return (
    <ListBody
      items={data?.flatMap((page) => page.items) ?? []}
      dateOf={(proposal) => proposal.createdAt}
      hasMore={data?.at(-1)?.hasNext === true}
      isLoaded={data != null}
      isValidating={isValidating}
      hasError={error != null}
      onLoadMore={() => setSize(size + 1)}
    />
  );
};

const AppliedChangeProposalsList = (): JSX.Element => {
  const { data, error, size, setSize, isValidating } =
    useSWRInfxAppliedChangeProposals(LIST_PAGE_SIZE);

  // An empty batch with a cursor is not the end: only a missing cursor is.
  return (
    <ListBody
      items={data?.flatMap((page) => page.items) ?? []}
      dateOf={(proposal) => proposal.lastAppliedAt ?? proposal.createdAt}
      hasMore={data?.at(-1)?.nextCursor != null}
      isLoaded={data != null}
      isValidating={isValidating}
      hasError={error != null}
      onLoadMore={() => setSize(size + 1)}
    />
  );
};

type ListTab = 'mine' | 'applied';

export const ChangeProposalLists = (): JSX.Element => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ListTab>('mine');

  const tabs: readonly { readonly id: ListTab; readonly label: string }[] = [
    { id: 'mine', label: t('change_proposal_viewer.list.tab.mine') },
    { id: 'applied', label: t('change_proposal_viewer.list.tab.applied') },
  ];

  return (
    <div>
      <h1 className="h3 mb-3">{t('change_proposal_viewer.list.title')}</h1>
      <ul className="nav nav-tabs mb-3">
        {tabs.map(({ id, label }) => (
          <li key={id} className="nav-item">
            <button
              type="button"
              aria-current={activeTab === id}
              className={`nav-link ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
      {activeTab === 'mine' ? (
        <MyChangeProposalsList />
      ) : (
        <AppliedChangeProposalsList />
      )}
    </div>
  );
};
