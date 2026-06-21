module.exports = () => {
  return (req, res, next) => {
    res.locals.user = req.user;
    next();
  };
};
