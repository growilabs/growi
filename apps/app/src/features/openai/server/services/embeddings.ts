import crypto from 'crypto';

import type { OpenAI } from 'openai';

import { openaiClient } from './client';

export const embed = async (
  input: string,
  username?: string,
): Promise<OpenAI.Embedding[]> => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user;

  if (username != null) {
    const hasher = crypto.createHash('sha256');
    hasher.update(username);
    user = hasher.digest('hex');
  }

  const result = await openaiClient.embeddings.create({
    input,
    model: 'text-embedding-3-large',
    dimensions: 768, // TODO: Make this configurable
    user,
  });

  return result.data;
};
