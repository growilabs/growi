/**
 * @typedef {import('../../types').MigrationModule} MigrationModule
 */

// Script for migrating from Bootstrap4 to Bootstrap5 syntax
// Inspired by https://github.com/coliff/bootstrap-5-migrate-tool/blob/main/gulpfile.js

module.exports = [
  /**
   * @type {MigrationModule}
   */
  (body) => {
    let replacedBody = body;

    replacedBody = replacedBody.replace(
      /\sdata-(animation|autohide|boundary|container|content|custom-class|delay|dismiss|display|html|interval|keyboard|method|offset|pause|placement|popper-config|reference|ride|selector|slide(-to)?|target|template|title|toggle|touch|trigger|wrap)=/g,
      (match, p1) => {
        if (p1 === 'toggle' && match.includes('data-bs-toggle="')) {
          return match;
        }
        return ` data-bs-${p1}=`;
      },
    );

    replacedBody = replacedBody.replace(/\[data-toggle=/g, '[data-bs-toggle=');

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-danger\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-danger${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-dark\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-dark${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-info\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-info${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-light\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-light${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-pill\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-pill${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-primary\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-primary${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-secondary\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-secondary${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-success\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-success${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bbadge-warning\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-bg-warning${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bborder-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}border-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bborder-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}border-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bclose\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}btn-close${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-control-input\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-check-input${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-control-label\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-check-label${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-control custom-checkbox\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-check${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-control custom-radio\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-check${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-file-input\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-control${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-file-label\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-label${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-range\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-range${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-select-sm\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-select-sm${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-select-lg\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-select-lg${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-select\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-select${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bcustom-control custom-switch\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-check form-switch${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-sm-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-sm-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-md-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-md-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-lg-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-lg-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-xl-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-xl-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-sm-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-sm-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-md-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-md-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-lg-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-lg-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropdown-menu-xl-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropdown-menu-xl-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropleft\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropstart${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bdropright\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}dropend${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-sm-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-sm-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-md-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-md-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-lg-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-lg-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-xl-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-xl-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-sm-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-sm-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-md-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-md-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-lg-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-lg-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfloat-xl-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}float-xl-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-italic\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fst-italic${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-weight-bold\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fw-bold${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-weight-bolder\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fw-bolder${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-weight-light\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fw-light${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-weight-lighter\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fw-lighter${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bfont-weight-normal\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}fw-normal${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bform-control-file\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-control${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bform-control-range\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}form-range${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bform-group\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}mb-3${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bform-inline\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}d-flex align-items-center${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bform-row\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}row${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bjumbotron-fluid\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-0 px-0${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bjumbotron\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}bg-light mb-4 rounded-2 py-5 px-3${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bmedia-body\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}flex-grow-1${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bmedia\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}d-flex${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bml-\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ms-${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bml-n\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ms-n${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bmr-\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}me-${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bmr-n\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}me-n${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bno-gutters\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}g-0${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bpl-\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ps-${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bpr-\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}pe-${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bpre-scrollable\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}overflow-y-scroll${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive-item\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive-16by9\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ratio-16x9${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive-1by1\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ratio-1x1${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive-21by9\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ratio-21x9${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive-4by3\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ratio-4x3${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bembed-responsive\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}ratio${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\brounded-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\brounded-lg\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-3${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\brounded-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\brounded-sm\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}rounded-1${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bsr-only-focusable\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}visually-hidden-focusable${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\bsr-only\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}visually-hidden${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-hide\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}d-none${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-sm-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-sm-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-md-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-md-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-lg-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-lg-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-xl-left\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-xl-start${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-sm-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-sm-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-md-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-md-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-lg-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-lg-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-xl-right\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}text-xl-end${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /(<[^>]*class\s*=\s*['"][^'"]*)\btext-monospace\b([^'"]*['"])/g,
      (_, p1, p2) => {
        return `${p1}font-monospace${p2}`;
      },
    );

    replacedBody = replacedBody.replace(
      /<select([^>]*)\bclass=['"]([^'"]*)form-control(-lg|-sm)?([^'"]*)['"]([^>]*)>/g, '<select$1class="$2form-select$3$4"$5>',
    );

    replacedBody = replacedBody.replace(/<select([^>]*)\bclass=['"]([^'"]*)form-control\b([^'"]*['"])/g, '<select$1class="$2form-select$3');

    replacedBody = replacedBody.replace('<span aria-hidden="true">&times;</span>', '');

    return replacedBody;
  },
];
