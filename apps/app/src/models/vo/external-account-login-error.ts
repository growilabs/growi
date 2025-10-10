export class ExternalAccountLoginError extends Error {
  args?: any;

  constructor(message = '', args = undefined) {
    super();
    this.message = message;
    this.args = args;
  }
}
