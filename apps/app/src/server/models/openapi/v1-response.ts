/**
 * @swagger
 *
 *  components:
 *    schemas:
 *
 *      # Common API Response Schemas (modern pattern)
 *      ApiResponseBase:
 *        type: object
 *        required:
 *          - ok
 *        properties:
 *          ok:
 *            type: boolean
 *            description: Indicates if the request was successful
 *
 *      ApiResponseSuccess:
 *        description: Successful API response
 *        allOf:
 *          - $ref: '#/components/schemas/ApiResponseBase'
 *          - type: object
 *            properties:
 *              ok:
 *                type: boolean
 *                enum: [true]
 *                example: true
 *                description: Success indicator (always true for successful responses)
 *
 *      ApiResponseError:
 *        description: Error API response
 *        allOf:
 *          - $ref: '#/components/schemas/ApiResponseBase'
 *          - type: object
 *            properties:
 *              ok:
 *                type: boolean
 *                enum: [false]
 *                example: false
 *                description: Success indicator (always false for error responses)
 *              error:
 *                oneOf:
 *                  - type: string
 *                    description: Simple error message
 *                    example: "Invalid parameter"
 *                  - type: object
 *                    description: Detailed error object
 *                    example: { "code": "VALIDATION_ERROR", "message": "Field validation failed" }
 *                description: Error message or error object containing details about the failure
 *
 *    responses:
 *      # Common error responses
 *      BadRequest:
 *        description: Bad request
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ApiResponseError'
 *            examples:
 *              missingParameter:
 *                summary: Missing required parameter
 *                value:
 *                  ok: false
 *                  error: "Invalid parameter"
 *              validationError:
 *                summary: Validation error
 *                value:
 *                  ok: false
 *                  error: "Validation failed"
 *
 *      Forbidden:
 *        description: Forbidden - insufficient permissions
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ApiResponseError'
 *            example:
 *              ok: false
 *              error: "Access denied"
 *
 *      NotFound:
 *        description: Resource not found
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ApiResponseError'
 *            examples:
 *              resourceNotFound:
 *                summary: Resource not found
 *                value:
 *                  ok: false
 *                  error: "Resource not found"
 *              notFoundOrForbidden:
 *                summary: Resource not found or forbidden
 *                value:
 *                  ok: false
 *                  error: "notfound_or_forbidden"
 *
 *      Conflict:
 *        description: Conflict
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ApiResponseError'
 *            examples:
 *              resourceConflict:
 *                summary: Resource conflict
 *                value:
 *                  ok: false
 *                  error: "Resource conflict"
 *              outdated:
 *                summary: Resource was updated by someone else
 *                value:
 *                  ok: false
 *                  error: "outdated"
 *              alreadyExists:
 *                summary: Resource already exists
 *                value:
 *                  ok: false
 *                  error: "already_exists"
 *
 *      InternalServerError:
 *        description: Internal server error
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ApiResponseError'
 *            example:
 *              ok: false
 *              error: "Internal server error"
 *
 */
