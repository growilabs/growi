import { type FC, useState } from 'react';

import type { IUserHasId } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import { Popover, PopoverBody } from 'reactstrap';

import UserPictureList from '../../Common/UserPictureList';

import styles from './EditingUserList.module.scss';

const userListPopoverClass = styles['user-list-popover'] ?? '';

type Props = {
  userList: IUserHasId[]
}

export const EditingUserList: FC<Props> = ({ userList }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const togglePopover = () => setIsPopoverOpen(!isPopoverOpen);

  const firstFourUsers = userList.slice(0, 4);
  const remainingUsers = userList.slice(4);

  if (userList.length === 0) {
    return <></>;
  }

  return (
    <div className="d-flex flex-column justify-content-start justify-content-sm-end">
      <div className="d-flex justify-content-start justify-content-sm-end">
        {firstFourUsers.map(user => (
          <div key={user._id} className="ms-1">
            <UserPicture
              user={user}
              noLink
              additionalClassName="border border-info"
            />
          </div>
        ))}

        {remainingUsers.length > 0 && (
          <div className="ms-1">
            <button type="button" id="btn-editing-user" className="btn border-0 bg-info-subtle rounded-pill p-0">
              <span className="fw-bold text-info p-1">+{remainingUsers.length}</span>
            </button>
            <Popover placement="bottom" isOpen={isPopoverOpen} target="btn-editing-user" toggle={togglePopover} trigger="legacy">
              <PopoverBody className={userListPopoverClass}>
                <UserPictureList users={remainingUsers} />
              </PopoverBody>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
};
