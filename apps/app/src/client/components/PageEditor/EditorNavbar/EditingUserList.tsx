import { type FC, useRef, useState } from 'react';
import type { EditingClient } from '@growi/editor';
import { UserPicture } from '@growi/ui/dist/components';
import { Popover, PopoverBody } from 'reactstrap';

import styles from './EditingUserList.module.scss';

const userListPopoverClass = styles['user-list-popover'] ?? '';
const avatarWrapperClass = styles['avatar-wrapper'] ?? '';

type Props = {
  clientList: EditingClient[];
  onUserClick?: (clientId: number) => void;
};

const AvatarWrapper: FC<{
  client: EditingClient;
  onUserClick?: (clientId: number) => void;
}> = ({ client, onUserClick }) => {
  return (
    <button
      type="button"
      data-testid={`avatar-wrapper-${client.clientId}`}
      className={`${avatarWrapperClass} d-inline-flex align-items-center justify-content-center p-0 bg-transparent rounded-circle`}
      style={{ border: `2px solid ${client.color}` }}
      onClick={() => onUserClick?.(client.clientId)}
    >
      <UserPicture user={client} noLink />
    </button>
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
    <div className="d-flex flex-column justify-content-start justify-content-sm-end">
      <div className="d-flex justify-content-start justify-content-sm-end">
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
    </div>
  );
};
