import type OpenAI from 'openai';

export const shouldHideMessageKey = 'shouldHideMessage';

export type MessageWithCustomMetaData = Omit<
  OpenAI.Beta.Threads.Messages.MessagesPage,
  'data'
> & {
  data: Array<
    OpenAI.Beta.Threads.Message & {
      metadata?: {
        shouldHideMessage?: 'true' | 'false';
      };
    }
  >;
};

export type MessageListParams = OpenAI.Beta.Threads.Messages.MessageListParams;

export type MessageLog = {
  id: string;
  content: string;
  isUserMessage?: boolean;
};
