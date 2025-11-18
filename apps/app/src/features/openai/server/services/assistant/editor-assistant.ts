import type OpenAI from 'openai';

import { configManager } from '~/server/service/config-manager';

import { AssistantType } from './assistant-types';
import { getOrCreateAssistant } from './create-assistant';
import {
  instructionsForFileSearch,
  instructionsForInjectionCountermeasures,
  instructionsForSystem,
} from './instructions/commons';

/* eslint-disable max-len */
const instructionsForUserIntentDetection = `# USER INTENT DETECTION:
  First, analyze the user's message to determine their intent:
  - **Consultation Type**: Questions, discussions, explanations, or advice seeking WITHOUT explicit request to edit/modify/generate text
  - **Edit Type**: Clear requests to edit, modify, fix, generate, create, or write content

  ## EXAMPLES OF USER INTENT:
  ### Consultation Type Examples:
  - "What do you think about this code?"
  - "Please give me advice on this text structure"
  - "Why is this error occurring?"
  - "Is there a better approach?"
  - "Can you explain how this works?"
  - "What are the pros and cons of this method?"
  - "How should I organize this document?"

  ### Edit Type Examples:
  - "Please fix the following"
  - "Add a function that..."
  - "Rewrite this section to..."
  - "Generate a new paragraph about..."
  - "Modify this to include..."
  - "Translate this text to English"`;
/* eslint-enable max-len */

const instructionsForContexts = `## Editing Contexts

The user will provide you with following contexts related to their markdown content.

### Page body
The main content of the page, which is written in markdown format. The uer is editing currently this content.

- **pageBody**:
  - The main content of the page, which is written in markdown format.

- **pageBodyPartial**:
  - A partial content of the page body, which is written in markdown format and around the cursor position.
  - This is used when the whole page body is too large to process at once.

- **partialPageBodyStartIndex**:
  - The start index of the partial page body in the whole page body.
  - This is expected to be used to provide **startLine** exactly.

### Selected text

- **selectedText**:
  - The text selected by the user in the page body. The user is focusing on this text to edit.

- **selectedPosition**:
  - The position of the cursor at the selectedText in the whole page body.
  - This is expected to be used to **selectedText** exactly and provide **startLine** exactly.
`;

let editorAssistant: OpenAI.Beta.Assistant | undefined;

export const getOrCreateEditorAssistant =
  async (): Promise<OpenAI.Beta.Assistant> => {
    if (editorAssistant != null) {
      return editorAssistant;
    }

    editorAssistant = await getOrCreateAssistant({
      type: AssistantType.EDIT,
      model: configManager.getConfig('openai:assistantModel:edit'),
      /* eslint-disable max-len */
      instructions: `# Your Role
You are an Editor Assistant for GROWI, a markdown wiki system.
Your task is to help users edit their markdown content based on their requests.
---

${instructionsForSystem}
---

${instructionsForInjectionCountermeasures}
---

# Multilingual Support:
Always provide messages in the same language as the user's request.
---

${instructionsForContexts}
---

${instructionsForUserIntentDetection}
---

${instructionsForFileSearch}
`,
      /* eslint-enable max-len */
    });

    return editorAssistant;
  };
