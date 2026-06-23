// ref: https://elements.ai-sdk.dev/examples/chatbot

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { CopyIcon, RefreshCcwIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
} from '~/components/ai-elements/prompt-input';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '~/components/ai-elements/reasoning';
import { Response } from '~/components/ai-elements/response';
import { Button } from '~/components/ui/button';
import { PageMentionInput } from '~/features/mastra/client/components/PageMentionInput';
import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

import {
  useChatSidebarActions,
  useChatSidebarStatus,
} from '../../status/chat-sidebar';
import { useSWRxMessages } from '../../stores/message';
import { useSWRINFxRecentThreads } from '../../stores/thread';
import {
  createMastraChatTransport,
  resolveChatErrorDetail,
  resolveChatHeaderLabel,
} from './chat-sidebar-helpers';
import { IncompleteResponseNotice } from './IncompleteResponseNotice';
import { PageSources } from './PageSources';
import { extractPageSources } from './page-sources';

import styles from './ChatSidebar.module.scss';

const moduleClass = styles['grw-chat-sidebar'] ?? '';

export const ChatSidebar = (): JSX.Element => {
  const { t } = useTranslation();

  const [input, setInput] = useState('');

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
  const { data: threadPages, mutate: mutateRecentThreads } = swrInfiniteThreads;

  const headerLabel = resolveChatHeaderLabel(
    chatThreadId,
    threadPages?.flatMap((page) => page.threads) ?? [],
    t('ai_sidebar.new_chat'),
  );

  // Memoized so a stable transport instance survives re-renders (chatThreadId is
  // fixed for this session), instead of allocating a new one on every render.
  // The factory pins the threadId on the transport body so EVERY request — incl.
  // regenerate(), which sends no per-call body — carries it (see the factory).
  const transport = useMemo(
    () => createMastraChatTransport(chatThreadId),
    [chatThreadId],
  );

  const {
    messages,
    sendMessage,
    status,
    regenerate,
    setMessages,
    error,
    clearError,
  } = useChat<CustomUIMessage>({
    id: chatThreadId,
    transport,
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
    // The input stays editable while the assistant responds so the user can
    // compose the next message, but starting a new request is suppressed until
    // the current one settles. This guards both the submit button and the
    // keymap's Enter→requestSubmit path against double-sending while busy (#5).
    if (status === 'submitted' || status === 'streaming') {
      return;
    }
    // Nothing to send for an empty (or whitespace-only) message.
    const text = message.text ?? '';
    if (text.trim().length === 0) {
      return;
    }
    // The threadId rides on the transport body (see useChat above), so no
    // per-call body is needed here.
    sendMessage({ text });
    setInput('');
  };

  return (
    <div
      className={`tw-root position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}
    >
      <div className="tw:max-w-4xl tw:mx-auto tw:py-6 tw:relative tw:size-full twh-screen">
        <div className="tw:flex tw:flex-col tw:h-full">
          <div className="tw:flex tw:items-center tw:gap-2 tw:shrink-0 tw:px-6 tw:pb-2 tw:border-b tw:border-border">
            <span className="growi-custom-icons fs-4">ai_chat</span>
            <span className="tw:flex-1 tw:font-semibold tw:truncate">
              {headerLabel}
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
                  {message.role === 'assistant' && (
                    <PageSources sources={extractPageSources(message.parts)} />
                  )}
                  {message.parts.map((part, i) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <Fragment
                            // biome-ignore lint/suspicious/noArrayIndexKey: the text parts have no stable ID, but the index is sufficient for this static list
                            key={`${message.id}-${i}`}
                          >
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
                            // biome-ignore lint/suspicious/noArrayIndexKey: the reasoning parts have no stable ID, but the index is sufficient for this static list
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
                  {message.role === 'assistant' && (
                    <IncompleteResponseNotice
                      finishReason={message.metadata?.finishReason}
                    />
                  )}
                </div>
              ))}
              {(() => {
                // Keep the spinner up until *some* part of the assistant
                // reply (reasoning trigger or text body) is mounted.
                // `status === 'submitted'` covers the wait before the stream
                // opens; `status === 'streaming'` with an empty assistant
                // message covers the gap between stream open and the first
                // chunk (notable for reasoning models that pause to think
                // before emitting anything).
                if (status !== 'submitted' && status !== 'streaming') {
                  return null;
                }
                const last = messages.at(-1);
                const awaitingFirstPart =
                  last?.role !== 'assistant' || (last.parts?.length ?? 0) === 0;
                return awaitingFirstPart ? <Loader /> : null;
              })()}
              {error != null && (
                <div
                  role="alert"
                  className="tw:my-2 tw:flex tw:flex-col tw:gap-2 tw:rounded-lg tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-3 tw:text-sm"
                >
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                    <p className="tw:font-medium tw:text-destructive">
                      {t('ai_sidebar.error.title')}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="tw:-my-1"
                      aria-label={t('ai_sidebar.error.dismiss')}
                      onClick={() => clearError()}
                    >
                      <XIcon className="tw:size-3.5" />
                    </Button>
                  </div>
                  {(() => {
                    const detail = resolveChatErrorDetail(error);
                    return detail == null ? null : (
                      <p className="tw:break-words tw:text-muted-foreground">
                        {detail}
                      </p>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tw:self-end"
                    onClick={() => regenerate()}
                  >
                    <RefreshCcwIcon className="tw:mr-1 tw:size-3" />
                    {t('ai_sidebar.error.retry')}
                  </Button>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="tw:shrink-0 tw:px-6 tw:pt-4">
            <PromptInput
              onSubmit={handleSubmit}
              inputGroupClassName="tw:rounded-xl"
            >
              <PromptInputBody>
                <PageMentionInput
                  value={input}
                  onChange={setInput}
                  placeholder={t('pageMention.placeholder')}
                />
              </PromptInputBody>
              <PromptInputFooter className="tw:justify-end">
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
