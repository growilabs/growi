# Requirements Document

## Introduction

GROWI's API authentication accepts an access token only as a Bearer token in the
`Authorization` header or as an `access_token` query/body parameter. When the
`Authorization` header is already consumed (for example, Basic authentication on a
reverse proxy), callers must fall back to the query parameter, which leaks the token into
URLs, server logs, browser history, and referrers.

This feature adds a dedicated request header, `X-GROWI-ACCESS-TOKEN`, as an additional
token source for the Access Token Parser, covering both the scope-based access-token path
and the legacy api-token path, and advertises it in the OpenAPI definitions. It also
establishes this spec as the cc-sdd maintenance baseline for the Access Token Parser
middleware. The salvage source is upstream PR #10443.

## Boundary Context

- **In scope**:
  - Accepting the access token from the `X-GROWI-ACCESS-TOKEN` request header for both
    the scope-based access-token path and the legacy api-token path.
  - The priority of the header source relative to the existing Bearer, query, and body
    sources.
  - Declaring an `accessTokenHeaderAuth` security scheme in the apiv1 and apiv3 OpenAPI
    definitions and applying it to the routes that already advertise the Bearer and
    query token methods.
- **Out of scope**:
  - Changing the scope-evaluation model, the access-token storage model, or the legacy
    api-token mechanism.
  - Removing or deprecating the existing Bearer, query, or body token sources.
  - Client/SDK changes or documentation-site updates beyond the in-repo OpenAPI
    definitions.
- **Adjacent expectations**:
  - Authorization decisions (scope sufficiency, read-only restriction, token validity)
    remain owned by the existing access-token validation; this feature only adds a new
    place to read the token from and does not relax those checks.
  - Downstream route authorization continues to reject unauthenticated requests; the
    parser only attaches the authenticated user when a valid token is found.

## Requirements

### Requirement 1: Header token acceptance on the scope-based access-token path

**Objective:** As an API caller whose `Authorization` header is already in use, I want to
supply my scoped access token in the `X-GROWI-ACCESS-TOKEN` header, so that I can
authenticate without exposing the token in the URL.

#### Acceptance Criteria
1. When a request carries a valid scoped access token in the `X-GROWI-ACCESS-TOKEN`
   header and no Bearer token is present, the Access Token Parser shall authenticate the
   request as the token's owner.
2. When the access token supplied in the `X-GROWI-ACCESS-TOKEN` header grants a scope that
   satisfies the route's required scope, the Access Token Parser shall attach the
   authenticated user to the request.
3. The Access Token Parser shall treat the `X-GROWI-ACCESS-TOKEN` header name
   case-insensitively, accepting it regardless of the letter casing used by the client.

### Requirement 2: Header token acceptance on the legacy api-token path

**Objective:** As an API caller using a legacy api-token on a route that still accepts it,
I want to supply that token in the `X-GROWI-ACCESS-TOKEN` header, so that I get the same
header-based option as scoped tokens.

#### Acceptance Criteria
1. Where a route enables legacy api-token acceptance, when a request carries a valid
   legacy api-token in the `X-GROWI-ACCESS-TOKEN` header and no Bearer token is present,
   the Access Token Parser shall authenticate the request as the token's owner.
2. Where a route does not enable legacy api-token acceptance, the Access Token Parser
   shall not authenticate a request solely on the basis of a legacy api-token presented
   in the `X-GROWI-ACCESS-TOKEN` header.

### Requirement 3: Token source priority and non-regression of existing sources

**Objective:** As an API caller, I want predictable precedence among the token sources, so
that adding the header does not change the behavior of requests that already work.

#### Acceptance Criteria
1. When a request carries both a Bearer token in the `Authorization` header and a token in
   the `X-GROWI-ACCESS-TOKEN` header, the Access Token Parser shall use the Bearer token.
2. When a request carries a token in the `X-GROWI-ACCESS-TOKEN` header and also in the
   `access_token` query or body parameter, and no Bearer token is present, the Access
   Token Parser shall use the `X-GROWI-ACCESS-TOKEN` header value.
3. When a request carries no `X-GROWI-ACCESS-TOKEN` header, the Access Token Parser shall
   continue to resolve the token from the Bearer, query, and body sources exactly as
   before this feature.
4. If the `X-GROWI-ACCESS-TOKEN` header is present but is not a single string value, the
   Access Token Parser shall ignore it and fall back to the remaining token sources.

### Requirement 4: Invalid or insufficient header token handling

**Objective:** As a security-conscious operator, I want header-supplied tokens to be held
to the same validation as other sources, so that the new header cannot bypass any check.

#### Acceptance Criteria
1. If the token supplied in the `X-GROWI-ACCESS-TOKEN` header is invalid, expired, or
   unknown, the Access Token Parser shall leave the request unauthenticated and allow
   downstream authorization to reject it.
2. If the scoped access token supplied in the `X-GROWI-ACCESS-TOKEN` header lacks a scope
   sufficient for the route, the Access Token Parser shall leave the request
   unauthenticated.
3. If the access token supplied in the `X-GROWI-ACCESS-TOKEN` header belongs to a
   read-only user on a path that rejects read-only users, the Access Token Parser shall
   leave the request unauthenticated.

### Requirement 5: OpenAPI advertisement of the header authentication method

**Objective:** As an API consumer reading the OpenAPI specification, I want the header
authentication method to be documented, so that I know `X-GROWI-ACCESS-TOKEN` is a
supported way to authenticate.

#### Acceptance Criteria
1. The apiv1 and apiv3 OpenAPI definitions shall declare an `accessTokenHeaderAuth`
   security scheme that authenticates via the `x-growi-access-token` request header.
2. Where a route already advertises the Bearer and query token methods, the OpenAPI
   definition shall also advertise the `accessTokenHeaderAuth` method for that route.
3. The OpenAPI definitions shall retain the existing `bearer` and `accessTokenInQuery`
   security methods alongside the new `accessTokenHeaderAuth` method.
