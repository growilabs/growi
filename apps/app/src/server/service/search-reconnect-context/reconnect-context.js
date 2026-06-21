import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:search-reconnect-context:reconnect-context',
);

const RECONNECT_INTERVAL_SEC = 120;

class ReconnectContext {
  constructor() {
    this.lastEvalDate = null;

    this.reset(true);
  }

  reset() {
    this.counter = 0;
    this.stage = 0;
  }

  incrementCount() {
    this.counter++;
  }

  incrementStage() {
    this.counter = 0; // reset counter
    this.stage++;
  }

  get shouldReconnectByCount() {
    // https://www.google.com/search?q=10log10(x)-1+graph
    const thresholdOfThisStage = 10 * Math.log10(this.stage) - 1;
    return this.counter > thresholdOfThisStage;
  }

  get shouldReconnectByTime() {
    if (this.lastEvalDate == null) {
      this.lastEvalDate = new Date();
      return true;
    }

    const thres = this.lastEvalDate.setSeconds(
      this.lastEvalDate.getSeconds() + RECONNECT_INTERVAL_SEC,
    );
    return thres < new Date();
  }

  get shouldReconnect() {
    if (this.shouldReconnectByTime) {
      logger.info('Server should reconnect by time');
      return true;
    }
    if (this.shouldReconnectByCount) {
      logger.info('Server should reconnect by count');
      return true;
    }
    return false;
  }
}

async function nextTick(context, reconnectHandler) {
  context.incrementCount();

  if (context.shouldReconnect) {
    const isSuccessToReconnect = await reconnectHandler();

    // success to reconnect
    if (isSuccessToReconnect) {
      context.reset();
    }
    // fail to reconnect
    else {
      context.incrementStage();
    }
  }
}

module.exports = {
  ReconnectContext,
  nextTick,
};
