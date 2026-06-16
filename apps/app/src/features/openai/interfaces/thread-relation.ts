import type { HasObjectId, IUser, Ref } from '@growi/core';
import type { PaginateResult } from 'mongoose';

import type { AiAssistant, AiAssistantHasId } from './ai-assistant';

export const ThreadType = {
  KNOWLEDGE: 'knowledge',
  EDITOR: 'editor',
} as const;

export type ThreadType = (typeof ThreadType)[keyof typeof ThreadType];

export interface IThreadRelation {
  userId: Ref<IUser>;
  aiAssistant?: Ref<AiAssistant>;
  threadId: string;
  title?: string;
  type: ThreadType;
  expiredAt: Date;
  isActive: boolean;
}

export type IThreadRelationHasId = IThreadRelation & HasObjectId;

export type IThreadRelationPopulated = Omit<
  IThreadRelationHasId,
  'aiAssistant'
> & { aiAssistant: AiAssistantHasId };

export type IThreadRelationPaginate = {
  paginateResult: PaginateResult<IThreadRelationPopulated>;
};

export type IApiv3DeleteThreadParams = {
  aiAssistantId: string;
  threadRelationId: string;
};
