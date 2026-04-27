import { Fragment, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { CopyIcon, GlobeIcon, RefreshCcwIcon, XIcon } from 'lucide-react';
import { v7 as uuid } from 'uuid';

import { Action, Actions } from '~/components/ai-elements/actions';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '~/components/ai-elements/conversation';
import { Loader } from '~/components/ai-elements/loader';
import { Message, MessageContent } from '~/components/ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '~/components/ai-elements/prompt-input';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '~/components/ai-elements/reasoning';
import { Response } from '~/components/ai-elements/response';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '~/components/ai-elements/sources';

import {
  useChatSidebarActions,
  useChatSidebarStatus,
} from '../../status/chat-sidebar';
import { useSWRxMessages } from '../../stores/message';
import { useSWRINFxRecentThreads } from '../../stores/thread';

import styles from './ChatSidebar.module.scss';

const models = [
  {
    name: 'GPT 4o',
    value: 'openai/gpt-4o',
  },
  {
    name: 'Deepseek R1',
    value: 'deepseek/deepseek-r1',
  },
];

const moduleClass = styles['grw-chat-sidebar'] ?? '';

export const ChatSidebar = (): JSX.Element => {
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);

  const chatSidebarStatus = useChatSidebarStatus();
  const { close } = useChatSidebarActions();
  const threadId = chatSidebarStatus?.threadId;

  // Generate a stable thread id for this chat session.
  // For an existing thread, reuse the given id; for a new chat, mint one
  // so every message in the same session targets the same thread on the
  // server (the server creates the thread on first use).
  const [chatThreadId] = useState<string>(() => threadId ?? uuid());

  const { data: savedMessages } = useSWRxMessages(threadId);
  const swrInfiniteThreads = useSWRINFxRecentThreads();
  const { mutate: mutateRecentThreads } = swrInfiniteThreads;

  const { messages, sendMessage, status, regenerate, setMessages } = useChat({
    id: chatThreadId,
    transport: new DefaultChatTransport({ api: '/_api/v3/mastra/message' }),
    // Refresh the thread list after the assistant finishes streaming.
    //
    // The thread itself is persisted by the time the stream closes, but
    // Mastra's auto-generated title (configured via `generateTitle: true`
    // on the Memory) is written asynchronously and may land slightly later.
    //
    // This is an intentional design choice of Mastra. See:
    //   https://mastra.ai/docs/memory/storage
    //   > Title generation operates asynchronously after the agent
    //   > responds, ensuring it doesn't impact response times.
    //
    // Mastra exposes no event for "title persisted", so poll briefly until
    // the title for the current thread shows up in the list.
    onFinish: async () => {
      const targetId = chatThreadId;
      const maxAttempts = 5;
      const intervalMs = 1000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // biome-ignore lint/performance/noAwaitInLoops: intentionally poll in series with a delay
        const pages = await mutateRecentThreads();
        const thread = pages
          ?.flatMap((p) => p.threads)
          .find((t) => t.id === targetId);
        if (thread?.title) return;
        await new Promise((resolve) => {
          setTimeout(resolve, intervalMs);
        });
      }
    },
  });

  useEffect(() => {
    if (savedMessages == null) return;
    setMessages(savedMessages);
  }, [savedMessages, setMessages]);

  const handleSubmit = (message: PromptInputMessage) => {
    sendMessage(
      {
        text: message.text || 'Hello World',
        files: message.files,
      },
      {
        body: {
          aiAssistantId: chatSidebarStatus?.aiAssistantData?._id,
          threadId: chatThreadId,
        },
      },
    );
    setInput('');
  };

  return (
    <div
      className={`tw-root position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}
    >
      <div className="tw:max-w-4xl tw:mx-auto tw:p-6 tw:relative tw:size-full twh-screen">
        <div className="tw:flex tw:flex-col tw:h-full">
          <div className="tw:flex tw:items-center tw:gap-2 tw:shrink-0 tw:pb-2 tw:border-b tw:border-border">
            <span className="growi-custom-icons fs-4">ai_assistant</span>
            <span className="tw:flex-1 tw:font-semibold tw:truncate">
              {chatSidebarStatus.aiAssistantData?.name ?? 'AI Assistant'}
            </span>
            <button
              type="button"
              className="btn btn-ghost tw:p-1"
              aria-label="Close"
              onClick={close}
            >
              <XIcon size={16} />
            </button>
          </div>
          <Conversation className="tw:h-full">
            <ConversationContent>
              {messages.map((message) => (
                <div key={message.id}>
                  {message.role === 'assistant' &&
                    message.parts.filter((part) => part.type === 'source-url')
                      .length > 0 && (
                      <Sources>
                        <SourcesTrigger
                          count={
                            message.parts.filter(
                              (part) => part.type === 'source-url',
                            ).length
                          }
                        />
                        {message.parts
                          .filter((part) => part.type === 'source-url')
                          .map((_part, i) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <SourcesContent key={`${message.id}-${i}`}>
                              <Source
                                // eslint-disable-next-line react/no-array-index-key
                                key={`${message.id}-${i}`}
                                // href={part.url}
                                // title={part.url}
                              />
                            </SourcesContent>
                          ))}
                      </Sources>
                    )}
                  {message.parts.map((part, i) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          // eslint-disable-next-line react/no-array-index-key
                          <Fragment key={`${message.id}-${i}`}>
                            <Message from={message.role}>
                              <MessageContent variant="flat">
                                <Response
                                  className={
                                    message.role === 'assistant'
                                      ? 'tw-prose'
                                      : undefined
                                  }
                                >
                                  {part.text}
                                </Response>
                              </MessageContent>
                            </Message>
                            {message.role === 'assistant' &&
                              i === messages.length - 1 && (
                                <Actions className="tw:mt-2">
                                  <Action
                                    onClick={() => regenerate()}
                                    label="Retry"
                                  >
                                    <RefreshCcwIcon className="tw:size-3" />
                                  </Action>
                                  <Action
                                    onClick={() =>
                                      navigator.clipboard.writeText(part.text)
                                    }
                                    label="Copy"
                                  >
                                    <CopyIcon className="tw:size-3" />
                                  </Action>
                                </Actions>
                              )}
                          </Fragment>
                        );
                      case 'reasoning':
                        return (
                          <Reasoning
                            // eslint-disable-next-line react/no-array-index-key
                            key={`${message.id}-${i}`}
                            className="w-full"
                            isStreaming={
                              status === 'streaming' &&
                              i === message.parts.length - 1 &&
                              message.id === messages.at(-1)?.id
                            }
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      default:
                        return null;
                    }
                  })}
                </div>
              ))}
              {status === 'submitted' && <Loader />}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="tw:shrink-0 tw:pt-4">
            <PromptInput
              onSubmit={handleSubmit}
              inputGroupClassName="tw:rounded-xl"
              globalDrop
              multiple
            >
              <PromptInputBody>
                <PromptInputAttachments>
                  {(attachment) => <PromptInputAttachment data={attachment} />}
                </PromptInputAttachments>
                <PromptInputTextarea
                  onChange={(e) => setInput(e.target.value)}
                  value={input}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                  <PromptInputButton
                    className="tw:rounded-full"
                    variant={webSearch ? 'default' : 'ghost'}
                    onClick={() => setWebSearch(!webSearch)}
                  >
                    <GlobeIcon size={16} />
                    <span>Search</span>
                  </PromptInputButton>
                  <PromptInputModelSelect
                    onValueChange={(value) => {
                      setModel(value);
                    }}
                    value={model}
                  >
                    <PromptInputModelSelectTrigger>
                      <PromptInputModelSelectValue />
                    </PromptInputModelSelectTrigger>
                    <PromptInputModelSelectContent>
                      {models.map((model) => (
                        <PromptInputModelSelectItem
                          key={model.value}
                          value={model.value}
                        >
                          {model.name}
                        </PromptInputModelSelectItem>
                      ))}
                    </PromptInputModelSelectContent>
                  </PromptInputModelSelect>
                </PromptInputTools>
                <PromptInputSubmit
                  disabled={!input && !status}
                  status={status}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
};
