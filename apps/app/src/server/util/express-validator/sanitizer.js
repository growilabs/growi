// custom sanitizers not covered by express-validator
// https://github.com/validatorjs/validator.js#sanitizers

const sanitizers = {};

sanitizers.toPagingLimit = (_value) => {
  const value = parseInt(_value, 10);
  return !Number.isNaN(value) && Number.isFinite(value) ? value : 20;
};

sanitizers.toPagingOffset = (_value) => {
  const value = parseInt(_value, 10);
  return !Number.isNaN(value) && Number.isFinite(value) ? value : 0;
};

module.exports = sanitizers;
