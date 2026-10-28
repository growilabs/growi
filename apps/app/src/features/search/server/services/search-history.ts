import { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import type { ISearchHistory } from '../../interfaces/search-history';
import { toSearchHistoryKeyword } from '../../utils/search-history-keyword';

export const SEARCH_HISTORY_RETENTION_LIMIT = 50;

export class InvalidSearchHistoryKeywordError extends Error {
  constructor(message = 'Invalid search history keyword') {
    super(message);
    this.name = 'InvalidSearchHistoryKeywordError';
  }
}

type SearchHistoryRow = {
  id: string;
  keyword: string;
  lastSearchedAt: Date;
};

const NEWEST_FIRST = [
  { lastSearchedAt: 'desc' as const },
  { id: 'desc' as const },
];

const toDto = (row: SearchHistoryRow): ISearchHistory => ({
  _id: row.id,
  keyword: row.keyword,
  lastSearchedAt: row.lastSearchedAt,
});

export const listSearchHistories = async (
  userId: string,
): Promise<ISearchHistory[]> => {
  const rows = await prisma.searchhistories.findMany({
    where: { userId },
    orderBy: NEWEST_FIRST,
    take: SEARCH_HISTORY_RETENTION_LIMIT,
    select: { id: true, keyword: true, lastSearchedAt: true },
  });
  return rows.map(toDto);
};

const isUniqueConstraintViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const upsertSearchHistory = (
  userId: string,
  keyword: string,
): Promise<SearchHistoryRow> => {
  const now = new Date();
  return prisma.searchhistories.upsert({
    where: { userId_keyword: { userId, keyword } },
    update: { lastSearchedAt: now },
    create: { userId, keyword, lastSearchedAt: now },
    select: { id: true, keyword: true, lastSearchedAt: true },
  });
};

const upsertWithOneRetry = async (
  userId: string,
  keyword: string,
): Promise<SearchHistoryRow> => {
  try {
    return await upsertSearchHistory(userId, keyword);
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) {
      throw err;
    }
    return upsertSearchHistory(userId, keyword);
  }
};

const trimToRetentionLimit = async (userId: string): Promise<void> => {
  const overflow = await prisma.searchhistories.findMany({
    where: { userId },
    orderBy: NEWEST_FIRST,
    skip: SEARCH_HISTORY_RETENTION_LIMIT,
    select: { id: true, lastSearchedAt: true },
  });
  if (overflow.length === 0) {
    return;
  }
  // The cutoff keeps a row that another record bumped after the read above
  // (see design.md SearchHistoryService > recordSearchHistory).
  const cutoff = overflow[0].lastSearchedAt;
  await prisma.searchhistories.deleteMany({
    where: {
      userId,
      id: { in: overflow.map((row) => row.id) },
      lastSearchedAt: { lte: cutoff },
    },
  });
};

export const recordSearchHistory = async (
  userId: string,
  keyword: string,
): Promise<ISearchHistory> => {
  const normalized = toSearchHistoryKeyword(keyword);
  if (normalized == null) {
    throw new InvalidSearchHistoryKeywordError();
  }

  const row = await upsertWithOneRetry(userId, normalized);
  await trimToRetentionLimit(userId);
  return toDto(row);
};

export const removeAllSearchHistoriesOfUser = async (
  userId: string,
): Promise<void> => {
  await prisma.searchhistories.deleteMany({ where: { userId } });
};
