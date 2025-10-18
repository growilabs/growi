const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 1000;

const OFFSET_DEFAULT = 0;

const DEFAULT_MAX_RESULT_WINDOW = 10000;

const parseIntValue = (value, defaultValue, maxLimit) => {
  if (!value) {
    return defaultValue;
  }

  const v = parseInt(value, 10);
  if (!maxLimit) {
    return v;
  }

  return v <= maxLimit ? v : maxLimit;
};

function ApiPaginate() {}

ApiPaginate.parseOptionsForElasticSearch = (params) => {
  const limit = parseIntValue(params.limit, LIMIT_DEFAULT, LIMIT_MAX);
  const offset = parseIntValue(params.offset, OFFSET_DEFAULT);

  // See https://github.com/crowi/crowi/pull/293
  if (limit + offset > DEFAULT_MAX_RESULT_WINDOW) {
    throw new Error(
      `(limit + offset) must be less than or equal to ${DEFAULT_MAX_RESULT_WINDOW}`,
    );
  }

  return { limit, offset };
};

ApiPaginate.parseOptions = (params) => {
  const limit = parseIntValue(params.limit, LIMIT_DEFAULT, LIMIT_MAX);
  const offset = parseIntValue(params.offset, OFFSET_DEFAULT);

  return { limit, offset };
};

module.exports = ApiPaginate;
