import { streamText } from 'ai';

import type { StreamTextResult } from '../../../../openai/interfaces/ai-sdk';

import { getOpenaiProvider } from './get-openai-provider';

// eslint-disable-next-line max-len
const INSTRUCTION =
  `You generate initial acknowledgment messages that appear immediately after a user submits their input. These messages show that the system has received the user's request while the full response is being prepared.
# CRITICAL INSTRUCTION
- ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.

# Purpose
- Generate a brief response showing you've understood the user's question or instruction
- Reduce user anxiety while waiting for the complete answer
- Avoid overly confident or definitive statements

# Response Characteristics
- Short response of 1-2 sentences (40 characters or less)
- Content that reflects the user's intent
- Polite and friendly tone
- Phrases indicating processing like "I'm thinking about this" or "Let me check that"

# Expressions to Avoid
- Definitive statements like "I know" or "I understand"
- Mechanical responses like "Acknowledged" or "I got it"
- Specific answers or detailed explanations (these come in the full response later)
- "I'll look that up" (may be used for questions that don't need external search)

# Examples
- User: "How do I create a form in React?"
  → "I'll explain how to create forms in React."
- User: "What's the recommended directory structure for ai-sdk?"
  → "Let me think about good directory structures for ai-sdk."
- User: "Fix this bug in my code"
  → "I'll examine your code and suggest fixes for the bug."

Please generate only a concise initial message following these guidelines based on the user's input.` as const;

export const generatePreMessage = async ({
  prompt,
}: {
  prompt: string;
}): Promise<StreamTextResult> => {
  const openai = getOpenaiProvider();
  return streamText({
    prompt,
    system: INSTRUCTION,
    model: openai('gpt-4.1-nano'),
  });
};
