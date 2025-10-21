import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';

import { Header } from './ReactMarkdownComponents/Header';
import { NextLinkWrapper } from './ReactMarkdownComponents/NextLinkWrapper';

import styles from './MessageCard.module.scss';

const moduleClass = styles['message-card'] ?? '';

const userMessageCardModuleClass = styles['user-message-card'] ?? '';

const UserMessageCard = ({ children }: { children: string }): JSX.Element => (
  <div
    className={`card d-inline-flex align-self-end bg-success-subtle bg-info-subtle ${moduleClass} ${userMessageCardModuleClass}`}
  >
    <div className="card-body">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  </div>
);

const assistantMessageCardModuleClass = styles['assistant-message-card'] ?? '';

const AssistantMessageCard = ({
  children,
  additionalItem,
}: {
  children: string;
  additionalItem?: JSX.Element;
}): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div
      className={`card border-0 ${moduleClass} ${assistantMessageCardModuleClass}`}
    >
      <div className="card-body d-flex">
        <div className="me-2 me-lg-3">
          <span className="growi-custom-icons grw-ai-icon rounded-pill">
            growi_ai
          </span>
        </div>
        <div>
          {children.length > 0 ? (
            <>
              <ReactMarkdown
                components={{
                  a: NextLinkWrapper,
                  h1: ({ children }) => <Header level={1}>{children}</Header>,
                  h2: ({ children }) => <Header level={2}>{children}</Header>,
                  h3: ({ children }) => <Header level={3}>{children}</Header>,
                  h4: ({ children }) => <Header level={4}>{children}</Header>,
                  h5: ({ children }) => <Header level={5}>{children}</Header>,
                  h6: ({ children }) => <Header level={6}>{children}</Header>,
                }}
              >
                {children}
              </ReactMarkdown>
              {additionalItem}
            </>
          ) : (
            <span className="text-thinking">
              {t('sidebar_ai_assistant.progress_label')}{' '}
              <span className="material-symbols-outlined">more_horiz</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

type MessageSender = 'user' | 'assistant';

type Props = {
  sender: MessageSender;
  children: string;
  additionalItem?: JSX.Element;
};

export const MessageCard = (props: Props): JSX.Element => {
  const { sender, children, additionalItem } = props;

  return sender === 'user' ? (
    <UserMessageCard>{children}</UserMessageCard>
  ) : (
    <AssistantMessageCard additionalItem={additionalItem}>
      {children}
    </AssistantMessageCard>
  );
};
