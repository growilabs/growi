# Requirements Document

## Project Description (Input)
A specification document for the long-term maintenance of the group selection UI (GrantSelector) used when setting page visibility to "group-limited".

## Introduction
In the GROWI editor, when page visibility is set to "group-limited", the group selection UI (GrantSelector) is displayed. This component presents a list of groups the user directly belongs to and allows them to select which groups to grant access to.

This spec serves as an ongoing maintenance document for the group selection UI. Each Feature section describes individual features and improvements, managing their requirements and acceptance criteria.

GROWI has two types of groups: manually managed UserGroups and ExternalUserGroups synchronized via external IdPs (LDAP/SAML, etc.), and GrantSelector handles both.

## Boundary Context
- **In scope**:
  - All features related to the group selection UI (GrantSelector) used when setting page visibility to "group-limited"
  - UserGroups and ExternalUserGroups that the logged-in user directly belongs to
  - Management of selection state and reflection of selected groups into grants
- **Out of scope**:
  - Group selection UIs other than GrantSelector (e.g., FixPageGrantModal for fixing grant inconsistencies)
  - Creation, editing, or deletion of groups (group management is owned by the existing admin features)
  - Adding admin settings to enable/disable individual features described in this spec
- **Adjacent expectations**:
  - This spec relies on existing group membership data (UserGroupRelation / ExternalUserGroupRelation) and does not modify those membership relationships.
  - Operates within the scope consistent with the group list retrieval logic (`/api/v3/page/grant-data`) displayed by GrantSelector.

---

## Feature 1: Group Member Visibility

Allow general users to view the members of each group in the group selection UI. Currently, the member list of a group is only viewable in admin features, and general members cannot see who else belongs to the same group. This feature allows general logged-in users to view the members of their own groups.

### Requirement 1: Viewing the Member List in the Group Selection UI
**Objective:** As a general logged-in user who belongs to a group, I want to see the members of each group when selecting a group to limit page visibility, so that I can decide which group to grant access to based on its member composition.

#### Acceptance Criteria
1. When a logged-in user displays the list of group options in GrantSelector, the GROWI shall present a list of members belonging to each of the user's own groups shown as options.
2. The GROWI shall display the name and username of each presented member.
3. The GROWI shall present member lists for both UserGroup and ExternalUserGroup memberships.
4. While a group has no members other than the user themselves, the GROWI shall present the result in a way that makes it clear the group has no other members (only the user themselves).

### Requirement 2: Scope of Members Displayed
**Objective:** As a general logged-in user, I want to only view members of groups I directly belong to, so that the display scope is predictable and information from unrelated groups is not mixed in.

#### Acceptance Criteria
1. The GROWI shall only target groups where the user is directly registered as a member for member viewing.
2. While a target group has a parent-child hierarchy, the GROWI shall not include members of parent groups or descendant groups in the list.
3. The GROWI shall include only active (enabled) users in the member list, excluding deactivated users.

### Requirement 3: Access Control and Privacy
**Objective:** As a user, I want to only be able to view members of groups I belong to and not be able to view members of unrelated groups, so that member information is shared only within the minimum necessary scope.

#### Acceptance Criteria
1. If the member viewing feature is accessed without being logged in, then the GROWI shall deny access.
2. If a logged-in user requests the member list of a group they do not belong to, then the GROWI shall not return the member information for that group.
3. The GROWI shall provide the member viewing feature to general logged-in users who do not have admin privileges.
4. The GROWI shall not expose information other than the name and username of each member (email, biography, profile image, etc.).
5. The GROWI shall provide this feature at all times without requiring additional activation settings.
