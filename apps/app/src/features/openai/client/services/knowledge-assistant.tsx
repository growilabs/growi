import type { Dispatch, SetStateAction } from 'react';
import {
  useCallback, useMemo, useState, useEffect,
} from 'react';

import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  UncontrolledTooltip, Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import {
  SseMessageSchema, type SseMessage, SsePreMessageSchema, type SsePreMessage,
} from '~/features/openai/interfaces/knowledge-assistant/sse-schemas';
import { handleIfSuccessfullyParsed } from '~/features/openai/utils/handle-if-successfully-parsed';

import type { MessageLog, MessageWithCustomMetaData } from '../../interfaces/message';
import type { IThreadRelationHasId } from '../../interfaces/thread-relation';
import { ThreadType } from '../../interfaces/thread-relation';
import { AiAssistantChatInitialView } from '../components/AiAssistant/AiAssistantSidebar/AiAssistantChatInitialView';
import { useAiAssistantSidebarStatus } from '../states';
import { useSWRMUTxMessages } from '../stores/message';
import { useSWRMUTxThreads, useSWRINFxRecentThreads } from '../stores/thread';

interface CreateThread {
  (aiAssistantId: string, initialUserMessage: string): Promise<IThreadRelationHasId>;
}

type PostMessageArgs = {
  aiAssistantId: string;
  threadId: string;
  formData: FormData;
};

interface PostMessage {
  (args: PostMessageArgs): Promise<Response>;
}

interface ProcessMessage {
  (data: unknown, handler: {
    onMessage: (data: SseMessage) => void
    onPreMessage: (data: SsePreMessage) => void
  }
  ): void;
}

export interface FormData {
  input: string
  summaryMode?: boolean
  extendedThinkingMode?: boolean
}

interface GenerateModeSwitchesDropdown {
  (isGenerating: boolean): JSX.Element
}

type UseKnowledgeAssistant = () => {
  createThread: CreateThread
  postMessage: PostMessage
  processMessage: ProcessMessage
  form: UseFormReturn<FormData>
  resetForm: () => void

  // Views
  initialView: JSX.Element
  generateModeSwitchesDropdown: GenerateModeSwitchesDropdown
  headerIcon: JSX.Element
  headerText: JSX.Element
  placeHolder: string
}

export const useKnowledgeAssistant: UseKnowledgeAssistant = () => {
  // Hooks
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const { aiAssistantData, threadData } = aiAssistantSidebarData ?? {};
  const { mutate: mutateRecentThreads } = useSWRINFxRecentThreads();
  const { trigger: mutateThreadData } = useSWRMUTxThreads(aiAssistantData?._id);
  const { t } = useTranslation();

  const form = useForm<FormData>({
    defaultValues: {
      input: '',
      summaryMode: true,
      extendedThinkingMode: false,
    },
  });

  // Functions
  const resetForm = useCallback(() => {
    const summaryMode = form.getValues('summaryMode');
    const extendedThinkingMode = form.getValues('extendedThinkingMode');
    form.reset({ input: '', summaryMode, extendedThinkingMode });
  }, [form]);

  const createThread: CreateThread = useCallback(async(aiAssistantId, initialUserMessage) => {
    const response = await apiv3Post<IThreadRelationHasId>('/openai/thread', {
      type: ThreadType.KNOWLEDGE,
      aiAssistantId,
      initialUserMessage,
    });
    const thread = response.data;

    // No need to await because data is not used
    mutateThreadData();

    return thread;
  }, [mutateThreadData]);

  const postMessage: PostMessage = useCallback(async({ aiAssistantId, threadId, formData }) => {
    const response = await fetch('/_api/v3/openai/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiAssistantId,
        threadId,
        userMessage: formData.input,
        summaryMode: form.getValues('summaryMode'),
        extendedThinkingMode: form.getValues('extendedThinkingMode'),
      }),
    });

    mutateRecentThreads();

    return response;
  }, [form, mutateRecentThreads]);

  const processMessage: ProcessMessage = useCallback((data, handler) => {
    handleIfSuccessfullyParsed(data, SseMessageSchema, (data: SseMessage) => {
      handler.onMessage(data);
    });

    handleIfSuccessfullyParsed(data, SsePreMessageSchema, (data: SsePreMessage) => {
      handler.onPreMessage(data);
    });
  }, []);

  // Views
  const headerIcon = useMemo(() => {
    return <span className="growi-custom-icons growi-ai-chat-icon me-3 fs-4">ai_assistant</span>;
  }, []);

  const headerText = useMemo(() => {
    return <>{threadData?.title ?? aiAssistantData?.name}</>;
  }, [aiAssistantData?.name, threadData?.title]);

  const placeHolder = useMemo(() => { return 'sidebar_ai_assistant.knowledge_assistant_placeholder' }, []);

  const initialView = useMemo(() => {
    if (aiAssistantSidebarData?.aiAssistantData == null) {
      return <></>;
    }

    return (
      <AiAssistantChatInitialView
        description={aiAssistantSidebarData.aiAssistantData.description}
        pagePathPatterns={aiAssistantSidebarData.aiAssistantData.pagePathPatterns}
      />
    );
  }, [aiAssistantSidebarData?.aiAssistantData]);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const toggleDropdown = useCallback(() => {
    setDropdownOpen(prevState => !prevState);
  }, []);

  const generateModeSwitchesDropdown: GenerateModeSwitchesDropdown = useCallback((isGenerating) => {
    return (
      <Dropdown isOpen={dropdownOpen} toggle={toggleDropdown} direction="up">
        <DropdownToggle size="sm" outline className="border-0">
          <span className="material-symbols-outlined">tune</span>
        </DropdownToggle>
        <DropdownMenu>
          <DropdownItem tag="div" toggle={false}>
            <div className="form-check form-switch">
              <input
                id="swSummaryMode"
                type="checkbox"
                role="switch"
                className="form-check-input"
                {...form.register('summaryMode')}
                disabled={form.formState.isSubmitting || isGenerating}
              />
              <label className="form-check-label" htmlFor="swSummaryMode">
                {t('sidebar_ai_assistant.summary_mode_label')}
              </label>
              <a
                id="tooltipForHelpOfSummaryMode"
                role="button"
                className="ms-1"
              >
                <span className="material-symbols-outlined fs-6" style={{ lineHeight: 'unset' }}>help</span>
              </a>
              <UncontrolledTooltip
                target="tooltipForHelpOfSummaryMode"
              >
                {t('sidebar_ai_assistant.summary_mode_help')}
              </UncontrolledTooltip>
            </div>
          </DropdownItem>
          <DropdownItem tag="div" toggle={false}>
            <div className="form-check form-switch">
              <input
                id="swExtendedThinkingMode"
                type="checkbox"
                role="switch"
                className="form-check-input"
                {...form.register('extendedThinkingMode')}
                disabled={form.formState.isSubmitting || isGenerating}
              />
              <label className="form-check-label" htmlFor="swExtendedThinkingMode">
                {t('sidebar_ai_assistant.extended_thinking_mode_label')}
              </label>
              <a
                id="tooltipForHelpOfExtendedThinkingMode"
                role="button"
                className="ms-1"
              >
                <span className="material-symbols-outlined fs-6" style={{ lineHeight: 'unset' }}>help</span>
              </a>
              <UncontrolledTooltip
                target="tooltipForHelpOfExtendedThinkingMode"
              >
                {t('sidebar_ai_assistant.extended_thinking_mode_help')}
              </UncontrolledTooltip>
            </div>
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    );
  }, [dropdownOpen, toggleDropdown, form, t]);

  return {
    createThread,
    postMessage,
    processMessage,
    form,
    resetForm,

    // Views
    initialView,
    // generateMessageCard,
    generateModeSwitchesDropdown,
    headerIcon,
    headerText,
    placeHolder,
  };
};


// Helper function to transform API message data to MessageLog[]
const transformApiMessagesToLogs = (
    apiMessageData: MessageWithCustomMetaData | null | undefined,
): MessageLog[] => {
  if (apiMessageData?.data == null || !Array.isArray(apiMessageData.data)) {
    return [];
  }

  // Define a type for the items in apiMessageData.data for clarity
  type ApiMessageItem = (typeof apiMessageData.data)[number];

  return apiMessageData.data
    .slice() // Create a shallow copy before reversing
    .reverse()
    .filter((message: ApiMessageItem) => message.metadata?.shouldHideMessage !== 'true')
    .map((message: ApiMessageItem): MessageLog => {
      // Extract the first text content block, if any
      let messageTextContent = '';
      const textContentBlock = message.content?.find(contentBlock => contentBlock.type === 'text');
      if (textContentBlock != null && textContentBlock.type === 'text') {
        messageTextContent = textContentBlock.text.value;
      }

      return {
        id: message.id, // Use the actual message ID from OpenAI
        content: messageTextContent,
        isUserMessage: message.role === 'user',
      };
    });
};

export const useFetchAndSetMessageDataEffect = (
    setMessageLogs: Dispatch<SetStateAction<MessageLog[]>>,
    threadId?: string,
): void => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const { trigger: mutateMessageData } = useSWRMUTxMessages(
    aiAssistantSidebarData?.aiAssistantData?._id,
    threadId,
  );

  useEffect(() => {
    if (aiAssistantSidebarData?.isEditorAssistant) {
      return;
    }

    if (threadId == null) {
      setMessageLogs([]);
      return; // Early return if no threadId
    }

    const fetchAndSetLogs = async() => {
      try {
        // Assuming mutateMessageData() returns a Promise<MessageWithCustomMetaData | null | undefined>
        const rawApiMessageData: MessageWithCustomMetaData | null | undefined = await mutateMessageData();
        const fetchedLogs = transformApiMessagesToLogs(rawApiMessageData);

        setMessageLogs((currentLogs) => {
          // Preserve current logs if they represent a single, user-submitted message
          // AND the newly fetched logs are empty (common for new threads).
          const shouldPreserveCurrentMessage = currentLogs.length === 1
            && currentLogs[0].isUserMessage
            && fetchedLogs.length === 0;

          // Update with fetched logs, or preserve current if applicable
          return shouldPreserveCurrentMessage ? currentLogs : fetchedLogs;
        });
      }
      catch (error) {
        // console.error('Failed to fetch or process message data:', error); // Optional: for debugging
        setMessageLogs([]); // Clear logs on error to avoid inconsistent state
      }
    };

    fetchAndSetLogs();
  }, [threadId, mutateMessageData, setMessageLogs, aiAssistantSidebarData?.isEditorAssistant]); // Dependencies
};
