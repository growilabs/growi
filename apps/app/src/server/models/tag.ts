import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import type { prisma } from '~/utils/prisma';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import { getOrCreateModel } from '../util/mongoose-utils';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const tagSchema = new Schema({
  name: {
    type: String,
    require: true,
    unique: true,
  },
});

getOrCreateModel('Tag', tagSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      tags: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      tags: {
        async getIdToNameMap(tagIds: ObjectIdLike[]) {
          const context = Prisma.getExtensionContext<typeof prisma.tags>(this);
          const tags = await context.findMany({
            where: { id: { in: tagIds.map((id) => id.toString()) } },
          });

          const idToNameMap: { [key: string]: string } = {};
          tags.forEach((tag) => {
            idToNameMap[tag._id] = tag.name;
          });

          return idToNameMap;
        },

        async findOrCreateMany(tagNames: string[]) {
          const context = Prisma.getExtensionContext<typeof prisma.tags>(this);

          const existTags = await context.findMany({
            where: { name: { in: tagNames } },
          });
          const existTagNames = existTags.map((tag) => tag.name);

          const tagsToCreate = tagNames.filter(
            (tagName) => !existTagNames.includes(tagName),
          );
          if (tagsToCreate.length > 0) {
            await context.createMany({
              data: tagsToCreate.map((name) => ({ name })),
            });
          }

          return context.findMany({ where: { name: { in: tagNames } } });
        },
      },
    },
  });
});
