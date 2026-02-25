import type { IPage } from '@growi/core';
import type { PipelineStage, Query } from 'mongoose';

import type { PageModel } from '~/server/models/page';

export const aggregatePipelineToIndex = (
  maxBodyLengthToIndex: number,
  query?: Query<PageModel, IPage>,
): PipelineStage[] => {
  const basePipeline = query == null ? [] : [{ $match: query.getQuery() }];

  return [
    ...basePipeline,

    // join Revision
    {
      $lookup: {
        from: 'revisions',
        localField: 'revision',
        foreignField: '_id',
        as: 'revision',
      },
    },
    // unwind and filter pages that does not have revision
    {
      $unwind: {
        path: '$revision',
      },
    },
    {
      $addFields: {
        bodyLength: { $strLenCP: '$revision.body' },
      },
    },

    // join User
    {
      $lookup: {
        from: 'users',
        localField: 'creator',
        foreignField: '_id',
        as: 'creator',
      },
    },
    {
      $unwind: {
        path: '$creator',
        preserveNullAndEmptyArrays: true,
      },
    },

    // join Comment
    {
      $lookup: {
        from: 'comments',
        localField: '_id',
        foreignField: 'page',
        pipeline: [
          {
            $addFields: {
              commentLength: { $strLenCP: '$comment' },
            },
          },
        ],
        as: 'comments',
      },
    },
    {
      $addFields: {
        commentsCount: { $size: { $ifNull: ['$comments', []] } },
      },
    },

    // join Bookmark
    {
      $lookup: {
        from: 'bookmarks',
        localField: '_id',
        foreignField: 'page',
        as: 'bookmarks',
      },
    },
    {
      $addFields: {
        bookmarksCount: { $size: { $ifNull: ['$bookmarks', []] } },
      },
    },

    // add counts for embedded arrays
    {
      $addFields: {
        likeCount: { $size: { $ifNull: ['$liker', []] } },
      },
    },
    {
      $addFields: {
        seenUsersCount: { $size: { $ifNull: ['$seenUsers', []] } },
      },
    },

    // project
    {
      $project: {
        path: 1,
        createdAt: 1,
        updatedAt: 1,
        grant: 1,
        grantedUsers: 1,
        grantedGroups: 1,
        'revision.body': {
          $cond: {
            if: { $lte: ['$bodyLength', maxBodyLengthToIndex] },
            // biome-ignore lint/suspicious/noThenProperty: ignore
            then: '$revision.body',
            else: '',
          },
        },
        comments: {
          $map: {
            input: '$comments',
            as: 'comment',
            in: {
              $cond: {
                if: { $lte: ['$$comment.commentLength', maxBodyLengthToIndex] },
                // biome-ignore lint/suspicious/noThenProperty: ignore
                then: '$$comment.comment',
                else: '',
              },
            },
          },
        },
        commentsCount: 1,
        bookmarksCount: 1,
        likeCount: 1,
        seenUsersCount: 1,
        'creator.username': 1,
        'creator.email': 1,
      },
    },
  ];
};
