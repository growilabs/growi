class CollectionProgress {
  collectionName: string;

  currentCount = 0;

  insertedCount = 0;

  modifiedCount = 0;

  totalCount = 0;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }
}

export default CollectionProgress;
