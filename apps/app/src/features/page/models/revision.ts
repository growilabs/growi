import { Prisma } from '~/generated/prisma/client';

export const extension = Prisma.defineExtension((client) =>
  client.$extends({
    model: {
      revisions: {
        findLatest(pageId: string) {
          return Prisma.getExtensionContext(this).findFirst({
            where: {
              pageId,
            },
            orderBy: {
              createdAt: 'desc',
            },
          });
        },
      },
    },
    result: {
      revisions: {
        isPlain: {
          needs: {
            format: true,
          },
          compute(revision) {
            return !['markdown'].includes(revision.format);
          },
        },
        isMarkdown: {
          needs: {
            format: true,
          },
          compute(revision) {
            return () => revision.format === 'markdown';
          },
        },
      },
    },
  }),
);
