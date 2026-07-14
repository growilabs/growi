export namespace mongodb {
  export { mongoUri as url };
  export let databaseName: string;
  export { mongoOptions as options };
}
export const migrationsDir: string | undefined;
declare const mongoUri: string;
declare const mongoOptions: import('mongoose').ConnectOptions & {
  useUnifiedTopology: boolean;
};
export declare let changelogCollectionName: string;
