/**
 * getToday
 */

module.exports = () => {
  const today = new Date();
  const month = `0${today.getMonth() + 1}`.slice(-2);
  const day = `0${today.getDate()}`.slice(-2);
  const dateString = `${today.getFullYear()}/${month}/${day}`;

  return dateString;
};
