import { getIdStringForRef } from '@growi/core';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler, Response } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { MessageDelta } from 'openai/resources/beta/threads/messages.mjs';
import { z } from 'zod';

// Necessary imports
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { LlmEditorAssistantDiffSchema, LlmEditorAssistantMessageSchema } from '../../../interfaces/editor-assistant/llm-response-schemas';
import type {
  SseDetectedDiff, SseFinalized, SseMessage, EditRequestBody,
} from '../../../interfaces/editor-assistant/sse-schemas';
import { MessageErrorCode } from '../../../interfaces/message-error';
import ThreadRelationModel from '../../models/thread-relation';
import { getOrCreateEditorAssistant } from '../../services/assistant';
import { openaiClient } from '../../services/client';
import { LlmResponseStreamProcessor } from '../../services/editor-assistant';
import { getStreamErrorCode } from '../../services/getStreamErrorCode';
import { getOpenaiService } from '../../services/openai';
import { replaceAnnotationWithPageLink } from '../../services/replace-annotation-with-page-link';
import { certifyAiService } from '../middlewares/certify-ai-service';
import { SseHelper } from '../utils/sse-helper';


const logger = loggerFactory('growi:routes:apiv3:openai:message');

// -----------------------------------------------------------------------------
// Type definitions
// -----------------------------------------------------------------------------

const LlmEditorAssistantResponseSchema = z.object({
  contents: z.array(z.union([LlmEditorAssistantMessageSchema, LlmEditorAssistantDiffSchema])),
}).describe('The response format for the editor assistant');


type Req = Request<undefined, Response, EditRequestBody> & {
  user: IUserHasId,
}


// -----------------------------------------------------------------------------
// Endpoint handler factory
// -----------------------------------------------------------------------------

type PostMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];


// -----------------------------------------------------------------------------
// Instructions
// -----------------------------------------------------------------------------
/* eslint-disable max-len */
const withMarkdownCaution = `# IMPORTANT:
- Spaces and line breaks are also counted as individual characters.
- The text for lines that do not need correction must be returned exactly as in the original text.
- Include original text in the replace object even if it contains only spaces or line breaks
`;

function instruction(withMarkdown: boolean): string {
  return `# RESPONSE FORMAT:

## For Consultation Type (discussion/advice only):
Respond with a JSON object containing ONLY message objects:
{
  "contents": [
    { "message": "Your thoughtful response to the user's question or consultation.\n\nYou can use multiple paragraphs as needed." }
  ]
}

## For Edit Type (explicit editing request):
The SEARCH field must contain exact content including whitespace and indentation.
The startLine field is REQUIRED and must specify the line number where search begins.

Respond with a JSON object in the following format:
{
  "contents": [
    { "message": "Your brief message about the upcoming changes or proposals.\n\n" },
    {
      "search": "exact existing content",
      "replace": "new content",
      "startLine": 42  // REQUIRED: line number (1-based) where search begins
    },
    { "message": "Additional explanation if needed." },
    {
      "search": "another exact content",
      "replace": "replacement content",
      "startLine": 58  // REQUIRED
    },
    ...more items if needed
    { "message": "Your friendly message explaining what changes were made or suggested." }
  ]
}

The array should contain:
- [At the beginning of the list] A "message" object that has your brief message about the upcoming change or proposal. Be sure that should be written in the present or future tense and add two consecutive line feeds ('\n\n') at the end.
- Objects with a "message" key for explanatory text to the user if needed.
- Edit objects with "search" (exact existing content), "replace" (new content), and "startLine" (1-based line number, REQUIRED) fields.
- [At the end of the list] A "message" object that contains your friendly message explaining that the operation was completed and what changes were made.

${withMarkdown ? withMarkdownCaution : ''}`;
}
/* eslint-disable max-len */

function instructionForContexts(args: Pick<EditRequestBody, 'pageBody' | 'isPageBodyPartial' | 'partialPageBodyStartIndex' | 'selectedText' | 'selectedPosition'>): string {
  return `# Contexts:
## ${args.isPageBodyPartial ? 'pageBodyPartial' : 'pageBody'}:

\`\`\`markdown
${args.pageBody}
\`\`\`

${args.isPageBodyPartial && args.partialPageBodyStartIndex != null
    ? `- **partialPageBodyStartIndex**: ${args.partialPageBodyStartIndex ?? 0}`
    : ''
}

${args.selectedText != null
    ? `## selectedText: \n\n\`\`\`markdown\n${args.selectedText}\n\`\`\``
    : ''
}

${args.selectedPosition != null
    ? `- **selectedPosition**: ${args.selectedPosition}`
    : ''
}
`;
}

/**
 * Create endpoint handlers for editor assistant
 */
export const postMessageToEditHandlersFactory: PostMessageHandlersFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  // Validator setup
  const validator: ValidationChain[] = [
    body('userMessage')
      .isString()
      .withMessage('userMessage must be string')
      .notEmpty()
      .withMessage('userMessage must be set'),
    body('pageBody')
      .isString()
      .withMessage('pageBody must be string and not empty'),
    body('isPageBodyPartial')
      .optional()
      .isBoolean()
      .withMessage('isPageBodyPartial must be boolean'),
    body('selectedText')
      .optional()
      .isString()
      .withMessage('selectedText must be string'),
    body('selectedPosition')
      .optional()
      .isNumeric()
      .withMessage('selectedPosition must be number'),
    body('threadId').optional().isString().withMessage('threadId must be string'),
  ];

  return [
    accessTokenParser, loginRequiredStrictly, certifyAiService, validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const {
        userMessage,
        pageBody, isPageBodyPartial, partialPageBodyStartIndex,
        selectedText, selectedPosition,
        threadId,
      } = req.body;

      // Parameter check
      if (threadId == null) {
        return res.apiv3Err(new ErrorV3('threadId is not set', MessageErrorCode.THREAD_ID_IS_NOT_SET), 400);
      }

      // Service check
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      const threadRelation = await ThreadRelationModel.findOne({ threadId: { $eq: threadId } });
      if (threadRelation == null) {
        return res.apiv3Err(new ErrorV3('ThreadRelation not found'), 404);
      }

      // Check if usable
      if (threadRelation.aiAssistant != null) {
        const aiAssistantId = getIdStringForRef(threadRelation.aiAssistant);
        const isAiAssistantUsable = await openaiService.isAiAssistantUsable(aiAssistantId, req.user);
        if (!isAiAssistantUsable) {
          return res.apiv3Err(new ErrorV3('The specified AI assistant is not usable'), 400);
        }
      }

      // Initialize SSE helper and stream processor
      const sseHelper = new SseHelper(res);
      const streamProcessor = new LlmResponseStreamProcessor({
        messageCallback: (appendedMessage) => {
          sseHelper.writeData<SseMessage>({ appendedMessage });
        },
        diffDetectedCallback: (detected) => {
          sseHelper.writeData<SseDetectedDiff>({ diff: detected });
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        dataFinalizedCallback: (message, replacements) => {
          sseHelper.writeData<SseFinalized>({ success: true });
        },
      });

      try {
        // Set response headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream;charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        });

        let rawBuffer = '';

        // Get assistant and process thread
        const assistant = await getOrCreateEditorAssistant();
        const thread = await openaiClient.beta.threads.retrieve(threadId);

        // Create stream
        const stream = openaiClient.beta.threads.runs.stream(thread.id, {
          assistant_id: assistant.id,
          additional_instructions: [
            instruction(pageBody != null),
            instructionForContexts({
              pageBody,
              isPageBodyPartial,
              partialPageBodyStartIndex,
              selectedText,
              selectedPosition,
            }),
          ].join('\n'),
          additional_messages: [
            {
              role: 'user',
              content: `User request: ${userMessage}`,
            },
          ],
          response_format: zodResponseFormat(LlmEditorAssistantResponseSchema, 'editor_assistant_response'),
        });

        // Message delta handler
        const messageDeltaHandler = async(delta: MessageDelta) => {
          const content = delta.content?.[0];

          // Process annotations
          if (content?.type === 'text' && content?.text?.annotations != null) {
            await replaceAnnotationWithPageLink(content, req.user.lang);
          }

          // Process text
          if (content?.type === 'text' && content.text?.value) {
            const chunk = content.text.value;

            // Process data with JSON processor
            streamProcessor.process(rawBuffer, chunk);

            rawBuffer += chunk;
          }
          else {
            sseHelper.writeData(delta);
          }
        };

        // Register event handlers
        stream.on('messageDelta', messageDeltaHandler);

        // Run error handler
        stream.on('event', (delta) => {
          if (delta.event === 'thread.run.failed') {
            const errorMessage = delta.data.last_error?.message;
            if (errorMessage == null) return;

            logger.error(errorMessage);
            sseHelper.writeError(errorMessage, getStreamErrorCode(errorMessage));
          }
        });

        // Completion handler
        stream.once('messageDone', () => {
          // Process and send final result
          streamProcessor.sendFinalResult(rawBuffer);

          // Clean up stream
          streamProcessor.destroy();
          stream.off('messageDelta', messageDeltaHandler);
          sseHelper.end();
        });

        // Error handler
        stream.once('error', (err) => {
          logger.error('Stream error:', err);

          // Clean up
          streamProcessor.destroy();
          stream.off('messageDelta', messageDeltaHandler);
          sseHelper.writeError('An error occurred while processing your request');
          sseHelper.end();
        });

        // Clean up on client disconnect
        req.on('close', () => {
          streamProcessor.destroy();

          if (stream) {
            stream.off('messageDelta', () => {});
            stream.off('event', () => {});
          }

          logger.debug('Connection closed by client');
        });
      }
      catch (err) {
        // Clean up and respond on error
        logger.error('Error in edit handler:', err);
        streamProcessor.destroy();
        return res.status(500).send(err.message);
      }
    },
  ];
};
