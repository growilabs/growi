import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import SimpleBar from 'simplebar-react';

import styles from './ChatSidebar.module.scss';

const moduleClass = styles['grw-chat-sidebar'] ?? '';

const ChatSidebarSubstance = (): JSX.Element => {
  const { messages, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: '/_api/v3/mastra/message' }),
  });

  return (
    <div className={`position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}>
      <SimpleBar className="h-100" autoHide>

        {/* ============================================ */}
        {/*   TODO: REMOVE THIS TEMPORARY DEBUG BUTTON   */}
        {/* ============================================ */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            sendMessage(
              { role: 'user', parts: [{ type: 'text', text: 'こんにちは' }] },
              { body: { aiAssistantId: '68ccfba032a1048fe5548d5d' } },
            );
          }}
        >
          Send Message
        </button>

        {/* tailwind alert examples */}
        <div className="tw:p-4 tw:mb-4 tw:text-sm tw:text-blue-800 tw:rounded-xl tw:bg-blue-50 tw:dark:bg-gray-800 tw:dark:text-blue-400" role="alert">
          <span className="tw:font-medium ">Hello Tailwind CSS!</span>
        </div>
        {/* ============================================ */}

      </SimpleBar>
    </div>
  );
};

export const ChatSidebar = (): JSX.Element => {
  const isOpened = true;

  if (!isOpened) {
    return <></>;
  }

  return (
    <ChatSidebarSubstance />
  );
};
