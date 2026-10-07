/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    const oldTsvTableRegExp = /:::\s?tsv(-h)?\n([\s\S]*?)\n:::/g; // TSV old format
    return body.replace(oldTsvTableRegExp, '``` tsv$1\n$2\n```');
  },
];
