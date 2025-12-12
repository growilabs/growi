/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      User:
 *        description: User
 *        type: object
 *        properties:
 *          __v:
 *            type: number
 *            description: record version
 *            example: 0
 *          _id:
 *            type: string
 *            description: user ID
 *            example: 5ae5fccfc5577b0004dbd8ab
 *          lang:
 *            type: string
 *            description: language
 *            example: 'en_US'
 *          status:
 *            type: integer
 *            description: status
 *            example: 0
 *          admin:
 *            type: boolean
 *            description: whether the admin
 *            example: false
 *          email:
 *            type: string
 *            description: E-Mail address
 *            example: alice@aaa.aaa
 *          username:
 *            type: string
 *            description: username
 *            example: alice
 *          name:
 *            type: string
 *            description: full name
 *            example: Alice
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const User = crowi.model('User');
  const ApiResponse = require('../util/apiResponse');

  const actions = {};

  const api = {};

  actions.api = api;

  api.checkUsername = async (req, res) => {
    const username = req.query.username;

    let valid = false;
    await User.findUserByUsername(username)
      .then((userData) => {
        if (userData) {
          valid = false;
        } else {
          valid = true;
        }
      })
      .catch((err) => {
        valid = false;
      });
    return res.json(ApiResponse.success({ valid }));
  };

  return actions;
};
