import type { JSX, KeyboardEvent } from 'react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import {
  useSWRInfxAppliedChangeProposals,
  useSWRInfxMyChangeProposals,
} from '../../stores/use-swrinfx-change-proposal-lists';
import { StatePanel } from '../StatePanel';
import { ChangeProposalSummaryItem } from './ChangeProposalSummaryItem';

import styles from './ChangeProposalLists.module.scss';

const LIST_PAGE_SIZE = 20;
const SKELETON_ITEM_KEYS = ['a', 'b', 'c'] as const;

const ListSkeleton = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <div aria-busy="true">
      <span className="visually-hidden">{t('Loading')}</span>
      <ul className={styles.items} aria-hidden="true">
        {SKELETON_ITEM_KEYS.map((key) => (
          <li key={key} className={`${styles.skeleton} placeholder-glow`}>
            <span className="placeholder col-3 rounded-pill" />
            <span className="placeholder col-6" />
            <span className="placeholder col-8 placeholder-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
};

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

  if (!isLoaded && !hasError) {
    return <ListSkeleton />;
  }

  return (
    <div>
      {items.length > 0 && (
        <ul className={styles.items}>
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
        <StatePanel icon="error" variant="error" role="alert">
          {t('change_proposal_viewer.list.error')}
        </StatePanel>
      )}
      {hasMore ? (
        <div className={styles.footer}>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={isValidating}
            onClick={onLoadMore}
          >
            {isValidating && (
              <span
                className="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              />
            )}
            {t('change_proposal_viewer.list.load_more')}
          </button>
        </div>
      ) : (
        isLoaded &&
        !hasError &&
        (items.length === 0 ? (
          <StatePanel icon="inbox">
            {t('change_proposal_viewer.list.empty')}
          </StatePanel>
        ) : (
          <p className={styles['end-of-list']}>
            {t('change_proposal_viewer.list.no_more')}
          </p>
        ))
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

const LIST_TABS = ['mine', 'applied'] as const;
type ListTab = (typeof LIST_TABS)[number];

const TAB_LABEL_KEYS = {
  mine: 'change_proposal_viewer.list.tab.mine',
  applied: 'change_proposal_viewer.list.tab.applied',
} as const satisfies Record<ListTab, string>;

// Arrow keys move between tabs and select them (selection follows focus).
const nextTabOf = (current: ListTab, key: string): ListTab | null => {
  const index = LIST_TABS.indexOf(current);
  switch (key) {
    case 'ArrowRight':
      return LIST_TABS[(index + 1) % LIST_TABS.length];
    case 'ArrowLeft':
      return LIST_TABS[(index - 1 + LIST_TABS.length) % LIST_TABS.length];
    case 'Home':
      return LIST_TABS[0];
    case 'End':
      return LIST_TABS[LIST_TABS.length - 1];
    default:
      return null;
  }
};

export const ChangeProposalLists = (): JSX.Element => {
  const { t } = useTranslation();
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<ListTab>('mine');
  const tabRefs = useRef<Partial<Record<ListTab, HTMLButtonElement | null>>>(
    {},
  );

  const tabIdOf = (tab: ListTab): string => `${idPrefix}-tab-${tab}`;

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const next = nextTabOf(activeTab, e.key);
    if (next == null) {
      return;
    }
    e.preventDefault();
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={t('change_proposal_viewer.list.title')}
        className={styles.tablist}
      >
        {LIST_TABS.map((tab) => {
          const isSelected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={tabIdOf(tab)}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className={styles.tab}
              onClick={() => setActiveTab(tab)}
              onKeyDown={onTabKeyDown}
            >
              {t(TAB_LABEL_KEYS[tab])}
            </button>
          );
        })}
      </div>
      {/* Only the selected panel is rendered, so the other list is not fetched. */}
      <div role="tabpanel" aria-labelledby={tabIdOf(activeTab)}>
        {activeTab === 'mine' ? (
          <MyChangeProposalsList />
        ) : (
          <AppliedChangeProposalsList />
        )}
      </div>
    </div>
  );
};
