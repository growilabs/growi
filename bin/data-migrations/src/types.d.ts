export type MigrationModule = (body: string) => string;
export type ReplaceLatestRevisions = (body: string, migrationModules: MigrationModule[]) => string;

export type Operatioins = Array<
  {
    updateOne: {
      filter: { _id: string }
      update: { $set: { body: string }}
    }
  }
>

export declare global {
  const db;
  const sleep;

  function print(arg: string): void;
}
