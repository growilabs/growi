/**
 * fileUploader
 */

module.exports = function(crowi) {
  'use strict';

  var debug = require('@alias/debug')('growi:lib:fileUploader')
    , method = crowi.env.FILE_UPLOAD || 'aws'
    , lib = '../../local_modules/crowi-fileupload-' + method;

  return require(lib)(crowi);
};
