import type OpenAI from 'openai';

import { configManager } from '~/server/service/config-manager';

import { openaiClient } from '../client';
import type { AssistantType } from './assistant-types';

const findAssistantByName = async (
  assistantName: string,
): Promise<OpenAI.Beta.Assistant | undefined> => {
  // declare finder
  const findAssistant = async (
    assistants: OpenAI.Beta.Assistants.AssistantsPage,
  ): Promise<OpenAI.Beta.Assistant | undefined> => {
    const found = assistants.data.find(
      (assistant) => assistant.name === assistantName,
    );

    if (found != null) {
      return found;
    }

    // recursively find assistant
    if (assistants.hasNextPage()) {
      return findAssistant(await assistants.getNextPage());
    }
  };

  const storedAssistants = await openaiClient.beta.assistants.list({
    order: 'desc',
  });

  return findAssistant(storedAssistants);
};

type CreateAssistantArgs = {
  type: AssistantType;
  model: OpenAI.Chat.ChatModel;
  instructions: string;
};

export const getOrCreateAssistant = async (
  args: CreateAssistantArgs,
): Promise<OpenAI.Beta.Assistant> => {
  const appSiteUrl = configManager.getConfig('app:siteUrl');
  const assistantName = `GROWI ${args.type} Assistant for ${appSiteUrl}`;

  const assistant =
    (await findAssistantByName(assistantName)) ??
    (await openaiClient.beta.assistants.create({
      name: assistantName,
      model: args.model,
    }));

  // update instructions
  openaiClient.beta.assistants.update(assistant.id, {
    instructions: args.instructions,
    model: args.model,
    tools: [{ type: 'file_search' }],
  });

  return assistant;
};
