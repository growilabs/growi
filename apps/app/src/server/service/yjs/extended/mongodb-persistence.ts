import { MongodbPersistence as Original } from 'y-mongodb-provider';

export type MetadataTypesMap = {
  updatedAt: number;
};
type MetadataKeys = keyof MetadataTypesMap;

export class MongodbPersistence extends Original {
  async setTypedMeta<K extends MetadataKeys>(
    docName: string,
    key: K,
    value: MetadataTypesMap[K],
  ): Promise<void> {
    return this.setMeta(docName, key, value);
  }

  async getTypedMeta<K extends MetadataKeys>(
    docName: string,
    key: K,
  ): Promise<MetadataTypesMap[K] | undefined> {
    return (await this.getMeta(docName, key)) as
      | MetadataTypesMap[K]
      | undefined;
  }
}
