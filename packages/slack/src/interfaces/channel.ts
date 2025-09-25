export type IChannel = {
  id: string;
  name: string;
};

export type IChannelOptionalId = Omit<IChannel, 'id'> & Partial<IChannel>;
