// biome-ignore lint/suspicious/noExplicitAny: ignore
export class ErrorV3<ARGS = any> extends Error {
  code: string;

  args?: ARGS;

  constructor(
    message = '',
    code = '',
    stack = undefined,
    args: ARGS | undefined = undefined,
  ) {
    super(); // do not provide message to the super constructor
    this.message = message;
    this.code = code;
    this.stack = stack;
    this.args = args;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: ignore
export const isErrorV3 = <ARGS = any>(obj: any): obj is ErrorV3<ARGS> => {
  return (
    obj != null && typeof obj === 'object' && 'code' in obj && 'message' in obj
  );
};
