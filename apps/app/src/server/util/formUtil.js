module.exports = {
  normalizeCRLFFilter(value) {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  },
  stringToArrayFilter(value) {
    if (!value || value === '') {
      return [];
    }

    return value.split('\n');
  },
};
