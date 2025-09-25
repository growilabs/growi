export class ErrorV3 extends Error {
  code: string;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  args?: any;

  constructor(
    message = '',
    code = '',
    stack = undefined,
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    args: any = undefined,
  ) {
    super(); // do not provide message to the super constructor
    this.message = message;
    this.code = code;
    this.stack = stack;
    this.args = args;
  }
}
