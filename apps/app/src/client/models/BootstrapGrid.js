export default class BootstrapGrid {
  constructor(colsRatios, responsiveSize) {
    this.colsRatios = BootstrapGrid.validateColsRatios(colsRatios);
    this.responsiveSize = BootstrapGrid.validateResponsiveSize(responsiveSize);
  }

  static ResponsiveSize = {
    XS_SIZE: 'xs',
    SM_SIZE: 'sm',
    MD_SIZE: 'md',
  };

  static validateColsRatios(colsRatios) {
    if (colsRatios.length < 2 || colsRatios.length > 4) {
      throw new Error('Incorrect array length of cols ratios');
    }
    const ratiosTotal = colsRatios.reduce((total, ratio) => {
      return total + ratio;
    }, 0);
    if (ratiosTotal !== 12) {
      throw new Error('Incorrect cols ratios value');
    }

    return colsRatios;
  }

  static validateResponsiveSize(responsiveSize) {
    if (
      responsiveSize === BootstrapGrid.ResponsiveSize.XS_SIZE ||
      responsiveSize === BootstrapGrid.ResponsiveSize.SM_SIZE ||
      responsiveSize === BootstrapGrid.ResponsiveSize.MD_SIZE
    ) {
      return responsiveSize;
    }
    throw new Error('Incorrect responsive size');
  }
}
