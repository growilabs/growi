/**
 * Value Object
 */
class CdnResource {
  constructor(name, url, outDir) {
    this.name = name;
    this.url = url;
    this.outDir = outDir;
  }
}

module.exports = CdnResource;
