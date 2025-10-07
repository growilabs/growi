import type { FC } from 'react';
import { memo } from 'react';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import { useIsAdmin, useIsGuestUser } from '~/states/context';
import { useGrowiCloudUri } from '~/states/global';

import { SkeletonItem } from './SkeletonItem';

import styles from './SecondaryItems.module.scss';


const PersonalDropdown = dynamic(() => import('./PersonalDropdown').then(mod => mod.PersonalDropdown), {
  ssr: false,
  loading: () => <SkeletonItem />,
});


type SecondaryItemProps = {
  label: string,
  href: string,
  iconName: string,
  isBlank?: boolean,
}

const SecondaryItem: FC<SecondaryItemProps> = (props: SecondaryItemProps) => {
  const { iconName, href, isBlank } = props;

  return (
    <Link
      href={href}
      className="d-block btn btn-primary d-flex align-items-center justify-content-center"
      target={`${isBlank ? '_blank' : ''}`}
      prefetch={false}
    >
      <span className="material-symbols-outlined">{iconName}</span>
    </Link>
  );
};

export const SecondaryItems: FC = memo(() => {

  const isAdmin = useIsAdmin();
  const growiCloudUri = useGrowiCloudUri();
  const isGuestUser = useIsGuestUser();

  return (
    <div className={styles['grw-secondary-items']}>
      <SecondaryItem label="Help" iconName="help" href={growiCloudUri != null ? 'https://growi.cloud/help/' : 'https://docs.growi.org'} isBlank />
      {isAdmin && <SecondaryItem label="Admin" iconName="settings" href="/admin" />}
      <SecondaryItem label="Trash" href="/trash" iconName="delete" />
      {!isGuestUser && <PersonalDropdown />}
    </div>
  );
});
