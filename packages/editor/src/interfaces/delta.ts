export type Delta = Array<{
  insert?: string | object | Array<any>;
  delete?: number;
  retain?: number;
}>;
