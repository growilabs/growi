import { type JSX, type ReactNode, useCallback, useId } from 'react';
import { useTranslation } from 'next-i18next';

import { SearchUsernameTypeahead } from '~/client/components/Admin/AuditLog/SearchUsernameTypeahead';
import { TagsInput } from '~/client/components/PageTags/TagEditModal/TagsInput';

import type { SearchFilterState } from '../../utils/search-query';

type Props = {
  filters: SearchFilterState;
  onChange: (filters: SearchFilterState) => void;
};

type FilterFieldCellProps = {
  label: string;
  children: ReactNode;
};

/**
 * Grid cell + heading shared by every filter field. The heading is a <div>, not
 * a <label>: the reused controls render their own composite widgets with no
 * single native input to bind to; proper a11y association is the a11y step.
 */
const FilterFieldCell = (props: FilterFieldCellProps): JSX.Element => {
  const { label, children } = props;
  return (
    <div className="col-12 col-lg-6">
      <div className="form-label text-secondary mb-1">{label}</div>
      {children}
    </div>
  );
};

type UsernameFilterFieldProps = {
  label: string;
  placeholder: string;
  usernames: string[];
  onChange: (usernames: string[]) => void;
};

const UsernameFilterField = (props: UsernameFilterFieldProps): JSX.Element => {
  const { label, placeholder, usernames, onChange } = props;
  // Self-generated so each rendered field gets a unique, SSR-stable typeahead id.
  const id = useId();
  return (
    <FilterFieldCell label={label}>
      <SearchUsernameTypeahead
        id={id}
        onChange={onChange}
        initialUsernames={usernames}
        placeholder={placeholder}
      />
    </FilterFieldCell>
  );
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

  const editorsChangeHandler = useCallback(
    (editors: string[]) => {
      onChange({ ...filters, editors });
    },
    [filters, onChange],
  );

  const tagsChangeHandler = useCallback(
    (tags: string[]) => {
      onChange({ ...filters, tags });
    },
    [filters, onChange],
  );

  return (
    <div className="p-3">
      <div className="row g-3">
        <UsernameFilterField
          label={t('search_result.filter_author', 'Author')}
          placeholder={t('search_result.filter_by_author', 'Filter by author')}
          usernames={filters.authors}
          onChange={authorsChangeHandler}
        />
        <UsernameFilterField
          label={t('search_result.filter_editor', 'Editor')}
          placeholder={t('search_result.filter_by_editor', 'Filter by editor')}
          usernames={filters.editors}
          onChange={editorsChangeHandler}
        />
        <FilterFieldCell label={t('search_result.filter_tag', 'Tag')}>
          <TagsInput
            tags={filters.tags}
            autoFocus={false}
            onTagsUpdated={tagsChangeHandler}
          />
        </FilterFieldCell>
      </div>
    </div>
  );
};
