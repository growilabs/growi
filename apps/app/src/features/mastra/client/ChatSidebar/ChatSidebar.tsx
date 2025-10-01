
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
    <div
      className={`position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}
    >
      <SimpleBar
        className="h-100"
        autoHide
      >

        {/* 後で消す */}
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
        {/* ここまで */}


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
