import type { streamText, generateText } from 'ai';

export type GenerateTextConfig = Parameters<typeof generateText>[0];
export type StreamTextConfig = Parameters<typeof streamText>[0];
export type GenerateTextResult = ReturnType<typeof generateText>;
export type StreamTextResult = ReturnType<typeof streamText>;
