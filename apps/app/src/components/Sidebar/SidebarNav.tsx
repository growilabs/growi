import React, {
  FC, memo, useCallback,
} from 'react';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import { useUserUISettings } from '~/client/services/user-ui-settings';
import { SidebarContentsType } from '~/interfaces/ui';
import {
  useIsAdmin, useGrowiCloudUri, useIsGuestUser,
} from '~/stores/context';
import { useCurrentSidebarContents } from '~/stores/ui';

import styles from './SidebarNav.module.scss';


const PersonalDropdown = dynamic(() => import('./PersonalDropdown').then(mod => mod.PersonalDropdown), { ssr: false });
const InAppNotificationDropdown = dynamic(() => import('../InAppNotification/InAppNotificationDropdown')
  .then(mod => mod.InAppNotificationDropdown), { ssr: false });
const AppearanceModeDropdown = dynamic(() => import('./AppearanceModeDropdown').then(mod => mod.AppearanceModeDropdown), { ssr: false });


type PrimaryItemProps = {
  contents: SidebarContentsType,
  label: string,
  iconName: string,
  onItemSelected: (contents: SidebarContentsType) => void,
}

const PrimaryItem: FC<PrimaryItemProps> = (props: PrimaryItemProps) => {
  const {
    contents, label, iconName, onItemSelected,
  } = props;

  const { data: currentContents, mutate } = useCurrentSidebarContents();
  const { scheduleToPut } = useUserUISettings();

  const isSelected = contents === currentContents;

  const itemSelectedHandler = useCallback(() => {
    if (onItemSelected != null) {
      onItemSelected(contents);
    }

    mutate(contents, false);

    scheduleToPut({ currentSidebarContents: contents });
  }, [contents, mutate, onItemSelected, scheduleToPut]);

  const labelForTestId = label.toLowerCase().replace(' ', '-');

  return (
    <button
      type="button"
      data-testid={`grw-sidebar-nav-primary-${labelForTestId}`}
      className={`d-block btn btn-primary ${isSelected ? 'active' : ''}`}
      onClick={itemSelectedHandler}
    >
      <i className="material-icons">{iconName}</i>
    </button>
  );
};

type SecondaryItemProps = {
  label: string,
  href: string,
  iconName: string,
  isBlank?: boolean,
}

const SecondaryItem: FC<SecondaryItemProps> = memo((props: SecondaryItemProps) => {
  const { iconName, href, isBlank } = props;

  return (
    <Link
      href={href}
      className="d-block btn btn-primary"
      target={`${isBlank ? '_blank' : ''}`}
      prefetch={false}
    >
      <i className="material-icons">{iconName}</i>
    </Link>
  );
});
SecondaryItem.displayName = 'SecondaryItem';


type Props = {
  onItemSelected: (contents: SidebarContentsType) => void,
}

export const SidebarNav: FC<Props> = (props: Props) => {
  const { data: isAdmin } = useIsAdmin();
  const { data: isGuestUser } = useIsGuestUser();
  const { data: growiCloudUri } = useGrowiCloudUri();

  const { onItemSelected } = props;

  const isAuthenticated = isGuestUser === false;

  return (
    <div className={`grw-sidebar-nav ${styles['grw-sidebar-nav']}`}>

      <div className="grw-sidebar-nav-primary-container" data-vrt-blackout-sidebar-nav>
        {/* eslint-disable max-len */}
        <PrimaryItem contents={SidebarContentsType.TREE} label="Page Tree" iconName="format_list_bulleted" onItemSelected={onItemSelected} />
        <PrimaryItem contents={SidebarContentsType.CUSTOM} label="Custom Sidebar" iconName="code" onItemSelected={onItemSelected} />
        <PrimaryItem contents={SidebarContentsType.RECENT} label="Recent Changes" iconName="update" onItemSelected={onItemSelected} />
        {/* <PrimaryItem id="tag" label="Tags" iconName="icon-tag" /> */}
        {/* <PrimaryItem id="favorite" label="Favorite" iconName="fa fa-bookmark-o" /> */}
        <PrimaryItem contents={SidebarContentsType.TAG} label="Tags" iconName="local_offer" onItemSelected={onItemSelected} />
        {/* <PrimaryItem id="favorite" label="Favorite" iconName="icon-star" /> */}
        {/* eslint-enable max-len */}
        <PrimaryItem contents={SidebarContentsType.BOOKMARKS} label="Bookmarks" iconName="bookmark" onItemSelected={onItemSelected} />
      </div>
      <div className="grw-sidebar-nav-secondary-container">
        <AppearanceModeDropdown isAuthenticated={isAuthenticated} />
        <PersonalDropdown />
        <InAppNotificationDropdown />

        {isAdmin && <SecondaryItem label="Admin" iconName="settings" href="/admin" />}
        {/* <SecondaryItem label="Draft" iconName="file_copy" href="/me/drafts" /> */}
        <SecondaryItem label="Help" iconName="help" href={growiCloudUri != null ? 'https://growi.cloud/help/' : 'https://docs.growi.org'} isBlank />
        <SecondaryItem label="Trash" iconName="delete" href="/trash" />
      </div>
    </div>
  );

};
