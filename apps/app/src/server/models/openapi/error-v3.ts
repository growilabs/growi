// The jsdoc below is left here intentionally to be referenced by swagger's $ref in a file under src/server/routes/apiv3/**/*.js such as healthcheck.js
// The actual ErrorV3 Class is moved to packages/core/models/vo/error-v3.js

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      ErrorV3:
 *        description: Error for APIv3
 *        type: object
 *        properties:
 *          message:
 *            type: string
 *            example: 'error message'
 *          code:
 *            type: string
 *            example: 'someapi-error-with-something'
 *          stack:
 *            type: object
 *          args:
 *            type: object
 *            example: { name: 'Josh', age: 20 }
 */

export {};
