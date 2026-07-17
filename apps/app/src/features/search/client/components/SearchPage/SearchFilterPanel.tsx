import { type JSX, type ReactNode, useCallback, useId, useState } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { Dropdown, DropdownMenu, DropdownToggle } from 'reactstrap';

import { SearchUsernameTypeahead } from '~/client/components/Admin/AuditLog/SearchUsernameTypeahead';
import { TagsInput } from '~/client/components/PageTags/TagEditModal/TagsInput';
import { useSWRxUserRelatedGroups } from '~/stores/user';

import type { SearchFilterState } from '../../utils/search-query';

import styles from './SearchFilterPanel.module.scss';

type Props = {
  filters: SearchFilterState;
  onChange: (filters: SearchFilterState) => void;
};

type FilterFieldCellProps = {
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * Grid cell + heading shared by every filter field. The heading is a <div>, not
 * a <label>: the reused controls render their own composite widgets with no
 * single native input to bind to; proper a11y association is the a11y step.
 */
const FilterFieldCell = (props: FilterFieldCellProps): JSX.Element => {
  const { label, className, children } = props;
  return (
    <div
      className={`col-12 col-lg-6${className != null ? ` ${className}` : ''}`}
    >
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
    <FilterFieldCell label={label} className={styles['username-filter']}>
      {/*
        Semi-controlled via `initialUsernames`, not `selected`: the typeahead
        keeps each item's `category` internally, which this panel (usernames
        only) can't supply — unlike the fully-controlled TagsInput below.
      */}
      <SearchUsernameTypeahead
        id={id}
        onChange={onChange}
        initialUsernames={usernames}
        placeholder={placeholder}
      />
    </FilterFieldCell>
  );
};

type GroupFilterFieldProps = {
  label: string;
  selected: string[];
  onChange: (groups: string[]) => void;
};

/**
 * Groups are a finite per-user set, so this is a checklist dropdown rather than a
 * typeahead. The stored value is the group NAME, not the id: the server resolves
 * `group:` terms by name (see resolveFilterData in server/service/search.ts).
 *
 * Because selection is name-based, groups that share a name (a UserGroup and an
 * ExternalUserGroup can collide) are one selection unit by design: they toggle
 * together and count once in the badge. This mirrors the server, which resolves a
 * name to every matching group id, so the filter intentionally spans all of them.
 */
const GroupFilterField = (props: GroupFilterFieldProps): JSX.Element => {
  const { label, selected, onChange } = props;
  const { t } = useTranslation();
  const { data } = useSWRxUserRelatedGroups();
  const [isOpen, setIsOpen] = useState(false);
  const baseId = useId();

  // A nullish `data` is still loading; only an empty relatedGroups array is a
  // real "no groups". Distinguish them so the empty message doesn't flash first.
  const isLoading = data == null;
  const groups = data?.relatedGroups ?? [];

  const toggleGroup = useCallback(
    (name: string, checked: boolean) => {
      onChange(
        checked ? [...selected, name] : selected.filter((n) => n !== name),
      );
    },
    [onChange, selected],
  );

  return (
    <FilterFieldCell label={label}>
      <Dropdown isOpen={isOpen} toggle={() => setIsOpen((v) => !v)}>
        <DropdownToggle
          caret
          color="outline-secondary"
          className="w-100 d-flex align-items-center justify-content-between"
        >
          <span>{t('search_result.filter_group_select', 'Select groups')}</span>
          {selected.length > 0 && (
            <span className="badge bg-primary ms-2">{selected.length}</span>
          )}
        </DropdownToggle>
        <DropdownMenu className="w-100 px-2">
          {isLoading ? (
            <span className="text-muted px-2">
              <LoadingSpinner className="me-1" />
            </span>
          ) : groups.length === 0 ? (
            <span className="text-muted px-2">
              {t('search_result.filter_group_none', 'No groups available')}
            </span>
          ) : (
            groups.map((group, index) => {
              const name = group.item.name;
              const checkboxId = `${baseId}-${index}`;
              return (
                <div className="form-check py-1" key={String(group.item._id)}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={checkboxId}
                    checked={selected.includes(name)}
                    onChange={(e) => toggleGroup(name, e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor={checkboxId}>
                    {name}
                  </label>
                </div>
              );
            })
          )}
        </DropdownMenu>
      </Dropdown>
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
  // Self-generated so this panel's tag input gets a unique, SSR-stable id even
  // when the panel is mounted more than once (desktop inline + mobile modal).
  const tagsInputId = useId();

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

  const groupsChangeHandler = useCallback(
    (groups: string[]) => {
      onChange({ ...filters, groups });
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
            id={tagsInputId}
            tags={filters.tags}
            autoFocus={false}
            onTagsUpdated={tagsChangeHandler}
          />
        </FilterFieldCell>
        <GroupFilterField
          label={t('search_result.filter_group', 'Group')}
          selected={filters.groups}
          onChange={groupsChangeHandler}
        />
      </div>
    </div>
  );
};
