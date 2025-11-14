// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Delta = Array<{
  insert?: string | object | Array<any>;
  delete?: number;
  retain?: number;
}>;
