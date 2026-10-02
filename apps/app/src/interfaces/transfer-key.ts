export interface ITransferKey<ID = string> {
  _id: ID;
  expireAt: Date;
  keyString: string;
  key: string;
}
