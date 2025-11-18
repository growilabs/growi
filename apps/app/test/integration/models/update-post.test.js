import UpdatePost from '../../../src/server/models/update-post';

describe('UpdatePost', () => {
  describe('.createPrefixesByPathPattern', () => {
    describe('with a path', () => {
      test('should return right patternPrfixes', () => {
        expect(UpdatePost.createPrefixesByPathPattern('/*')).toEqual([
          '*',
          '*',
        ]);
        expect(UpdatePost.createPrefixesByPathPattern('/user/*/日報*')).toEqual(
          ['user', '*'],
        );
        expect(
          UpdatePost.createPrefixesByPathPattern('/project/hoge/*'),
        ).toEqual(['project', 'hoge']);
        expect(UpdatePost.createPrefixesByPathPattern('/*/MTG/*')).toEqual([
          '*',
          'MTG',
        ]);
        expect(UpdatePost.createPrefixesByPathPattern('自己紹介')).toEqual([
          '*',
          '*',
        ]);
        expect(
          UpdatePost.createPrefixesByPathPattern(
            '/user/aoi/メモ/2016/02/10/xxx',
          ),
        ).toEqual(['user', 'aoi']);
      });
    });
  });

  describe('.getRegExpByPattern', () => {
    describe('with a pattern', () => {
      test('should return right regexp', () => {
        expect(UpdatePost.getRegExpByPattern('/*')).toEqual(/^\/.*/);
        expect(UpdatePost.getRegExpByPattern('/user/*/日報*')).toEqual(
          /^\/user\/.*\/日報.*/,
        );
        expect(UpdatePost.getRegExpByPattern('/project/hoge/*')).toEqual(
          /^\/project\/hoge\/.*/,
        );
        expect(UpdatePost.getRegExpByPattern('/*/MTG/*')).toEqual(
          /^\/.*\/MTG\/.*/,
        );
        expect(UpdatePost.getRegExpByPattern('自己紹介')).toEqual(
          /^\/.*自己紹介.*/,
        );
        expect(
          UpdatePost.getRegExpByPattern('/user/aoi/メモ/2016/02/10/xxx'),
        ).toEqual(/^\/user\/aoi\/メモ\/2016\/02\/10\/xxx/);
      });
    });
  });

  describe('.normalizeChannelName', () => {
    describe('with a channel name', () => {
      test('should return true', () => {
        expect(UpdatePost.normalizeChannelName('#pj-hoge')).toEqual('pj-hoge');
        expect(UpdatePost.normalizeChannelName('pj-hoge')).toEqual('pj-hoge');
      });
    });
  });
});
