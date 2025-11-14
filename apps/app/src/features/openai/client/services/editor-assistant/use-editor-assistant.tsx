import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import {
  acceptAllChunks,
  useTextSelectionEffect,
} from '@growi/editor/dist/client/services/unified-merge-view';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { useSecondaryYdocs } from '@growi/editor/dist/client/stores/use-secondary-ydocs';
import { type UseFormReturn, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Text as YText } from 'yjs';

import { apiv3Post } from '~/client/util/apiv3-client';
import { useCurrentPageId } from '~/stores/page';
import { useIsEnableUnifiedMergeView } from '~/stores-universal/context';

import type { AiAssistantHasId } from '../../../interfaces/ai-assistant';
import {
  type EditRequestBody,
  type SseDetectedDiff,
  SseDetectedDiffSchema,
  type SseFinalized,
  SseFinalizedSchema,
  type SseMessage,
  SseMessageSchema,
} from '../../../interfaces/editor-assistant/sse-schemas';
import type { MessageLog } from '../../../interfaces/message';
import type { IThreadRelationHasId } from '../../../interfaces/thread-relation';
import { ThreadType } from '../../../interfaces/thread-relation';
import { handleIfSuccessfullyParsed } from '../../../utils/handle-if-successfully-parsed';
import { AiAssistantDropdown } from '../../components/AiAssistant/AiAssistantSidebar/AiAssistantDropdown';
import { QuickMenuList } from '../../components/AiAssistant/AiAssistantSidebar/QuickMenuList';
import { useAiAssistantSidebar } from '../../stores/ai-assistant';
import {
  shouldUseClientProcessing,
  useClientEngineIntegration,
} from '../client-engine-integration';
import { getPageBodyForContext } from './get-page-body-for-context';
import { performSearchReplace } from './search-replace-engine';

type CreateThread = () => Promise<IThreadRelationHasId>;

type PostMessageArgs = {
  threadId: string;
  formData: FormData;
};

type PostMessage = (args: PostMessageArgs) => Promise<Response>;
type ProcessMessage = (
  data: unknown,
  handler: {
    onMessage: (data: SseMessage) => void;
    onDetectedDiff: (data: SseDetectedDiff) => void;
    onFinalized: (data: SseFinalized) => void;
  },
) => void;

type GenerateInitialView = (
  onSubmit: (data: FormData) => Promise<void>,
) => JSX.Element;
type GenerateActionButtons = (
  messageId: string,
  messageLogs: MessageLog[],
  generatingAnswerMessage?: MessageLog,
) => JSX.Element;
export interface FormData {
  input: string;
  markdownType?: 'full' | 'selected' | 'none';
}

type DetectedDiff = Array<{
  data: SseDetectedDiff;
  applied: boolean;
  id: string;
}>;

type UseEditorAssistant = () => {
  createThread: CreateThread;
  postMessage: PostMessage;
  processMessage: ProcessMessage;
  form: UseFormReturn<FormData>;
  resetForm: () => void;
  isTextSelected: boolean;
  isGeneratingEditorText: boolean;

  // Views
  generateInitialView: GenerateInitialView;
  generatingEditorTextLabel?: JSX.Element;
  partialContentWarnLabel?: JSX.Element;
  generateActionButtons: GenerateActionButtons;
  headerIcon: JSX.Element;
  headerText: JSX.Element;
  placeHolder: string;
};

const insertTextAtLine = (
  yText: YText,
  lineNumber: number,
  textToInsert: string,
): void => {
  // Get the entire text content
  const content = yText.toString();

  // Split by newlines to get all lines
  const lines = content.split('\n');

  // Calculate the index position for insertion
  let insertPosition = 0;

  // Sum the length of all lines before the target line (plus newline characters)
  for (let i = 0; i < lineNumber && i < lines.length; i++) {
    insertPosition += lines[i].length + 1; // +1 for the newline character
  }

  // Insert the text at the calculated position
  yText.insert(insertPosition, textToInsert);
};

const appendTextLastLine = (yText: YText, textToAppend: string) => {
  const content = yText.toString();
  const insertPosition = content.length;
  yText.insert(insertPosition, `\n\n${textToAppend}`);
};

export const useEditorAssistant: UseEditorAssistant = () => {
  // Refs
  const lineRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // States
  const [detectedDiff, setDetectedDiff] = useState<DetectedDiff>();
  const [selectedAiAssistant, setSelectedAiAssistant] =
    useState<AiAssistantHasId>();
  const [selectedText, setSelectedText] = useState<string>();
  const [selectedTextIndex, setSelectedTextIndex] = useState<number>();
  const [isGeneratingEditorText, setIsGeneratingEditorText] =
    useState<boolean>(false);
  const [partialContentInfo, setPartialContentInfo] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const isTextSelected = useMemo(
    () => selectedText != null && selectedText.length !== 0,
    [selectedText],
  );

  // Hooks
  const { t } = useTranslation();
  const { data: currentPageId } = useCurrentPageId();
  const {
    data: isEnableUnifiedMergeView,
    mutate: mutateIsEnableUnifiedMergeView,
  } = useIsEnableUnifiedMergeView();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(
    GlobalCodeMirrorEditorKey.MAIN,
  );
  const yDocs = useSecondaryYdocs(isEnableUnifiedMergeView ?? false, {
    pageId: currentPageId ?? undefined,
    useSecondary: isEnableUnifiedMergeView ?? false,
  });
  const { data: aiAssistantSidebarData } = useAiAssistantSidebar();
  const clientEngine = useClientEngineIntegration({
    enableClientProcessing: shouldUseClientProcessing(),
    enableServerFallback: true,
    enablePerformanceMetrics: true,
  });

  const form = useForm<FormData>({
    defaultValues: {
      input: '',
    },
  });

  // Functions
  const resetForm = useCallback(() => {
    form.reset({ input: '' });
  }, [form]);

  const createThread: CreateThread = useCallback(async () => {
    const response = await apiv3Post<IThreadRelationHasId>('/openai/thread', {
      type: ThreadType.EDITOR,
      aiAssistantId: selectedAiAssistant?._id,
    });
    return response.data;
  }, [selectedAiAssistant?._id]);

  const postMessage: PostMessage = useCallback(
    async ({ threadId, formData }) => {
      // Clear partial content info on new request
      setPartialContentInfo(null);

      // Disable UnifiedMergeView when a Form is submitted with UnifiedMergeView enabled
      mutateIsEnableUnifiedMergeView(false);

      const pageBodyContext = getPageBodyForContext(
        codeMirrorEditor,
        2000,
        8000,
      );

      if (!pageBodyContext) {
        throw new Error('Unable to get page body context');
      }

      // Store partial content info if applicable
      if (
        pageBodyContext.isPartial &&
        pageBodyContext.startIndex != null &&
        pageBodyContext.endIndex != null
      ) {
        setPartialContentInfo({
          startIndex: pageBodyContext.startIndex,
          endIndex: pageBodyContext.endIndex,
        });
      }

      const requestBody = {
        threadId,
        aiAssistantId: selectedAiAssistant?._id,
        userMessage: formData.input,
        pageBody: pageBodyContext.content,
        ...(pageBodyContext.isPartial && {
          isPageBodyPartial: pageBodyContext.isPartial,
          partialPageBodyStartIndex: pageBodyContext.startIndex,
        }),
        ...(selectedText != null &&
          selectedText.length > 0 && {
            selectedText,
            selectedPosition: selectedTextIndex,
          }),
      } satisfies EditRequestBody;

      const response = await fetch('/_api/v3/openai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      return response;
    },
    [
      codeMirrorEditor,
      mutateIsEnableUnifiedMergeView,
      selectedAiAssistant?._id,
      selectedText,
      selectedTextIndex,
    ],
  );

  // Enhanced processMessage with client engine support (保持)
  const processMessage = useCallback(
    async (
      data: unknown,
      handler: {
        onMessage: (data: SseMessage) => void;
        onDetectedDiff: (data: SseDetectedDiff) => void;
        onFinalized: (data: SseFinalized) => void;
      },
    ) => {
      // Reset timer whenever data is received
      const handleDataReceived = () => {
        // Clear existing timer
        if (timerRef.current != null) {
          clearTimeout(timerRef.current);
        }

        // Hide spinner since data is flowing
        if (isGeneratingEditorText) {
          setIsGeneratingEditorText(false);
        }

        // Set new timer
        timerRef.current = setTimeout(() => {
          setIsGeneratingEditorText(true);
        }, 500);
      };

      handleIfSuccessfullyParsed(data, SseMessageSchema, (data: SseMessage) => {
        handleDataReceived();
        handler.onMessage(data);
      });

      handleIfSuccessfullyParsed(
        data,
        SseDetectedDiffSchema,
        async (diffData: SseDetectedDiff) => {
          handleDataReceived();
          mutateIsEnableUnifiedMergeView(true);

          // Check if client engine processing is enabled
          if (
            clientEngine.isClientProcessingEnabled &&
            yDocs?.secondaryDoc != null
          ) {
            try {
              // Get current content
              const yText = yDocs.secondaryDoc.getText('codemirror');
              const currentContent = yText.toString();

              // Process with client engine
              const result = await clientEngine.processHybrid(
                currentContent,
                [diffData],
                async () => {
                  // Fallback to original server-side processing
                  setDetectedDiff((prev) => {
                    const newData = {
                      data: diffData,
                      applied: false,
                      id: crypto.randomUUID(),
                    };
                    if (prev == null) {
                      return [newData];
                    }
                    return [...prev, newData];
                  });
                },
              );

              // Apply result if client processing succeeded
              if (
                result.success &&
                result.method === 'client' &&
                result.result?.modifiedText
              ) {
                const applied = clientEngine.applyToYText(
                  yText,
                  result.result.modifiedText,
                );
                if (applied) {
                  handler.onDetectedDiff(diffData);
                  return;
                }
              }
            } catch (error) {
              // Fall through to server-side processing
            }
          }

          // Original server-side processing (fallback or default)
          setDetectedDiff((prev) => {
            const newData = {
              data: diffData,
              applied: false,
              id: crypto.randomUUID(),
            };
            if (prev == null) {
              return [newData];
            }
            return [...prev, newData];
          });
          handler.onDetectedDiff(diffData);
        },
      );

      handleIfSuccessfullyParsed(
        data,
        SseFinalizedSchema,
        (data: SseFinalized) => {
          handler.onFinalized(data);
        },
      );
    },
    [
      isGeneratingEditorText,
      mutateIsEnableUnifiedMergeView,
      clientEngine,
      yDocs,
    ],
  );

  const selectTextHandler = useCallback(
    ({ selectedText, selectedTextIndex, selectedTextFirstLineNumber }) => {
      setSelectedText(selectedText);
      setSelectedTextIndex(selectedTextIndex);
      lineRef.current = selectedTextFirstLineNumber;
    },
    [],
  );

  // Effects
  useTextSelectionEffect(codeMirrorEditor, selectTextHandler);

  useEffect(() => {
    const pendingDetectedDiff: DetectedDiff | undefined = detectedDiff?.filter(
      (diff) => diff.applied === false,
    );
    if (
      yDocs?.secondaryDoc != null &&
      pendingDetectedDiff != null &&
      pendingDetectedDiff.length > 0
    ) {
      const yText = yDocs.secondaryDoc.getText('codemirror');
      yDocs.secondaryDoc.transact(() => {
        pendingDetectedDiff.forEach((detectedDiff) => {
          if (detectedDiff.data.diff) {
            const { search, replace, startLine } = detectedDiff.data.diff;
            // New search and replace processing
            const success = performSearchReplace(
              yText,
              search,
              replace,
              startLine,
            );

            if (!success) {
              // Fallback: existing behavior
              if (isTextSelected) {
                insertTextAtLine(yText, lineRef.current, replace);
                lineRef.current += 1;
              } else {
                appendTextLastLine(yText, replace);
              }
            }
          }
        });
      });

      // Mark items as applied after applying to secondaryDoc
      setDetectedDiff((prev) => {
        if (!prev) return prev;
        const pendingDetectedDiffIds = pendingDetectedDiff.map(
          (diff) => diff.id,
        );
        return prev.map((diff) => {
          if (pendingDetectedDiffIds.includes(diff.id)) {
            return { ...diff, applied: true };
          }
          return diff;
        });
      });
    }
  }, [detectedDiff, isTextSelected, yDocs?.secondaryDoc]);

  // Set detectedDiff to undefined after applying all detectedDiff to secondaryDoc
  useEffect(() => {
    if (
      detectedDiff?.filter((detectedDiff) => detectedDiff.applied === false)
        .length === 0
    ) {
      setSelectedText(undefined);
      setSelectedTextIndex(undefined);
      setDetectedDiff(undefined);
      lineRef.current = 0;
    }
  }, [detectedDiff]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
  // Views
  const headerIcon = useMemo(() => {
    return (
      <span className="material-symbols-outlined growi-ai-chat-icon me-3 fs-4">
        support_agent
      </span>
    );
  }, []);

  const headerText = useMemo(() => {
    return <>{t('Editor Assistant')}</>;
  }, [t]);

  const placeHolder = useMemo(() => {
    return 'sidebar_ai_assistant.editor_assistant_placeholder';
  }, []);

  const generateInitialView: GenerateInitialView = useCallback(
    (onSubmit) => {
      const selectAiAssistantHandler = (aiAssistant?: AiAssistantHasId) => {
        setSelectedAiAssistant(aiAssistant);
      };

      const clickQuickMenuHandler = async (quickMenu: string) => {
        await onSubmit({ input: quickMenu, markdownType: 'full' });
      };

      return (
        <>
          <div className="py-2">
            <AiAssistantDropdown
              selectedAiAssistant={selectedAiAssistant}
              onSelect={selectAiAssistantHandler}
            />
          </div>
          <QuickMenuList onClick={clickQuickMenuHandler} />
        </>
      );
    },
    [selectedAiAssistant],
  );

  const generateActionButtons: GenerateActionButtons = useCallback(
    (messageId, messageLogs, generatingAnswerMessage) => {
      const isActionButtonShown = (() => {
        if (!aiAssistantSidebarData?.isEditorAssistant) {
          return false;
        }

        if (!isEnableUnifiedMergeView) {
          return false;
        }

        if (generatingAnswerMessage != null) {
          return false;
        }

        const latestAssistantMessageLogId = messageLogs
          .filter((message) => !message.isUserMessage)
          .slice(-1)[0];

        if (messageId === latestAssistantMessageLogId?.id) {
          return true;
        }

        return false;
      })();

      const accept = () => {
        if (codeMirrorEditor?.view == null) {
          return;
        }

        acceptAllChunks(codeMirrorEditor.view);
        mutateIsEnableUnifiedMergeView(false);
      };

      const reject = () => {
        mutateIsEnableUnifiedMergeView(false);
      };

      if (!isActionButtonShown) {
        return <></>;
      }

      return (
        <div className="d-flex mt-2 justify-content-start">
          <button
            type="button"
            className="btn btn-outline-secondary me-2"
            onClick={reject}
          >
            {t('sidebar_ai_assistant.discard')}
          </button>
          <button type="button" className="btn btn-success" onClick={accept}>
            {t('sidebar_ai_assistant.accept')}
          </button>
        </div>
      );
    },
    [
      aiAssistantSidebarData?.isEditorAssistant,
      codeMirrorEditor?.view,
      isEnableUnifiedMergeView,
      mutateIsEnableUnifiedMergeView,
      t,
    ],
  );

  const generatingEditorTextLabel = useMemo(() => {
    return (
      <>
        {isGeneratingEditorText && (
          <span className="text-thinking">
            {t(
              'sidebar_ai_assistant.text_generation_by_editor_assistant_label',
            )}
          </span>
        )}
      </>
    );
  }, [isGeneratingEditorText, t]);

  const partialContentWarnLabel = useMemo(() => {
    if (!partialContentInfo) {
      return undefined;
    }

    // Use CodeMirror's built-in posToLine method for efficient line calculation
    let isLineMode = true;
    const getPositionNumber = (index: number): number => {
      const doc = codeMirrorEditor?.getDoc();
      if (!doc) return 1;

      try {
        // return line number if possible
        return doc.lineAt(index).number;
      } catch {
        // Fallback: return character index and switch to character mode
        isLineMode = false;
        return index + 1;
      }
    };

    const startPosition = getPositionNumber(partialContentInfo.startIndex);
    const endPosition = getPositionNumber(partialContentInfo.endIndex);

    const translationKey = isLineMode
      ? 'sidebar_ai_assistant.editor_assistant_long_context_warn_with_unit_line'
      : 'sidebar_ai_assistant.editor_assistant_long_context_warn_with_unit_char';

    return (
      <div className="alert alert-warning py-2 px-3 mb-3" role="alert">
        <small>{t(translationKey, { startPosition, endPosition })}</small>
      </div>
    );
  }, [partialContentInfo, t, codeMirrorEditor]);

  return {
    createThread,
    postMessage,
    processMessage,
    form,
    resetForm,
    isTextSelected,
    isGeneratingEditorText,

    // Views
    generateInitialView,
    generatingEditorTextLabel,
    partialContentWarnLabel,
    generateActionButtons,
    headerIcon,
    headerText,
    placeHolder,
  };
};

// type guard
export const isEditorAssistantFormData = (
  formData: unknown,
): formData is FormData => {
  return (
    typeof formData === 'object' &&
    formData != null &&
    'markdownType' in formData
  );
};
