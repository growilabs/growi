const { Transform } = require('stream');

function createBatchStream(batchSize) {
  let batchBuffer = [];

  return new Transform({
    // object mode
    objectMode: true,

    transform(doc, encoding, callback) {
      batchBuffer.push(doc);

      if (batchBuffer.length >= batchSize) {
        this.push(batchBuffer);

        // reset buffer
        batchBuffer = [];
      }

      callback();
    },

    final(callback) {
      if (batchBuffer.length > 0) {
        this.push(batchBuffer);
      }
      callback();
    },
  });
}

module.exports = {
  createBatchStream,
};
