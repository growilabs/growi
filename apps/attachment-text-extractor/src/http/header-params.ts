export class InvalidMultipart extends Error {}

export class UnreadableParams extends InvalidMultipart {}

export interface HeaderParams {
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
}

export const parseHeaderParams = (_value: string): HeaderParams => {
  throw new Error('not implemented: http/header-params.parseHeaderParams');
};
