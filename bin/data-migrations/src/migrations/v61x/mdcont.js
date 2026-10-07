/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    const oldMdcontPrefixRegExp = /#mdcont-/g;
    return body.replace(oldMdcontPrefixRegExp, '#');
  },
];
