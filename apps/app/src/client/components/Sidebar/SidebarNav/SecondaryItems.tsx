import type { FC } from 'react';
import { memo } from 'react';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import { useIsAdmin, useIsGuestUser } from '~/states/context';

import { HelpDropdown } from './HelpDropdown';
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
  const isGuestUser = useIsGuestUser();

  return (
    <div className={styles['grw-secondary-items']}>
      <HelpDropdown />
      {isAdmin && <SecondaryItem label="Admin" iconName="settings" href="/admin" />}
      <SecondaryItem label="Trash" href="/trash" iconName="delete" />
      {!isGuestUser && <PersonalDropdown />}
    </div>
  );
});
