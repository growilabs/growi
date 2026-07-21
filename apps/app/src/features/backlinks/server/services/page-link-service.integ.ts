import { GroupType, type IUserHasId } from '@growi/core';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import PageLink from '../models/page-link';
import { PageLinkService } from './page-link-service';

/*
 * B1.7 — findBacklinks: permission-filtered backlinks read.
 * Contract (design.md § Read flow, Security; requirements 1.1, 1.7, 2.1–2.4):
 * readable, non-trashed source pages are returned as IBacklink[]; restricted/trashed omitted.
 */
describe('PageLinkService.findBacklinks (integration)', () => {
  const PREFIX = '/backlinks-findbacklinks-test';

  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;

  let rootPage: PageDocument;

  // IUserHasId._id is a string; it is converted to an ObjectId at the grant/relation sinks below.
  let viewer: IUserHasId; // the querying user; member of viewerGroup only
  let foreignUser: IUserHasId; // member of foreignGroup only
  let viewerGroupId: Types.ObjectId;
  let foreignGroupId: Types.ObjectId;

  const service = () => new PageLinkService(mock<Crowi>());

  // --- seeding helpers ---------------------------------------------------

  type CreatePageOptions = {
    grant: number;
    grantedUsers?: Types.ObjectId[] | null;
    grantedGroups?: { item: Types.ObjectId; type: string }[];
    status?: string;
  };

  const createPage = (
    path: string,
    options: CreatePageOptions,
  ): Promise<HydratedDocument<PageDocument>> =>
    Page.create({
      path: `${PREFIX}${path}`,
      grant: options.grant,
      grantedUsers: options.grantedUsers ?? null,
      grantedGroups: options.grantedGroups ?? [],
      status: options.status,
      isEmpty: false,
      parent: rootPage._id,
    });

  const linkTo = (
    source: PageDocument,
    target: PageDocument,
  ): Promise<unknown> =>
    PageLink.create({
      fromPage: source._id,
      toPath: target.path,
      toPage: target._id,
    });

  // --- lifecycle ---------------------------------------------------------

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    const existingRoot = await Page.findOne({ path: '/' });
    rootPage =
      existingRoot ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    viewerGroupId = new mongoose.Types.ObjectId();
    foreignGroupId = new mongoose.Types.ObjectId();
    await UserGroup.insertMany([
      { _id: viewerGroupId, name: `${PREFIX}-viewerGroup`, parent: null },
      { _id: foreignGroupId, name: `${PREFIX}-foreignGroup`, parent: null },
    ]);

    await User.insertMany([
      {
        name: 'blr-viewer',
        username: 'blr-viewer',
        email: 'blr-viewer@example.com',
      },
      {
        name: 'blr-foreign',
        username: 'blr-foreign',
        email: 'blr-foreign@example.com',
      },
    ]);
    viewer = await User.findOne({ username: 'blr-viewer' });
    foreignUser = await User.findOne({ username: 'blr-foreign' });

    await UserGroupRelation.insertMany([
      {
        relatedGroup: viewerGroupId,
        relatedUser: new mongoose.Types.ObjectId(viewer._id),
      },
      {
        relatedGroup: foreignGroupId,
        relatedUser: new mongoose.Types.ObjectId(foreignUser._id),
      },
    ]);
  });

  afterEach(async () => {
    const pages = await Page.find({
      path: new RegExp(`^${PREFIX}/`),
    }).select('_id');
    const ids = pages.map((p) => p._id);
    await PageLink.deleteMany({ fromPage: { $in: ids } });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
  });

  afterAll(async () => {
    await UserGroupRelation.deleteMany({
      relatedGroup: { $in: [viewerGroupId, foreignGroupId] },
    });
    await UserGroup.deleteMany({
      _id: { $in: [viewerGroupId, foreignGroupId] },
    });
    await User.deleteMany({ username: { $in: ['blr-viewer', 'blr-foreign'] } });
  });

  // --- specs -------------------------------------------------------------

  it('returns readable, non-trashed sources as IBacklink DTOs (pageId + path)', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const source = await createPage('/public-source', {
      grant: Page.GRANT_PUBLIC,
    });
    await linkTo(source, target);

    const backlinks = await service().findBacklinks(target._id, viewer);

    expect(backlinks).toEqual([
      { pageId: source._id.toString(), path: source.path },
    ]);
  });

  it('omits a source the viewer cannot read (owner-restricted to another user)', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const readable = await createPage('/readable', {
      grant: Page.GRANT_PUBLIC,
    });
    const restricted = await createPage('/owner-restricted', {
      grant: Page.GRANT_OWNER,
      grantedUsers: [new mongoose.Types.ObjectId(foreignUser._id)],
    });
    await linkTo(readable, target);
    await linkTo(restricted, target);

    const asViewer = await service().findBacklinks(target._id, viewer);

    // The restricted source must not leak — neither its path nor its existence.
    expect(asViewer).toEqual([
      { pageId: readable._id.toString(), path: readable.path },
    ]);

    // Positive control: the owner sees it, so the omission above is the grant filter's
    // doing, not a missing row.
    const asOwner = await service().findBacklinks(target._id, foreignUser);
    expect(asOwner).toEqual(
      expect.arrayContaining([
        { pageId: restricted._id.toString(), path: restricted.path },
      ]),
    );
  });

  it('omits a source restricted to a group the viewer is not in, but includes it for a member', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const groupSource = await createPage('/group-restricted', {
      grant: Page.GRANT_USER_GROUP,
      grantedGroups: [{ item: foreignGroupId, type: GroupType.userGroup }],
    });
    await linkTo(groupSource, target);

    const asViewer = await service().findBacklinks(target._id, viewer);
    const asMember = await service().findBacklinks(target._id, foreignUser);

    expect(asViewer).toEqual([]);
    expect(asMember).toEqual([
      { pageId: groupSource._id.toString(), path: groupSource.path },
    ]);
  });

  it('omits a trashed source page', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const live = await createPage('/live', { grant: Page.GRANT_PUBLIC });
    const trashed = await createPage('/trashed', {
      grant: Page.GRANT_PUBLIC,
      status: Page.STATUS_DELETED,
    });
    await linkTo(live, target);
    await linkTo(trashed, target);

    const backlinks = await service().findBacklinks(target._id, viewer);

    expect(backlinks).toEqual([
      { pageId: live._id.toString(), path: live.path },
    ]);
  });

  it('returns only public sources for a guest (null user)', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const publicSource = await createPage('/public-source', {
      grant: Page.GRANT_PUBLIC,
    });
    const ownerSource = await createPage('/owner-source', {
      grant: Page.GRANT_OWNER,
      grantedUsers: [new mongoose.Types.ObjectId(viewer._id)],
    });
    await linkTo(publicSource, target);
    await linkTo(ownerSource, target);

    const asGuest = await service().findBacklinks(target._id, null);

    expect(asGuest).toEqual([
      { pageId: publicSource._id.toString(), path: publicSource.path },
    ]);

    // Positive control: the owner sees ownerSource, so the guest's omission is the
    // grant filter's doing.
    const asOwner = await service().findBacklinks(target._id, viewer);
    expect(asOwner).toEqual(
      expect.arrayContaining([
        { pageId: ownerSource._id.toString(), path: ownerSource.path },
      ]),
    );
  });

  it('reflects a grant change on the next read (2.4)', async () => {
    const target = await createPage('/target', { grant: Page.GRANT_PUBLIC });
    const source = await createPage('/flipping-source', {
      grant: Page.GRANT_PUBLIC,
    });
    await linkTo(source, target);

    expect(await service().findBacklinks(target._id, viewer)).toHaveLength(1);

    // Restrict the source to a group the viewer is not in.
    await Page.updateOne(
      { _id: source._id },
      {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: foreignGroupId, type: GroupType.userGroup }],
      },
    );

    expect(await service().findBacklinks(target._id, viewer)).toEqual([]);
  });

  it('returns an empty array when the page has no backlinks (1.7)', async () => {
    const target = await createPage('/lonely-target', {
      grant: Page.GRANT_PUBLIC,
    });

    const backlinks = await service().findBacklinks(target._id, viewer);

    expect(backlinks).toEqual([]);
  });
});
