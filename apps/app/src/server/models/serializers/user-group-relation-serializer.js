import { serializeUserSecurely } from '@growi/core/dist/models/serializers';

function serializeInsecureUserAttributes(userGroupRelation) {
  if (
    userGroupRelation.relatedUser != null &&
    userGroupRelation.relatedUser._id != null
  ) {
    userGroupRelation.relatedUser = serializeUserSecurely(
      userGroupRelation.relatedUser,
    );
  }
  return userGroupRelation;
}

export function serializeUserGroupRelationSecurely(userGroupRelation) {
  let serialized = userGroupRelation;

  // invoke toObject if page is a model instance
  if (userGroupRelation.toObject != null) {
    serialized = userGroupRelation.toObject();
  }

  serializeInsecureUserAttributes(serialized);

  return serialized;
}
