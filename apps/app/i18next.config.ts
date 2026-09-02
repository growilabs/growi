import { defineConfig } from 'i18next-cli';

// i18next-cli configuration for apps/app.
//
// This spec (i18n-key-audit) only ever invokes the read-only `status`
// command (see Requirement 5 / design.md "Audit Orchestrator") — `extract`
// and `sync` are never run against this config, so translation files under
// `public/static/locales/**` are never rewritten by this tooling.
export default defineConfig({
  // Locale directory names as they exist under public/static/locales/.
  // en_US is the primary (source-of-truth) language.
  locales: ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'],

  extract: {
    // Source files scanned for t()-style key usage.
    input: ['src/**/*.{ts,tsx,js,jsx}'],

    // Existing resource files this config points at. `status` reads from
    // this location; it never writes here because extract/sync are not run.
    output: 'public/static/locales/{{language}}/{{namespace}}.json',

    // Exclude test files: they are not real key usage and would otherwise
    // pollute both the "used keys" set (from calling t() in test fixtures)
    // and the unused-key count.
    ignore: [
      'node_modules/**',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.integ.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
    ],

    // Keys whose final segment is built at runtime, so no static analysis can
    // see the concrete key. Each entry below was verified against its call site
    // (see tools/i18n-audit/task-1.2-findings.md, "Dynamic key patterns"):
    // the variable part comes from React state, a server config key, an API
    // payload or a `Record` iteration — never from a local constant that could
    // be folded. Without these, `status --unused` reports every concrete key
    // in the family as unused.
    //
    // Wildcard (`*`) vs. enumerated concrete keys — how to choose when adding
    // an entry:
    // - Use a wildcard only when the runtime segment's value set is not known
    //   exhaustively here, or may grow without this file being touched (a
    //   `SupportedAction` read back from stored documents, a scope id, a
    //   configured uploader type).
    // - Enumerate the concrete keys when the key family also contains *static*
    //   `t('…')` calls that share the same path prefix. A wildcard here only
    //   ever hides matching keys from the *unused-key* report (measured — a
    //   `preservePatterns` wildcard does not affect missing-key detection at
    //   all). Enumerating still keeps the unused-key blind spot down to
    //   exactly the keys that really are runtime-determined, so a static
    //   sibling's own unused/typo status stays visible.
    preservePatterns: [
      // DecorationTab.tsx:63,72,82 — `${i18nKey}.${currentStyle}_text`,
      // currentStyle is React state over the BOOTSTRAP_STYLES union
      // (DecorationTab.tsx:19-26). Enumerated, not `*_text`: the same prefix
      // also carries the static call `.alert_with_custom_title_text`
      // (DecorationTab.tsx:82), which must stay visible to the audit.
      'editor_guide.decoration.primary_text',
      'editor_guide.decoration.secondary_text',
      'editor_guide.decoration.info_text',
      'editor_guide.decoration.success_text',
      'editor_guide.decoration.warning_text',
      'editor_guide.decoration.danger_text',
      // DecorationTab.tsx:206 — `${i18nKey}.docs_${key}`, key iterates a map.
      'editor_guide.decoration.docs_*',
      // saml.ts:197 / SamlSecuritySettingContents.tsx:188 — the segment is a
      // SAML config key with the `security:passport-saml:` prefix stripped, so
      // the value set is exactly `mandatoryConfigKeysForSaml`
      // (server/service/passport.ts:111-118). Enumerated, not `*`: the same
      // prefix also carries static calls (`.attrMapFirstName`,
      // `.attrMapLastName`, `.ABLCRule`, and — today — every one of the six
      // below), which must stay visible to the audit. These six are currently
      // referenced statically as well (SamlSecuritySettingContents.tsx:216,
      // 246, 276, 345, 377, 416) — without the `admin:` prefix, which the CLI
      // still resolves to admin.json. Measured: removing these six entries
      // altogether leaves `status --unused` at 1992 with no form_item_name key
      // reported, so they suppress nothing today. They stay as an explicit
      // declaration of the runtime call site, because a UI refactor could drop
      // those table rows while saml.ts keeps resolving the keys at runtime.
      'admin:security_settings.form_item_name.entryPoint',
      'admin:security_settings.form_item_name.issuer',
      'admin:security_settings.form_item_name.cert',
      'admin:security_settings.form_item_name.attrMapId',
      'admin:security_settings.form_item_name.attrMapUsername',
      'admin:security_settings.form_item_name.attrMapMail',
      // AuditLog components — the segment is a SupportedAction value read from
      // stored activity documents.
      'admin:audit_log_action.*',
      'admin:audit_log_action_category.*',
      // FileUploadSetting.tsx:132,143 / MailSetting.tsx:151 — the segment is the
      // configured uploader type / mail transmission method.
      'admin:app_setting.*_label',
      // CreateTemplateModal.tsx:28,34 — `target` is a prop.
      'template.*.label',
      'template.*.desc',
      // SortControl.tsx:41,57 — the segment is the active sort axis.
      'search_result.sort_axis.*',
      // OptionsSelector.tsx:255,452 — the segment is the stored paste mode, so
      // the value set is exactly `AllPasteMode`
      // (packages/editor/src/consts/paste-mode.ts). Enumerated, not `*`: the
      // same prefix also carries the static call `page_edit.paste.title`
      // (OptionsSelector.tsx:267,449), which must stay visible to the audit.
      'page_edit.paste.both',
      'page_edit.paste.text',
      'page_edit.paste.file',
      // use-input-validator.ts:51 — the segment is the validation target.
      'input_validation.target.*',
      // IncompleteResponseNotice.tsx:36 — the segment comes from the AI reply.
      'ai_sidebar.incomplete.*',
      // AccessTokenScopeList.tsx:92 — the segment is a scope id with ':'
      // rewritten to '.' at runtime.
      'commons:accesstoken_scopes_desc.*',
    ],

    primaryLanguage: 'en_US',
    secondaryLanguages: ['ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'],
  },

  // `extract.preservePatterns` only keeps declared dynamic keys out of the
  // *unused* report; it does not affect the "used in code but absent from
  // en_US" report (measured — see tools/i18n-audit/task-1.2-findings.md).
  // Requirement 4.2 asks for both, so the same families are declared here.
  // Scope is deliberately narrow: only families where the CLI expands a
  // runtime-variable segment into concrete keys that do not (and should not)
  // exist in the resource files.
  // The same wildcard-vs-enumeration rule as `extract.preservePatterns` above
  // applies here, and matters more: a wildcard in `ignoreKeys` hides every key
  // matching it from the "used in code but absent from en_US" report, so a
  // static sibling that shares the prefix could later be renamed to a key that
  // does not exist and nothing would report it (Requirement 1 AC5).
  status: {
    ignoreKeys: [
      // DecorationTab.tsx:63,72,82 — `${i18nKey}.${currentStyle}_text`. The CLI
      // expands currentStyle over the BOOTSTRAP_STYLES union into six concrete
      // keys; none of them exist by design, because the call passes
      // `defaultValue: t('editor_guide.decoration.placeholder')`.
      // Enumerated, not `*_text`: `.alert_with_custom_title_text`
      // (DecorationTab.tsx:82) is a *static* call built from the local constant
      // `i18nKey`, so it is statically resolvable and must keep being checked.
      'editor_guide.decoration.primary_text',
      'editor_guide.decoration.secondary_text',
      'editor_guide.decoration.info_text',
      'editor_guide.decoration.success_text',
      'editor_guide.decoration.warning_text',
      'editor_guide.decoration.danger_text',
      // IdenticalPathPage.tsx:52 — `t('GROWI.5.0_new_schema')`. The key name
      // itself contains a literal `.` (it is one flat JSON key, not a nested
      // path); the CLI can only parse a dotted specifier as a hierarchy, so it
      // reports the flat key as absent. i18next resolves the literal key at
      // runtime with no such restriction — verified by loading en_US's
      // translation.json into a real i18next instance and calling
      // `.t('GROWI.5.0_new_schema')`, which returns "GROWI.5.0 new schema".
      'GROWI.5.0_new_schema',
      // PageStaleAlert.tsx:51 — `t('page_page.notice.stale', { count })`. The
      // CLI requires a `_one`/`_other` (i18next v4 plural) suffixed key to
      // exist for any `t(key, { count })` call. translation.json only has the
      // base `stale` (plus a `stale_plural`, an i18next v3-era key i18next v4
      // does not read) — no `_one`/`_other` variant exists by design. At
      // runtime, i18next v4 falls back to the base unsuffixed key when no
      // plural-suffixed variant is present, so `t()` still resolves — verified
      // by loading en_US's translation.json into a real i18next instance and
      // calling `.t('page_page.notice.stale', { count: 1 })` /
      // `{ count: 3 })`, both of which resolve (the English plural wording is
      // imperfect but that is a separate, already-tracked issue, not a missing
      // key).
      'page_page.notice.stale_one',
      'page_page.notice.stale_other',
      // ShareLink.tsx:32 / ShareLinkSetting.tsx:74 —
      // `t('toaster.remove_share_link', { count, ns: 'commons' })`. Same
      // plural-suffix situation as above: commons.json only has the base
      // `remove_share_link`, no `_one`/`_other` variant, and i18next v4 falls
      // back to the base key — verified by loading en_US's commons.json into a
      // real i18next instance and calling
      // `.t('toaster.remove_share_link', { count: 1, ns: 'commons' })` /
      // `{ count: 3, ns: 'commons' })`, both of which resolve.
      'toaster.remove_share_link_one',
      'toaster.remove_share_link_other',
    ],
  },
});
