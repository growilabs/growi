import { type JSX, useRef } from 'react';
import { useTranslation } from 'next-i18next';

import {
  createEmptyFilterState,
  isFilterStateEmpty,
  type SearchFilterState,
} from '../../utils/search-query';

import styles from './SearchFilterChips.module.scss';

type Props = {
  filters: SearchFilterState;
  onChange: (filters: SearchFilterState) => void;
};

type ChipField = {
  field: keyof SearchFilterState;
  labelKey: string;
  fallback: string;
};

// Display order mirrors the filter panel fields.
const CHIP_FIELDS = [
  {
    field: 'authors',
    labelKey: 'search_result.filter_author',
    fallback: 'Author',
  },
  {
    field: 'editors',
    labelKey: 'search_result.filter_editor',
    fallback: 'Editor',
  },
  { field: 'tags', labelKey: 'search_result.filter_tag', fallback: 'Tag' },
  {
    field: 'groups',
    labelKey: 'search_result.filter_group',
    fallback: 'Group',
  },
] as const satisfies ReadonlyArray<ChipField>;

/**
 * Summarizes the active filters as removable chips. Reads the same
 * `SearchFilterState` the panel edits, so it stays in sync in both directions:
 * removing a chip here updates the controlled panel widgets, and adding a filter
 * in the panel adds a chip here. Renders nothing when no filter is set.
 */
export const SearchFilterChips = (props: Props): JSX.Element | null => {
  const { filters, onChange } = props;
  const { t } = useTranslation();

  // Removing a chip unmounts its button, which would drop focus to <body>. Move
  // focus to the always-present "clear all" button so keyboard users keep their
  // place in the bar. (When the last chip goes, the bar unmounts entirely — that
  // focus hand-off is the parent's concern, not this component's.)
  const clearAllRef = useRef<HTMLButtonElement>(null);

  if (isFilterStateEmpty(filters)) {
    return null;
  }

  const removeValue = (field: keyof SearchFilterState, value: string) => {
    onChange({
      ...filters,
      [field]: filters[field].filter((v) => v !== value),
    });
    clearAllRef.current?.focus();
  };

  const clearAll = () => {
    onChange(createEmptyFilterState());
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" + aria-label is the correct ARIA pattern for this inline filter-chip toolbar; a <fieldset> would impose form-grouping semantics and default chrome we do not want
    <div
      role="group"
      aria-label={t('search_result.filter', 'Filters')}
      className={`d-flex flex-wrap align-items-center gap-2 px-md-4 px-3 py-2 ${styles['filter-chips']}`}
    >
      {CHIP_FIELDS.map(({ field, labelKey, fallback }) => {
        const label = t(labelKey, fallback);
        // De-duplicate: a value can appear more than once (e.g. a hand-typed
        // `author:x author:x` hydrated from the URL), which would otherwise
        // produce duplicate React keys and a remove that clears every copy.
        const values = Array.from(new Set(filters[field]));
        return values.map((value) => (
          <span
            key={`${field}:${value}`}
            className={`badge d-inline-flex align-items-center mw-100 ${styles.chip}`}
          >
            <span className={styles['chip-label']}>{label}:</span>
            <span className={`text-truncate ${styles['chip-value']}`}>
              {value}
            </span>
            <button
              type="button"
              className={`btn border-0 p-0 ms-1 d-inline-flex align-items-center ${styles['chip-remove']}`}
              aria-label={`${t('search_result.filter_remove', 'Remove')} ${label}: ${value}`}
              onClick={() => removeValue(field, value)}
            >
              <span className="material-symbols-outlined fs-6">close</span>
            </button>
          </span>
        ));
      })}
      <button
        ref={clearAllRef}
        type="button"
        className="btn btn-sm btn-link text-decoration-none p-0 ms-1"
        onClick={clearAll}
      >
        {t('search_result.filter_clear', 'Clear all')}
      </button>
    </div>
  );
};
