/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      Tags:
 *        description: Tags
 *        type: array
 *        items:
 *          $ref: '#/components/schemas/TagName'
 *        example: ['daily', 'report', 'tips']
 *
 *      TagName:
 *        description: Tag name
 *        type: string
 *        example: daily
 *
 *      Tag:
 *        description: Tag
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: tag ID
 *            example: 5e2d6aede35da4004ef7e0b7
 *          name:
 *            $ref: '#/components/schemas/TagName'
 *          count:
 *            type: number
 *            description: Count of tagged pages
 *            example: 3
 */
