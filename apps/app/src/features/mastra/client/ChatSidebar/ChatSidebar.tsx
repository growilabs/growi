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

        {/* eslint-disable-next-line max-len */}
        <button type="button" className="tw:text-white tw:bg-gradient-to-r tw:from-purple-500 tw:to-pink-500 hover:tw:bg-gradient-to-l tw:focus:ring-4 tw:focus:outline-none tw:focus:ring-purple-200 dark:tw:focus:ring-purple-800 tw:font-medium tw:rounded-lg tw:text-sm tw:px-5 tw:py-2.5 tw:text-center tw:me-2 tw:mb-2">tailwind button</button>
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
