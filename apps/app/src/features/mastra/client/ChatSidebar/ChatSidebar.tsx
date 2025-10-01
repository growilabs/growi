
import SimpleBar from 'simplebar-react';

import styles from './ChatSidebar.module.scss';

const moduleClass = styles['grw-chat-sidebar'] ?? '';

const ChatSidebarSubstance = (): JSX.Element => {
  return (
    <div
      className={`position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}
    >
      <SimpleBar
        className="h-100"
        autoHide
      >
      </SimpleBar>
    </div>
  );
};


export const ChatSidebar = (): JSX.Element => {
  const isAiEnable = true;

  if (!isAiEnable) {
    return <></>;
  }

  return (
    <ChatSidebarSubstance />
  );
};
