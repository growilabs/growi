import { type JSX, useCallback } from 'react';
import { useTranslation } from 'next-i18next';

import { SearchUsernameTypeahead } from '~/client/components/Admin/AuditLog/SearchUsernameTypeahead';

import type { SearchFilterState } from '../../utils/search-query';

type Props = {
  filters: SearchFilterState;
  onChange: (filters: SearchFilterState) => void;
};

/**
 * Controlled: the parent (`SearchControl`) owns `SearchFilterState` and merges it
 * into the query at request time, so widgets here only map their value in/out.
 */
export const SearchFilterPanel = (props: Props): JSX.Element => {
  const { filters, onChange } = props;
  const { t } = useTranslation();

  const authorsChangeHandler = useCallback(
    (authors: string[]) => {
      onChange({ ...filters, authors });
    },
    [filters, onChange],
  );

  return (
    <div className="p-3">
      <div className="row g-3">
        <div className="col-12 col-lg-6">
          {/* A <div>, not a <label>: the reused typeahead renders its own
              composite control; a11y association is handled in the a11y step. */}
          <div className="form-label text-secondary mb-1">
            {t('search_result.filter_author', 'Author')}
          </div>
          <SearchUsernameTypeahead
            onChange={authorsChangeHandler}
            initialUsernames={filters.authors}
            placeholder={t(
              'search_result.filter_by_author',
              'Filter by author',
            )}
          />
        </div>
      </div>
    </div>
  );
};
