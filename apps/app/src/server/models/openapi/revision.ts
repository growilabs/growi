/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      RevisionBody:
 *        description: Revision content body
 *        type: string
 *        example: |
 *          # Header
 *
 *          - foo
 *          - bar
 *
 *      Revision:
 *        description: Revision
 *        type: object
 *        properties:
 *          _id:
 *            $ref: '#/components/schemas/ObjectId'
 *          __v:
 *            type: number
 *            description: DB record version
 *            example: 0
 *          author:
 *            $ref: '#/components/schemas/ObjectId'
 *          body:
 *            $ref: '#/components/schemas/RevisionBody'
 *          format:
 *            type: string
 *            description: format
 *            example: markdown
 *          path:
 *            type: string
 *            description: path
 *            example: /user/alice/test
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 */
