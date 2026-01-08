/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      PagePath:
 *        description: Page path
 *        type: string
 *        example: /path/to/page
 *      PageGrant:
 *        description: Grant for page
 *        type: number
 *        example: 1
 *      PageInfo:
 *        description: Basic page information
 *        type: object
 *        properties:
 *          isV5Compatible:
 *            type: boolean
 *            description: Whether the page is compatible with v5
 *          isEmpty:
 *            type: boolean
 *            description: Whether the page is empty
 *          isMovable:
 *            type: boolean
 *            description: Whether the page is movable
 *          isDeletable:
 *            type: boolean
 *            description: Whether the page is deletable
 *          isAbleToDeleteCompletely:
 *            type: boolean
 *            description: Whether the page is able to delete completely
 *          isRevertible:
 *            type: boolean
 *            description: Whether the page is revertible
 *      PageInfoForEntity:
 *        description: Page information for entity (extends IPageInfo)
 *        allOf:
 *          - $ref: '#/components/schemas/PageInfo'
 *          - type: object
 *            properties:
 *              bookmarkCount:
 *                type: number
 *                description: Number of bookmarks
 *              sumOfLikers:
 *                type: number
 *                description: Number of users who have liked the page
 *              likerIds:
 *                type: array
 *                items:
 *                  type: string
 *                description: Ids of users who have liked the page
 *                example: ["5e07345972560e001761fa63"]
 *              sumOfSeenUsers:
 *                type: number
 *                description: Number of users who have seen the page
 *              seenUserIds:
 *                type: array
 *                items:
 *                  type: string
 *                description: Ids of users who have seen the page
 *                example: ["5e07345972560e001761fa63"]
 *              contentAge:
 *                type: number
 *                description: Content age
 *              descendantCount:
 *                type: number
 *                description: Number of descendant pages
 *              commentCount:
 *                type: number
 *                description: Number of comments
 *      PageInfoForOperation:
 *        description: Page information for operation (extends IPageInfoForEntity)
 *        allOf:
 *          - $ref: '#/components/schemas/PageInfoForEntity'
 *          - type: object
 *            properties:
 *              isBookmarked:
 *                type: boolean
 *                description: Whether the page is bookmarked by the logged in user
 *              isLiked:
 *                type: boolean
 *                description: Whether the page is liked by the logged in user
 *              subscriptionStatus:
 *                type: string
 *                description: Subscription status
 *                enum:
 *                  - 'SUBSCRIBE'
 *                  - 'UNSUBSCRIBE'
 *      PageInfoForListing:
 *        description: Page information for listing (extends IPageInfoForEntity with revision short body)
 *        allOf:
 *          - $ref: '#/components/schemas/PageInfoForEntity'
 *          - type: object
 *            properties:
 *              revisionShortBody:
 *                type: string
 *                description: Short body of the revision
 *      PageInfoExt:
 *        description: Page information (union of all page info types)
 *        oneOf:
 *          - $ref: '#/components/schemas/PageInfo'
 *          - $ref: '#/components/schemas/PageInfoForEntity'
 *          - $ref: '#/components/schemas/PageInfoForOperation'
 *          - $ref: '#/components/schemas/PageInfoForListing'
 *      Page:
 *        description: Page
 *        type: object
 *        properties:
 *          _id:
 *            $ref: '#/components/schemas/ObjectId'
 *          __v:
 *            type: number
 *            description: DB record version
 *            example: 0
 *          commentCount:
 *            type: number
 *            description: count of comments
 *            example: 3
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          creator:
 *            $ref: '#/components/schemas/User'
 *          extended:
 *            type: object
 *            description: extend data
 *            example: {}
 *          grant:
 *            $ref: '#/components/schemas/PageGrant'
 *          grantedUsers:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: ["5ae5fccfc5577b0004dbd8ab"]
 *          lastUpdateUser:
 *            $ref: '#/components/schemas/User'
 *          liker:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: []
 *          path:
 *            $ref: '#/components/schemas/PagePath'
 *          revision:
 *            type: string
 *            description: page revision
 *          seenUsers:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: ["5ae5fccfc5577b0004dbd8ab"]
 *          status:
 *            type: string
 *            description: status
 *            enum:
 *              - 'wip'
 *              - 'published'
 *              - 'deleted'
 *              - 'deprecated'
 *            example: published
 *          updatedAt:
 *            type: string
 *            description: date updated at
 *            example: 2010-01-01T00:00:00.000Z
 */
