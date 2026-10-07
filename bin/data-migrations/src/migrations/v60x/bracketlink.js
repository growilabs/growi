/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    // https://regex101.com/r/btZ4hc/1
    const oldBracketLinkRegExp = /(?<!\[)\[{1}(\/.*?)\]{1}(?!\])/g; // Page Link old format
    return body.replace(oldBracketLinkRegExp, '[[$1]]');
  },
];
