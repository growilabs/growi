// The value signed during pairing step 5 (the ownership confirmation).
//
// See design.md "⑤ で署名する値 -- `challenge` そのものに署名してはいけない".

/**
 * Composes the string pairing step 5 signs.
 *
 * **A purpose prefix is always concatenated; the received `challenge` is
 * never signed on its own.** Step 5 is an unsigned endpoint -- no keys exist
 * yet at that point in the procedure -- that answers with a signature made by
 * the SAME private key which later signs production requests. Signing the
 * `challenge` verbatim would therefore turn it into a window that signs any
 * string of the caller's choosing: whoever saw the registration code could
 * submit the RFC 9421 signature base of a forged production request as the
 * `challenge` and put the answer straight onto a `Signature` header
 * (Requirement 9.2, 9.6, 10.1).
 *
 * The prefix closes that: the result can never take the shape of a signature
 * base, whose every line begins with a quoted component identifier
 * (`"@method": ...`). That is what makes it safe for step 5 to answer any
 * `challenge` for as long as the pending registration code lives.
 *
 * The `:` separator between `registrationCode` and `challenge` is unambiguous
 * because `registrationCode` never contains one: proxy issues it as a random
 * value and only answers when it matches a pending-registration row it holds
 * itself, so an attacker can't choose or influence its content. `challenge`
 * itself is base64url per the `OwnershipChallenge` contract, but that shape
 * is enforced by the receiving endpoint (not yet implemented as of this
 * task), not by this function -- the separator's safety does not depend on
 * it.
 *
 * **Built ONLY out of values both sides already hold as identical strings.**
 * `proxyUri` is deliberately absent: GROWI's copy is whatever an admin typed
 * into a form field and the proxy's copy is its own configuration value, so
 * they come from DIFFERENT sources, and a one-character disagreement -- a
 * trailing slash, letter case, an explicit ":443" -- would make the signature
 * never match and an otherwise ordinary deployment (behind a reverse proxy,
 * say) would never be able to pair even once. The failure would surface only
 * as `ownership-unverified`, so an operator would suspect reachability rather
 * than URL formatting and never find the cause. This is the same judgement
 * made for the request signature, which covers neither the target URL nor the
 * path.
 *
 * Leaving it out is still sufficient. Separating this use from production
 * signing is the prefix's job, and binding the value to THIS ONE pairing
 * attempt is `registrationCode`'s: a >=128-bit random value the proxy issues
 * itself and receives back at step 4. A second proxy never holds a
 * registration code it did not issue, so passing a challenge between two
 * proxies is closed off as well.
 */
export const pairingChallengePayload = (
  registrationCode: string,
  challenge: string,
): string => `growi-chat-pairing-challenge:v1:${registrationCode}:${challenge}`;
