// `Relation` is the shape the db repository layer (`db/repositories/relation-repository.ts`,
// added in a later task) returns for one proxy<->GROWI pairing. It lives in
// `types/` rather than `relation/` (see design.md's File Structure Plan /
// Allowed Dependencies): `db/` sits to the left of `relation/` in the
// declared dependency order (`types -> capabilities -> db -> platform ->
// command -> relation -> growi -> orchestration -> routes`), so a type `db`
// needs to return cannot live in a layer `db` is not allowed to import from.
//
// Fields mirror the `relation` table's columns exactly (design.md's Data
// Models section): `id`, `installation_id`, `growi_uri`, `growi_label`,
// `search_weight`, `settings_version`, `created_at`.
export interface Relation {
  readonly relationId: string;
  readonly installationId: string;
  readonly growiUri: string;
  readonly growiLabel: string;
  readonly searchWeight: number;
  readonly settingsVersion: number;
  readonly createdAt: Date;
}
