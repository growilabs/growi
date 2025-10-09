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

        {/* Messages display */}
        {/* <div className="tw-p-2">
          {messages.map((message, index) => (
            <div key={`message-${message.id || index}`} className="tw-mb-2 tw-p-2 tw-bg-gray-100 tw-rounded">
              <strong className="tw-text-sm tw-font-medium">{message.role}:</strong>
              <div className="tw-text-sm">{message.content}</div>
            </div>
          ))}
        </div> */}

        {/* ============================================ */}
        {/*   TODO: REMOVE THIS TEMPORARY DEBUG BUTTON   */}
        {/* ============================================ */}
        <div className="tw-p-4 tw-space-y-2">
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
            Send Message (Bootstrap)
          </button>

          {/* Tailwind test button */}
          <button
            type="button"
            className="tw-btn-primary tw-w-full"
            onClick={() => {
              sendMessage(
                { role: 'user', parts: [{ type: 'text', text: 'Hello from Tailwind!' }] },
                { body: { aiAssistantId: '68ccfba032a1048fe5548d5d' } },
              );
            }}
          >
            Send Message (Tailwind)
          </button>

          {/* Test text styles */}
          <div className="tw-card">
            <h3 className="tw-text-lg tw-font-semibold tw-text-gray-200 tw-mb-2">Tailwind Test</h3>
            <p className="tw-text-sm tw-text-gray-600">
              This text is styled with Tailwind CSS utilities to test the integration.
            </p>
          </div>
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
