import React, { type JSX, type ReactNode, useCallback, useState } from 'react';
import { getIdForRef, PageGrant } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from 'reactstrap';

import { useCurrentUser } from '~/states/global';
import { useCurrentPageId } from '~/states/page';
import { toSelectedGrant, useSelectedGrant } from '~/states/ui/editor';
import { useSWRxCurrentGrantData } from '~/stores/page';

import { SelectGroupModal } from './SelectGroupModal';

export { GroupMembersLabel } from './GroupMembersLabel';

const AVAILABLE_GRANTS = [
  {
    grant: PageGrant.GRANT_PUBLIC,
    iconName: 'group',
    btnStyleClass: 'outline-info',
    label: 'Public',
  },
  {
    grant: PageGrant.GRANT_RESTRICTED,
    iconName: 'link',
    btnStyleClass: 'outline-success',
    label: 'Anyone with the link',
  },
  // { grant: 3, iconClass: '', label: 'Specified users only' },
  {
    grant: PageGrant.GRANT_OWNER,
    iconName: 'lock',
    btnStyleClass: 'outline-danger',
    label: 'Only me',
  },
  {
    grant: PageGrant.GRANT_USER_GROUP,
    iconName: 'more_horiz',
    btnStyleClass: 'outline-warning',
    label: 'Only inside the group',
    reselectLabel: 'Reselect the group',
  },
];

type Props = {
  disabled?: boolean;
  openInModal?: boolean;
};

/**
 * Page grant select component
 */
export const GrantSelector = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { disabled, openInModal } = props;

  const [isSelectGroupModalShown, setIsSelectGroupModalShown] = useState(false);

  const currentUser = useCurrentUser();

  const [selectedGrant, setSelectedGrant] = useSelectedGrant();
  const currentPageId = useCurrentPageId();
  const { data: grantData } = useSWRxCurrentGrantData(currentPageId);

  const currentPageGrantData = grantData?.grantData.currentPageGrant;
  const groupGrantData = currentPageGrantData?.groupGrantData;

  // Re-apply the current page grant when the user (re)opens the group selection,
  // so the modal reflects the groups currently granted to the page.
  // Initial sync of selectedGrantAtom is owned by useSyncSelectedGrantWithCurrentPage
  // (called from the always-mounted SavePageControls) — see issue #11272.
  const applyCurrentPageGrantToSelectedGrant = useCallback(() => {
    if (currentPageGrantData == null) return;
    setSelectedGrant(toSelectedGrant(currentPageGrantData));
  }, [currentPageGrantData, setSelectedGrant]);

  const showSelectGroupModal = useCallback(() => {
    setIsSelectGroupModalShown(true);
  }, []);

  /**
   * change event handler for grant selector
   */
  const changeGrantHandler = useCallback(
    (grant: PageGrant) => {
      // select group
      if (grant === 5) {
        if (selectedGrant?.grant !== 5) applyCurrentPageGrantToSelectedGrant();
        showSelectGroupModal();
        return;
      }

      setSelectedGrant({ grant, userRelatedGrantedGroups: undefined });
    },
    [
      setSelectedGrant,
      showSelectGroupModal,
      applyCurrentPageGrantToSelectedGrant,
      selectedGrant?.grant,
    ],
  );

  /**
   * Render grant selector DOM.
   */
  const renderGrantSelector = useCallback(() => {
    // Until the current page grant is loaded, selectedGrant is null. Show a loading
    // state instead of defaulting the toggle to "Public", which would mislead the
    // user about the page's actual visibility. See issue #11272.
    if (selectedGrant == null) {
      return (
        <div
          className="grw-grant-selector mb-0"
          data-testid="grw-grant-selector"
        >
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm w-100 d-flex justify-content-center align-items-center"
            disabled
            data-testid="grw-grant-selector-loading"
          >
            <LoadingSpinner />
          </button>
        </div>
      );
    }

    let dropdownToggleBtnColor: string | undefined;
    let dropdownToggleLabelElm: ReactNode | undefined;

    const userRelatedGrantedGroups =
      groupGrantData?.userRelatedGroups.filter((group) => {
        return selectedGrant?.userRelatedGrantedGroups?.some(
          (grantedGroup) => getIdForRef(grantedGroup.item) === group.id,
        );
      }) ?? [];
    const nonUserRelatedGrantedGroups =
      groupGrantData?.nonUserRelatedGrantedGroups ?? [];

    const dropdownMenuElems = AVAILABLE_GRANTS.map((opt) => {
      const label =
        opt.grant === 5 &&
        opt.reselectLabel != null &&
        userRelatedGrantedGroups.length > 0
          ? opt.reselectLabel // when grantGroup is selected
          : opt.label;

      const labelElm = (
        <span className={openInModal ? 'py-2' : ''}>
          <span className="material-symbols-outlined me-2">{opt.iconName}</span>
          <span className="label">{t(label)}</span>
        </span>
      );

      // set dropdownToggleBtnColor, dropdownToggleLabelElm
      if (opt.grant === 1 || opt.grant === selectedGrant?.grant) {
        dropdownToggleBtnColor = opt.btnStyleClass;
        dropdownToggleLabelElm = labelElm;
      }

      return (
        <DropdownItem
          key={opt.grant}
          onClick={() => changeGrantHandler(opt.grant)}
        >
          {labelElm}
        </DropdownItem>
      );
    });

    // add specified group option
    if (
      selectedGrant?.grant === PageGrant.GRANT_USER_GROUP &&
      (userRelatedGrantedGroups.length > 0 ||
        nonUserRelatedGrantedGroups.length > 0)
    ) {
      const grantedGroupNames = [
        ...userRelatedGrantedGroups.map((group) => group.name),
        ...nonUserRelatedGrantedGroups.map((group) => group.name),
      ];
      const labelElm = (
        <span>
          <span className="material-symbols-outlined me-1">account_tree</span>
          <span className="label">
            {grantedGroupNames.length > 1 ? (
              // substring for group name truncate
              <span>
                {`${grantedGroupNames[0].substring(0, 30)}, ... `}
                <span className="badge bg-primary">
                  +{grantedGroupNames.length - 1}
                </span>
              </span>
            ) : (
              grantedGroupNames[0].substring(0, 30)
            )}
          </span>
        </span>
      );

      // set dropdownToggleLabelElm
      dropdownToggleLabelElm = labelElm;

      dropdownMenuElems.push(
        <DropdownItem key="groupSelected">{labelElm}</DropdownItem>,
      );
    }

    return (
      <div className="grw-grant-selector mb-0" data-testid="grw-grant-selector">
        <UncontrolledDropdown direction={openInModal ? 'down' : 'up'} size="sm">
          <DropdownToggle
            color={dropdownToggleBtnColor}
            caret
            className="w-100 text-truncate d-flex justify-content-between align-items-center"
            disabled={disabled}
          >
            {dropdownToggleLabelElm}
          </DropdownToggle>
          <DropdownMenu
            data-testid="grw-grant-selector-dropdown-menu"
            container={openInModal ? '' : 'body'}
          >
            {dropdownMenuElems}
          </DropdownMenu>
        </UncontrolledDropdown>
      </div>
    );
  }, [
    changeGrantHandler,
    disabled,
    groupGrantData,
    selectedGrant,
    t,
    openInModal,
  ]);

  return (
    <>
      {renderGrantSelector()}

      {!disabled && currentUser != null && (
        <SelectGroupModal
          isOpen={isSelectGroupModalShown}
          onClose={() => setIsSelectGroupModalShown(false)}
          currentUser={currentUser}
          selectedGrant={selectedGrant}
          setSelectedGrant={setSelectedGrant}
          groupGrantData={groupGrantData}
        />
      )}
    </>
  );
};
