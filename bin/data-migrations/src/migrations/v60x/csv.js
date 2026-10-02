/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    const oldCsvTableRegExp = /:::\s?csv(-h)?\n([\s\S]*?)\n:::/g; // CSV old format
    return body.replace(oldCsvTableRegExp, '``` csv$1\n$2\n```');
  },
];
