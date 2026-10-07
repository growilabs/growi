import CollectionProgress from './collection-progress';

class CollectionProgressingStatus {
  totalCount = 0;

  progressList: CollectionProgress[];

  progressMap: Record<string, CollectionProgress>;

  constructor(collections: string[]) {
    this.progressMap = {};

    this.progressList = collections.map((collectionName) => {
      return new CollectionProgress(collectionName);
    });

    // collection name to instance mapping
    this.progressList.forEach((p) => {
      this.progressMap[p.collectionName] = p;
    });
  }

  recalculateTotalCount(): void {
    this.progressList.forEach((p) => {
      this.progressMap[p.collectionName] = p;
      this.totalCount += p.totalCount;
    });
  }

  get currentCount(): number {
    return this.progressList.reduce((acc, crr) => acc + crr.currentCount, 0);
  }
}

export default CollectionProgressingStatus;
