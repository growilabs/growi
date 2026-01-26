import type { FC, KeyboardEvent } from 'react';
import React, { useState } from 'react';
import type { IUserGroupHasId, IUserHasId } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { AsyncTypeahead } from 'react-bootstrap-typeahead';

import { toastError, toastSuccess } from '~/client/util/toastr';
import type { SearchType } from '~/interfaces/user-group';

type Props = {
  userGroup: IUserGroupHasId;
  onClickAddUserBtn: (username: string) => Promise<void>;
  onSearchApplicableUsers: (searchWord: string) => Promise<IUserHasId[]>;
  isAlsoNameSearched: boolean;
  isAlsoMailSearched: boolean;
  searchType: SearchType;
};

export const UserGroupUserFormByInput: FC<Props> = (props) => {
  const {
    userGroup,
    onClickAddUserBtn,
    onSearchApplicableUsers,
    isAlsoNameSearched,
    isAlsoMailSearched,
    searchType,
  } = props;

  const { t } = useTranslation();
  const [inputUser, setInputUser] = useState<IUserHasId[]>([]);
  const [applicableUsers, setApplicableUsers] = useState<IUserHasId[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchError, setIsSearchError] = useState(false);

  const addUserBySubmit = async () => {
    if (inputUser.length === 0) {
      return;
    }
    const userName = inputUser[0].username;

    try {
      await onClickAddUserBtn(userName);
      toastSuccess(`Added "${userName}" to "${userGroup.name}"`);
      setInputUser([]);
    } catch (err) {
      toastError(
        new Error(`Unable to add "${userName}" to "${userGroup.name}"`),
      );
    }
  };

  const searchApplicableUsers = async (keyword: string) => {
    try {
      const users = await onSearchApplicableUsers(keyword);
      setApplicableUsers(users);
      setIsLoading(false);
    } catch (err) {
      setIsSearchError(true);
      toastError(err);
    }
  };

  const handleChange = (inputUser: IUserHasId[]) => {
    setInputUser(inputUser);
  };

  const handleSearch = async (keyword: string) => {
    setIsLoading(true);
    await searchApplicableUsers(keyword);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      addUserBySubmit();
    }
  };

  const renderMenuItemChildren = (option: IUserHasId) => {
    const user = option;

    return (
      <>
        <UserPicture user={user} size="sm" noLink noTooltip />
        <strong className="ms-2">{user.username}</strong>
        {isAlsoNameSearched && <span className="ms-2">{user.name}</span>}
        {isAlsoMailSearched && <span className="ms-2">{user.email}</span>}
      </>
    );
  };

  return (
    <div className="row">
      <div className="col-8 pe-0">
        <AsyncTypeahead
          key={`${searchType}-${isAlsoNameSearched}-${isAlsoMailSearched}`} // The searched keywords are not re-searched, so re-rendered by key.
          id="name-typeahead-asynctypeahead"
          inputProps={{ autoComplete: 'off' }}
          isLoading={isLoading}
          labelKey={(user: IUserHasId) =>
            `${user.username} ${user.name} ${user.email}`
          }
          options={applicableUsers} // Search result
          onSearch={handleSearch}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          minLength={1}
          searchText={
            isLoading ? 'Searching...' : isSearchError && 'Error on searching.'
          }
          renderMenuItemChildren={renderMenuItemChildren}
          align="left"
          clearButton
        />
      </div>
      <div className="col-2 ps-0">
        <button
          type="button"
          className="btn btn-success"
          disabled={inputUser.length === 0}
          onClick={addUserBySubmit}
        >
          {t('add')}
        </button>
      </div>
    </div>
  );
};
