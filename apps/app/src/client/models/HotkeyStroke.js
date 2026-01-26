import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:HotkeyStroke');

export default class HotkeyStroke {
  constructor(stroke) {
    this.stroke = stroke;
    this.activeIndices = [];
  }

  get firstKey() {
    return this.stroke[0];
  }

  /**
   * Evaluate whether the specified key completes stroke or not
   * @param {string} key
   * @return T/F whether the specified key completes stroke or not
   */
  evaluate(key) {
    if (key === this.firstKey) {
      // add a new active index
      this.activeIndices.push(0);
    }

    let isCompleted = false;
    this.activeIndices = this.activeIndices
      .map((index) => {
        // return null when key does not match
        if (key !== this.stroke[index]) {
          return null;
        }

        const nextIndex = index + 1;

        if (this.stroke.length <= nextIndex) {
          isCompleted = true;
          return null;
        }

        return nextIndex;
      })
      // exclude null
      .filter((index) => index != null);

    // reset if completed
    if (isCompleted) {
      this.activeIndices = [];
    }

    logger.debug(
      'activeIndices for [',
      this.stroke,
      '] => [',
      this.activeIndices,
      ']',
    );

    return isCompleted;
  }
}
