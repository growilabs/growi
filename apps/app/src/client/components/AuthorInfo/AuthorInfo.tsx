import React from 'react';

import type { IUserHasId } from '@growi/core';
import { isPopulated, type IUser, type Ref } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';


import styles from './AuthorInfo.module.scss';

const UserLabel = ({ user }: { user: IUserHasId | Ref<IUser> }): JSX.Element => {
  if (isPopulated(user)) {
    return (
      <Link href={pagePathUtils.userHomepagePath(user)} prefetch={false}>
        {user.name}
      </Link>
    );
  }

  return <i>(anyone)</i>;
};


type AuthorInfoProps = {
  date: Date,
  user?: IUserHasId | Ref<IUser>,
  mode: 'create' | 'update',
  locate: 'subnav' | 'footer',
}

export const AuthorInfo = (props: AuthorInfoProps): JSX.Element => {
  const { t } = useTranslation();
  const {
    date, user, mode = 'create', locate = 'subnav',
  } = props;

  const formatType = 'yyyy/MM/dd HH:mm';

  const infoLabelForSubNav = mode === 'create'
    ? 'Created by'
    : 'Updated by';
  const nullinfoLabelForFooter = mode === 'create'
    ? 'Created by'
    : 'Updated by';
  const infoLabelForFooter = mode === 'create'
    ? t('author_info.created_at')
    : t('author_info.last_revision_posted_at');
  const userLabel = user != null
    ? (
      <UserLabel user={user} />
    )
    : <i>Unknown</i>;

  if (locate === 'footer') {
    try {
      return <p>{infoLabelForFooter} {format(new Date(date), formatType)} by <UserPicture user={user} size="sm" /> {userLabel}</p>;
    }
    catch (err) {
      if (err instanceof RangeError) {
        return <p>{nullinfoLabelForFooter} <UserPicture user={user} size="sm" /> {userLabel}</p>;
      }
      return <></>;
    }
  }

  const renderParsedDate = () => {
    try {
      return format(new Date(date), formatType);
    }
    catch (err) {
      return '';
    }
  };

  return (
    <div className={`grw-author-info ${styles['grw-author-info']} d-flex align-items-center`}>
      <div className="me-2">
        <UserPicture user={user} size="sm" />
      </div>
      <div>
        <div>{infoLabelForSubNav} {userLabel}</div>
        <div className="text-muted text-date" data-vrt-blackout-datetime>
          {renderParsedDate()}
        </div>
      </div>
    </div>
  );
};
