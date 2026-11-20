export const setup = () => {
  return (req, res, next) => {
    res.locals.user = req.user;
    next();
  };
};
