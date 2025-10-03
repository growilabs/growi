/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      PageForTreeItem:
 *        description: Page
 *        type: object
 *        properties:
 *          _id:
 *            $ref: '#/components/schemas/ObjectId'
 *          path:
 *            $ref: '#/components/schemas/PagePath'
 *          parent:
 *            $ref: '#/components/schemas/PagePath'
 *          grant:
 *            $ref: '#/components/schemas/PageGrant'
 *          lastUpdateUser:
 *            $ref: '#/components/schemas/User'
 *          descendantCount:
 *            type: number
 *          isEmpty:
 *           type: boolean
 *          wip:
 *            type: boolean
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          updatedAt:
 *            type: string
 *            description: date updated at
 *            example: 2010-01-01T00:00:00.000Z
 */
