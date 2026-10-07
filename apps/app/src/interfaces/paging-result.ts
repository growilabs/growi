export type IPagingResult<T> = {
  items: T[];
  totalCount: number;
  limit: number;
};
