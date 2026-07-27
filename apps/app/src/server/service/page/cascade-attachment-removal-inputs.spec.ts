/**
 * Unit tests for the pure input builders of the cascade attachment-removal
 * recorder (task 5.1; requirements 3.1, 3.3).
 *
 * Contract under test: deleteCompletelyOperation matches attachments against
 * pages by ObjectId *string* form. If either side forgot the stringification
 * (map keyed by ObjectId instances, or pageId left as an ObjectId), the
 * recorder's `pageIdToPath.get(attachment.pageId)` lookup would silently
 * return undefined and the snapshot would lose pagePath/pageId — the exact
 * silent degradation the design warns about (design: Snapshot Builder >
 * 入力の attachment は呼び出し側で正規化してから渡す).
 */

import { Types } from 'mongoose';

import {
  buildPageIdToPathMap,
  toAttachmentLikes,
} from './cascade-attachment-removal-inputs';

describe('toAttachmentLikes', () => {
  it('maps a Mongoose attachment (page reference held as `page`) to AttachmentLike with stringified _id and pageId', () => {
    const attachmentId = new Types.ObjectId();
    const pageId = new Types.ObjectId();

    const result = toAttachmentLikes([
      {
        _id: attachmentId,
        originalName: 'diagram.png',
        fileSize: 2048,
        page: pageId,
      },
    ]);

    expect(result).toEqual([
      {
        _id: attachmentId.toString(),
        originalName: 'diagram.png',
        fileSize: 2048,
        pageId: pageId.toString(),
      },
    ]);
  });

  it('still yields an entry, with pageId undefined, when the attachment has no page reference', () => {
    const attachmentId = new Types.ObjectId();

    const result = toAttachmentLikes([
      { _id: attachmentId, originalName: 'orphan.txt', fileSize: 1 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBeUndefined();
    expect(result[0]._id).toBe(attachmentId.toString());
  });

  it('excludes an attachment without _id instead of producing a record with a bogus target', () => {
    // `_id` is optional only in the Mongoose Document typing; a found doc
    // always has one at runtime. The builder must not fabricate a target id.
    const attachmentId = new Types.ObjectId();

    const result = toAttachmentLikes([
      { originalName: 'no-id.bin' },
      { _id: attachmentId, originalName: 'ok.bin' },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ _id: attachmentId.toString() }),
    ]);
  });
});

describe('buildPageIdToPathMap', () => {
  it('keys ObjectId page ids by their string form, paired with paths by index', () => {
    const idA = new Types.ObjectId();
    const idB = new Types.ObjectId();

    const map = buildPageIdToPathMap([idA, idB], ['/page-a', '/page-a/b']);

    expect(map.get(idA.toString())).toBe('/page-a');
    expect(map.get(idB.toString())).toBe('/page-a/b');
    expect(map.size).toBe(2);
  });

  it('accepts string ids as-is', () => {
    const id = new Types.ObjectId().toString();

    const map = buildPageIdToPathMap([id], ['/page']);

    expect(map.get(id)).toBe('/page');
  });

  it('omits an id that has no corresponding path', () => {
    const idA = new Types.ObjectId();
    const idB = new Types.ObjectId();

    const map = buildPageIdToPathMap([idA, idB], ['/only-a']);

    expect(map.get(idA.toString())).toBe('/only-a');
    expect(map.has(idB.toString())).toBe(false);
  });

  it('produces keys that match toAttachmentLikes pageId, so the recorder lookup resolves the page path', () => {
    // Cross-contract with the recorder: it looks up
    // pageIdToPath.get(attachment.pageId) — both sides must agree on the
    // ObjectId string form for pagePath to reach the snapshot (req 3.3).
    const pageId = new Types.ObjectId();

    const map = buildPageIdToPathMap([pageId], ['/matched']);
    const [attachmentLike] = toAttachmentLikes([
      { _id: new Types.ObjectId(), page: pageId },
    ]);

    expect(
      attachmentLike.pageId != null
        ? map.get(attachmentLike.pageId)
        : undefined,
    ).toBe('/matched');
  });
});
