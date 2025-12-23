import type { JSX, KeyboardEvent } from 'react';
import {
  type FC,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Collapse } from 'reactstrap';
import SimpleBar from 'simplebar-react';

import { toastError } from '~/client/util/toastr';
import { useGrowiCloudUri } from '~/states/global';
import loggerFactory from '~/utils/logger';

import type { AiAssistantHasId } from '../../../../interfaces/ai-assistant';
import type { MessageLog } from '../../../../interfaces/message';
import {
  MessageErrorCode,
  StreamErrorCode,
} from '../../../../interfaces/message-error';
import type { IThreadRelationHasId } from '../../../../interfaces/thread-relation';
import {
  type FormData as FormDataForEditorAssistant,
  isEditorAssistantFormData,
  useEditorAssistant,
} from '../../../services/editor-assistant';
import {
  type FormData as FormDataForKnowledgeAssistant,
  useFetchAndSetMessageDataEffect,
  useKnowledgeAssistant,
} from '../../../services/knowledge-assistant';
import {
  useAiAssistantSidebarActions,
  useAiAssistantSidebarStatus,
  useUnifiedMergeViewActions,
} from '../../../states';
import { useSWRxThreads } from '../../../stores/thread';
import { MessageCard } from './MessageCard/MessageCard';
import { ResizableTextarea } from './ResizableTextArea';

import styles from './AiAssistantSidebar.module.scss';

const logger = loggerFactory(
  'growi:openai:client:components:AiAssistantSidebar',
);

const moduleClass = styles['grw-ai-assistant-sidebar'] ?? '';

type FormData = FormDataForEditorAssistant | FormDataForKnowledgeAssistant;

type AiAssistantSidebarSubstanceProps = {
  isEditorAssistant: boolean;
  aiAssistantData?: AiAssistantHasId;
  threadData?: IThreadRelationHasId;
  onCloseButtonClicked?: () => void;
};

const AiAssistantSidebarSubstance: React.FC<
  AiAssistantSidebarSubstanceProps
> = (props: AiAssistantSidebarSubstanceProps) => {
  const {
    isEditorAssistant,
    aiAssistantData,
    threadData,
    onCloseButtonClicked,
  } = props;

  // States
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [generatingAnswerMessage, setGeneratingAnswerMessage] =
    useState<MessageLog>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isErrorDetailCollapsed, setIsErrorDetailCollapsed] =
    useState<boolean>(false);

  // Hooks
  const { t } = useTranslation();
  const growiCloudUri = useGrowiCloudUri();

  // useSWRxThreads is executed only when Substance is rendered
  const { data: threads, mutate: mutateThreads } = useSWRxThreads(
    aiAssistantData?._id,
  );
  const { refreshThreadData } = useAiAssistantSidebarActions();

  // refresh thread data when the data is changed
  useEffect(() => {
    if (threads == null) {
      return;
    }

    const currentThread = threads.find(
      (t) => t.threadId === threadData?.threadId,
    );
    if (currentThread != null) {
      refreshThreadData(currentThread);
    }
  }, [threads, refreshThreadData, threadData?.threadId]);

  const newThreadCreatedHandler = useCallback(
    (thread: IThreadRelationHasId): void => {
      refreshThreadData(thread);
    },
    [refreshThreadData],
  );

  const {
    createThread: createThreadForKnowledgeAssistant,
    postMessage: postMessageForKnowledgeAssistant,
    processMessage: processMessageForKnowledgeAssistant,
    form: formForKnowledgeAssistant,
    resetForm: resetFormForKnowledgeAssistant,

    // Views
    initialView: initialViewForKnowledgeAssistant,
    generateModeSwitchesDropdown:
      generateModeSwitchesDropdownForKnowledgeAssistant,
    headerIcon: headerIconForKnowledgeAssistant,
    headerText: headerTextForKnowledgeAssistant,
    placeHolder: placeHolderForKnowledgeAssistant,
    threadTitleView: threadTitleViewForKnowledgeAssistant,
  } = useKnowledgeAssistant();

  const {
    createThread: createThreadForEditorAssistant,
    postMessage: postMessageForEditorAssistant,
    processMessage: processMessageForEditorAssistant,
    form: formForEditorAssistant,
    resetForm: resetFormEditorAssistant,
    isTextSelected,

    // Views
    generateInitialView: generateInitialViewForEditorAssistant,
    generatingEditorTextLabel,
    partialContentWarnLabel,
    generateActionButtons,
    headerIcon: headerIconForEditorAssistant,
    headerText: headerTextForEditorAssistant,
    placeHolder: placeHolderForEditorAssistant,
  } = useEditorAssistant();

  const form = isEditorAssistant
    ? formForEditorAssistant
    : formForKnowledgeAssistant;

  // Effects
  useFetchAndSetMessageDataEffect(setMessageLogs, threadData?.threadId);

  // Functions
  const resetForm = useCallback(() => {
    if (isEditorAssistant) {
      resetFormEditorAssistant();
    }

    resetFormForKnowledgeAssistant();
  }, [
    isEditorAssistant,
    resetFormEditorAssistant,
    resetFormForKnowledgeAssistant,
  ]);

  const createThread = useCallback(
    async (initialUserMessage: string) => {
      if (isEditorAssistant) {
        const thread = await createThreadForEditorAssistant();
        return thread;
      }

      if (aiAssistantData == null) {
        return;
      }
      const thread = await createThreadForKnowledgeAssistant(
        aiAssistantData._id,
        initialUserMessage,
      );
      return thread;
    },
    [
      aiAssistantData,
      createThreadForEditorAssistant,
      createThreadForKnowledgeAssistant,
      isEditorAssistant,
    ],
  );

  const postMessage = useCallback(
    async (threadId: string, formData: FormData) => {
      if (threadId == null) {
        throw new Error('threadId is not set');
      }

      if (isEditorAssistant) {
        if (isEditorAssistantFormData(formData)) {
          const response = await postMessageForEditorAssistant({
            threadId,
            formData,
          });
          return response;
        }
        return;
      }
      if (aiAssistantData?._id != null) {
        const response = await postMessageForKnowledgeAssistant({
          aiAssistantId: aiAssistantData._id,
          threadId,
          formData,
        });
        return response;
      }
    },
    [
      aiAssistantData?._id,
      isEditorAssistant,
      postMessageForEditorAssistant,
      postMessageForKnowledgeAssistant,
    ],
  );

  const isGenerating = generatingAnswerMessage != null;
  const submitSubstance = useCallback(
    async (data: FormData) => {
      // do nothing when the assistant is generating an answer
      if (isGenerating) {
        return;
      }

      // do nothing when the input is empty
      if (data.input.trim().length === 0) {
        return;
      }

      const { length: logLength } = messageLogs;

      // add user message to the logs
      const newUserMessage = {
        id: logLength.toString(),
        content: data.input,
        isUserMessage: true,
      };
      setMessageLogs((msgs) => [...msgs, newUserMessage]);

      resetForm();

      setErrorMessage(undefined);

      // add an empty assistant message
      const newAnswerMessage = { id: (logLength + 1).toString(), content: '' };
      setGeneratingAnswerMessage(newAnswerMessage);

      // create thread
      let threadId = threadData?.threadId;
      if (threadId == null) {
        try {
          const newThread = await createThread(newUserMessage.content);
          if (newThread == null) {
            return;
          }

          threadId = newThread.threadId;

          newThreadCreatedHandler(newThread);
        } catch (err) {
          logger.error(err.toString());
          toastError(
            t('sidebar_ai_assistant.failed_to_create_or_retrieve_thread'),
          );
        }
      }

      // post message
      try {
        if (threadId == null) {
          return;
        }

        const response = await postMessage(threadId, data);
        if (response == null) {
          return;
        }

        if (!response.ok) {
          const resJson = await response.json();
          if ('errors' in resJson) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const errors = resJson.errors
              .map(({ message }) => message)
              .join(', ');
            form.setError('input', {
              type: 'manual',
              message: `[${response.status}] ${errors}`,
            });

            const hasThreadIdNotSetError = resJson.errors.some(
              (err) => err.code === MessageErrorCode.THREAD_ID_IS_NOT_SET,
            );
            if (hasThreadIdNotSetError) {
              toastError(
                t('sidebar_ai_assistant.failed_to_create_or_retrieve_thread'),
              );
            }
          }
          setGeneratingAnswerMessage(undefined);
          return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder('utf-8');

        const read = async () => {
          if (reader == null) return;

          const { done, value } = await reader.read();

          // add assistant message to the logs
          if (done) {
            setGeneratingAnswerMessage((generatingAnswerMessage) => {
              if (generatingAnswerMessage == null) return;
              setMessageLogs((msgs) => [...msgs, generatingAnswerMessage]);
              return undefined;
            });

            // refresh thread data
            mutateThreads();
            return;
          }

          const chunk = decoder.decode(value);

          let isPreMessageGenerated = false;
          let isMainMessageGenerationStarted = false;
          const preMessages: string[] = [];
          const mainMessages: string[] = [];
          const lines = chunk.split('\n\n');
          lines.forEach((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data:')) {
              const data = JSON.parse(line.replace('data: ', ''));

              processMessageForKnowledgeAssistant(data, {
                onPreMessage: (data) => {
                  // When main message is sent while pre-message is being transmitted
                  if (isMainMessageGenerationStarted) {
                    preMessages.length = 0;
                    return;
                  }
                  if (data.finished) {
                    isPreMessageGenerated = true;
                    return;
                  }
                  if (data.text == null) {
                    return;
                  }
                  preMessages.push(data.text);
                },
                onMessage: (data) => {
                  if (!isMainMessageGenerationStarted) {
                    isMainMessageGenerationStarted = true;
                  }

                  // When main message is sent while pre-message is being transmitted
                  if (!isPreMessageGenerated) {
                    preMessages.length = 0;
                  }
                  mainMessages.push(data.content[0].text.value);
                },
              });

              processMessageForEditorAssistant(data, {
                onMessage: (data) => {
                  mainMessages.push(data.appendedMessage);
                },
                onDetectedDiff: (data) => {
                  logger.debug('sse diff', { data });
                },
                onFinalized: (data) => {
                  logger.debug('sse finalized', { data });
                },
              });
            } else if (trimmedLine.startsWith('error:')) {
              const error = JSON.parse(line.replace('error: ', ''));
              logger.error(error.errorMessage);
              form.setError('input', {
                type: 'manual',
                message: error.message,
              });

              if (error.code === StreamErrorCode.BUDGET_EXCEEDED) {
                setErrorMessage(
                  growiCloudUri != null
                    ? 'sidebar_ai_assistant.budget_exceeded_for_growi_cloud'
                    : 'sidebar_ai_assistant.budget_exceeded',
                );
              }
            }
          });

          // append text values to the assistant message
          setGeneratingAnswerMessage((prevMessage) => {
            if (prevMessage == null) return;
            return {
              ...prevMessage,
              content:
                prevMessage.content +
                preMessages.join('') +
                mainMessages.join(''),
            };
          });

          read();
        };
        read();
      } catch (err) {
        logger.error(err.toString());
        form.setError('input', { type: 'manual', message: err.toString() });
      }

      // eslint-disable-next-line max-len
    },
    [
      isGenerating,
      messageLogs,
      resetForm,
      threadData?.threadId,
      createThread,
      newThreadCreatedHandler,
      t,
      postMessage,
      form,
      mutateThreads,
      processMessageForKnowledgeAssistant,
      processMessageForEditorAssistant,
      growiCloudUri,
    ],
  );

  const submit = useCallback(
    (data: FormData) => {
      if (isEditorAssistant) {
        const markdownType = (() => {
          if (isEditorAssistantFormData(data) && data.markdownType != null) {
            return data.markdownType;
          }

          return isTextSelected ? 'selected' : 'none';
        })();

        return submitSubstance({ ...data, markdownType });
      }

      return submitSubstance(data);
    },
    [isEditorAssistant, isTextSelected, submitSubstance],
  );

  const keyDownHandler = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Do nothing while composing
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.handleSubmit(submit)();
    }
  };

  // Views
  const headerIcon = useMemo(() => {
    return isEditorAssistant
      ? headerIconForEditorAssistant
      : headerIconForKnowledgeAssistant;
  }, [
    headerIconForEditorAssistant,
    headerIconForKnowledgeAssistant,
    isEditorAssistant,
  ]);

  const headerText = useMemo(() => {
    return isEditorAssistant
      ? headerTextForEditorAssistant
      : headerTextForKnowledgeAssistant;
  }, [
    isEditorAssistant,
    headerTextForEditorAssistant,
    headerTextForKnowledgeAssistant,
  ]);

  const placeHolder = useMemo(() => {
    if (form.formState.isSubmitting) {
      return '';
    }
    return t(
      isEditorAssistant
        ? placeHolderForEditorAssistant
        : placeHolderForKnowledgeAssistant,
    );
  }, [
    form.formState.isSubmitting,
    isEditorAssistant,
    placeHolderForEditorAssistant,
    placeHolderForKnowledgeAssistant,
    t,
  ]);

  const initialView = useMemo(() => {
    if (isEditorAssistant) {
      return generateInitialViewForEditorAssistant(submit);
    }

    return initialViewForKnowledgeAssistant;
  }, [
    generateInitialViewForEditorAssistant,
    initialViewForKnowledgeAssistant,
    isEditorAssistant,
    submit,
  ]);

  const messageCardAdditionalItemForGeneratingMessage = useMemo(() => {
    if (isEditorAssistant) {
      return generatingEditorTextLabel;
    }

    return <></>;
  }, [generatingEditorTextLabel, isEditorAssistant]);

  const messageCardAdditionalItemForGeneratedMessage = useCallback(
    (messageId?: string) => {
      if (isEditorAssistant) {
        if (messageId == null || messageLogs == null) {
          return <></>;
        }
        return generateActionButtons(
          messageId,
          messageLogs,
          generatingAnswerMessage,
        );
      }

      return undefined;
    },
    [
      generateActionButtons,
      generatingAnswerMessage,
      isEditorAssistant,
      messageLogs,
    ],
  );

  return (
    <div className="d-flex flex-column vh-100">
      <div className="d-flex align-items-center p-3 border-bottom position-sticky top-0 bg-body z-1">
        {headerIcon}
        <h5 className="mb-0 fw-bold flex-grow-1 text-truncate">{headerText}</h5>
        <button
          type="button"
          className="btn btn-link p-0 border-0"
          onClick={onCloseButtonClicked}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="flex-grow-1 overflow-hidden">
        <SimpleBar className="h-100" autoHide>
          {!isEditorAssistant && threadTitleViewForKnowledgeAssistant}
          <div className="p-4">
            <div className="d-flex flex-column gap-4 flex-grow-1">
              {threadData != null ? (
                <div className="vstack gap-4 pb-2">
                  {messageLogs.map((message) => (
                    <>
                      <MessageCard
                        sender={message.isUserMessage ? 'user' : 'assistant'}
                        additionalItem={messageCardAdditionalItemForGeneratedMessage(
                          message.id,
                        )}
                      >
                        {message.content}
                      </MessageCard>
                    </>
                  ))}
                  {generatingAnswerMessage != null && (
                    <MessageCard
                      sender="assistant"
                      additionalItem={
                        messageCardAdditionalItemForGeneratingMessage
                      }
                    >
                      {generatingAnswerMessage.content}
                    </MessageCard>
                  )}
                  {isEditorAssistant && partialContentWarnLabel}
                  {messageLogs.length > 0 && (
                    <div className="d-flex justify-content-center">
                      <span
                        className="bg-body-tertiary text-body-secondary rounded-pill px-3 py-1"
                        style={{ fontSize: 'smaller' }}
                      >
                        {t(
                          'sidebar_ai_assistant.caution_against_hallucination',
                        )}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <>{initialView}</>
              )}
            </div>
          </div>
        </SimpleBar>
      </div>

      <div className="input-form-area position-sticky bg-body z-2 p-3">
        <form
          onSubmit={form.handleSubmit(submit)}
          className="flex-fill vstack gap-1"
        >
          <Controller
            name="input"
            control={form.control}
            render={({ field }) => (
              <ResizableTextarea
                {...field}
                required
                className="form-control textarea-ask"
                style={{ resize: 'none' }}
                rows={1}
                placeholder={placeHolder}
                onKeyDown={keyDownHandler}
                disabled={form.formState.isSubmitting}
              />
            )}
          />
          <div className="flex-fill hstack gap-2 justify-content-between m-0">
            {!isEditorAssistant &&
              generateModeSwitchesDropdownForKnowledgeAssistant(isGenerating)}
            {isEditorAssistant && <div />}
            <button
              type="submit"
              className="btn btn-submit no-border"
              disabled={form.formState.isSubmitting || isGenerating}
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </form>

        {form.formState.errors.input != null && (
          <div className="mt-4 bg-danger bg-opacity-10 rounded-3 p-2 w-100">
            <div>
              <span className="material-symbols-outlined text-danger me-2">
                error
              </span>
              <span className="text-danger">
                {errorMessage != null
                  ? t(errorMessage)
                  : t('sidebar_ai_assistant.error_message')}
              </span>
            </div>

            <button
              type="button"
              className="btn btn-link text-body-secondary p-0"
              aria-expanded={isErrorDetailCollapsed}
              onClick={() => setIsErrorDetailCollapsed(!isErrorDetailCollapsed)}
            >
              <span
                className={`material-symbols-outlined mt-2 me-1 ${isErrorDetailCollapsed ? 'rotate-90' : ''}`}
              >
                chevron_right
              </span>
              <span className="small">
                {t('sidebar_ai_assistant.show_error_detail')}
              </span>
            </button>

            <Collapse isOpen={isErrorDetailCollapsed}>
              <div className="ms-2">
                <div className="">
                  <div className="text-body-secondary small">
                    {form.formState.errors.input?.message}
                  </div>
                </div>
              </div>
            </Collapse>
          </div>
        )}
      </div>
    </div>
  );
};

export const AiAssistantSidebar: FC = memo((): JSX.Element => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const { close: closeAiAssistantSidebar } = useAiAssistantSidebarActions();
  const { disable: disableUnifiedMergeView } = useUnifiedMergeViewActions();

  const aiAssistantData = aiAssistantSidebarData?.aiAssistantData;
  const threadData = aiAssistantSidebarData?.threadData;
  const isOpened = aiAssistantSidebarData?.isOpened;
  const isEditorAssistant = aiAssistantSidebarData?.isEditorAssistant ?? false;

  useEffect(() => {
    if (!aiAssistantSidebarData?.isOpened) {
      disableUnifiedMergeView();
    }
  }, [aiAssistantSidebarData?.isOpened, disableUnifiedMergeView]);

  if (!isOpened) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <div
      className={`position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm overflow-hidden ${moduleClass}`}
      data-testid="grw-right-sidebar"
    >
      <AiAssistantSidebarSubstance
        isEditorAssistant={isEditorAssistant}
        threadData={threadData}
        aiAssistantData={aiAssistantData}
        onCloseButtonClicked={closeAiAssistantSidebar}
      />
    </div>
  );
});
