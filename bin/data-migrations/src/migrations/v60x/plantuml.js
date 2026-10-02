/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    const oldPlantUmlRegExp = /@startuml\n([\s\S]*?)\n@enduml/g; // plantUML old format
    return body.replace(oldPlantUmlRegExp, '``` plantuml\n$1\n```');
  },
];
