import { type FC, useRef, useState } from 'react';
import type { EditingClient } from '@growi/editor';
import { UserPicture } from '@growi/ui/dist/components';
import { Popover, PopoverBody } from 'reactstrap';

import styles from './EditingUserList.module.scss';

const userListPopoverClass = styles['user-list-popover'] ?? '';

type Props = {
  clientList: EditingClient[];
  onUserClick?: (clientId: number) => void;
};

const AvatarWrapper: FC<{
  client: EditingClient;
  onUserClick?: (clientId: number) => void;
}> = ({ client, onUserClick }) => {
  return (
    <UserPicture
      user={client}
      noLink
      testId={`avatar-wrapper-${client.clientId}`}
      rootClassName="d-flex rounded-circle"
      rootStyle={{ border: `2px solid ${client.color}` }}
      onClick={
        onUserClick != null ? () => onUserClick(client.clientId) : undefined
      }
    />
  );
};

export const EditingUserList: FC<Props> = ({ clientList, onUserClick }) => {
  const popoverTargetRef = useRef<HTMLButtonElement>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const togglePopover = () => setIsPopoverOpen(!isPopoverOpen);

  const firstFourUsers = clientList.slice(0, 4);
  const remainingUsers = clientList.slice(4);

  if (clientList.length === 0) {
    return null;
  }

  return (
    <div className="d-flex">
      {firstFourUsers.map((editingClient) => (
        <div key={editingClient.clientId} className="ms-1">
          <AvatarWrapper client={editingClient} onUserClick={onUserClick} />
        </div>
      ))}

      {remainingUsers.length > 0 && (
        <div className="ms-1">
          <button
            type="button"
            ref={popoverTargetRef}
            className="btn border-0 bg-info-subtle rounded-pill p-0"
            onClick={togglePopover}
          >
            <span className="fw-bold text-info p-1">
              +{remainingUsers.length}
            </span>
          </button>
          <Popover
            placement="bottom"
            isOpen={isPopoverOpen}
            target={popoverTargetRef}
            toggle={togglePopover}
            trigger="legacy"
          >
            <PopoverBody className={userListPopoverClass}>
              <div className="d-flex flex-wrap gap-1">
                {remainingUsers.map((editingClient) => (
                  <AvatarWrapper
                    key={editingClient.clientId}
                    client={editingClient}
                    onUserClick={onUserClick}
                  />
                ))}
              </div>
            </PopoverBody>
          </Popover>
        </div>
      )}
    </div>
  );
};
