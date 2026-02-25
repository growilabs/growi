import type Crowi from '../crowi';

export const generateCertifyBrandLogoMiddleware = (crowi: Crowi) => {
  return async (req, res, next) => {
    req.isBrandLogo = true;
    next();
  };
};
