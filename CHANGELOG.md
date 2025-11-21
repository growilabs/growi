# Changelog

## [Unreleased](https://github.com/growilabs/compare/v7.3.5...HEAD)

*Please do not manually update this file. We've automated the process.*

## [v7.3.5](https://github.com/growilabs/compare/v7.3.4...v7.3.5) - 2025-11-10

### 💎 Features

* feat: Activity Log on the user page for viewing recent activity (#10487) @arvid-e

### 🐛 Bug Fixes

* fix: PDF-converter major/minor tags not updated on release (#10476) @arafubeatbox

### 🧰 Maintenance

* support: Configure biome for app/src/server/models dir (#10419) @arafubeatbox
* support: Playwright tests biome migration (#10248) @arafubeatbox

## [v7.3.4](https://github.com/growilabs/compare/v7.3.3...v7.3.4) - 2025-11-04

### 🚀 Improvement

* imprv: Admin form text input (#10401) @yuki-takei

### 🐛 Bug Fixes

* fix: Enable profile picture uploads for read only users (#10454) @miya
* fix: CodeQL security issues: insecure randomness and unvalidated redirect (#10431) @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
* fix: CSRF protection by origin comparison (#10345) @yusa-bot

### 🧰 Maintenance

* support: Clean CSRF token storing hook (#10452) @yuki-takei
* ci(deps): bump validator from 13.12.0 to 13.15.20 (#10445) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps-dev): bump vite from 5.4.20 to 5.4.21 (#10432) @[dependabot[bot]](https://github.com/apps/dependabot)
* support: Configure biome for OpenAI feature client dir (#10422) @arafubeatbox
* support: Configure biome for small dirs in app/src/server (#10417) @arafubeatbox
* support: Configure biome for OpenAI feature exluding client dir (#10377) @arafubeatbox
* support: Configure biome for app services/stores dir (#10411) @arafubeatbox
* support: Configure biome for app pages dir (#10410) @arafubeatbox
* support: Configure biome for app components dir (#10382) @arafubeatbox
* support: Biome v2.2 and use noRestrictedImports instead of eslint(no-restricted-imports) (#10408) @yuki-takei
* support: Apply Biome and organize imports (#10406) @yuki-takei

## [v7.3.3](https://github.com/growilabs/compare/v7.3.2...v7.3.3) - 2025-10-15

### 💎 Features

* feat(otel): Page counts metrics (#10367) @Ryosei-Fukushima

### 🚀 Improvement

* imprv: Improve KnowledgeAssistant chat UI UX (#10355) @satof3
* imprv: Guest user client performance by Socket.io event optimization (#10379) @yuki-takei
* imprv: PageTree performance by page-listing API (#10362) @yuki-takei

### 🐛 Bug Fixes

* fix: Draw.io color mode (#10390) @miya
* fix: Cannot update v4 format pages (#10378) @miya
* fix: Bulk export cleanup and notification occasionally not working on job expire (#10366) @arafubeatbox

### 🧰 Maintenance

* support: Configure biome for app services dir (#10381) @arafubeatbox
* support: Configure biome for app etc. dirs (#10380) @arafubeatbox
* support: Configure biome for rate-limiter feature (#10376) @arafubeatbox
* support: Configure biome for growi-plugin feature (#10309) @arafubeatbox
* support: Service integration test biome migration (#10234) @arafubeatbox
* support: Update axios (#10353) @arafubeatbox

## [v7.3.2](https://github.com/growilabs/compare/v7.3.1...v7.3.2) - 2025-09-29

### 🚀 Improvement

* imprv: Elasticsearch management retrieving status (#10330) @yuki-takei

### 🐛 Bug Fixes

* fix: Ensure login errors display regardless of password login configuration (#10347) @yuki-takei
* fix: TreeItem opening logic (#10331) @yuki-takei

### 🧰 Maintenance

* support: Improve memory leak (#10329) @yuki-takei
* support: Fix biome errors (#10338) @yuki-takei

## [v7.3.1](https://github.com/growilabs/compare/v7.3.0...v7.3.1) - 2025-09-22

### 🧰 Maintenance

* support: Revert Node.js runtime version to v18/20 for memory consumption
* ci(deps-dev): bump vite from 5.4.19 to 5.4.20 (#10294) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump next from 14.2.30 to 14.2.32 (#10312) @[dependabot[bot]](https://github.com/apps/dependabot)

## [v7.3.0](https://github.com/growilabs/compare/v7.2.10...v7.3.0) - 2025-09-11

### 💎 Features

* feat: Eenhanced access token (#9824) @miya
* feat: Add shortcuts when editing (#9512) @WNomunomu

### 🚀 Improvement

* imprv(ai): Threads history (#10098) @miya
* imprv: New keyboard shortcut display modal (#10158) @satof3
* imprv: Set a longer value for the export interval of OpenTelemetry metrics (#10189) @yuki-takei
* imprv: Change pdf bulk export shared html path (#10174) @arafubeatbox
* imprv: Adjust pagetitle spacing (#10171) @satof3
* imprv: Add dark mode support to PlantUML rendering (#10147) @yuki-takei
* imprv: Add dark mode support to DrawioViewer component (#10141) @yuki-takei
* imprv: Add dark mode support to MermaidViewer component (#10139) @yuki-takei

### 🐛 Bug Fixes

* fix: Auto-scroll to anchor for page view (#10181) @Naoki427
* fix: Mermaid diagrams are not displayed when svg ids are duplicated (#10167) @miya
* fix: Page list preview is not displayed in guest mode (#10176) @miya
* fix: Tag <code> result in inline code blocks (#10165) @arvid-e
* fix: Put render error message on PagePresentationModal and console (#10152) @Naoki427
* fix: Remove appId from GROWI.cloud export path (#10213) @arafubeatbox
* fix: remove srcdoc from whitelist (#10200) @Naoki427
* fix: Add checking attachment file name and file size for g2g transformation (#10166) @Naoki427
* fix: Bug causing export zip file to display twice (#10128) @arvid-e
* fix(pdf-converter): Puppeteer not launching in pdf-converter (#10192) @arafubeatbox
* fix(admin): Validate invalid key in qiita importer (#10170) @Naoki427
* fix(admin): Cannot change file upload destination to "MongoDB (GridFS)" or "local" (#10118) @miya

### 🧰 Maintenance

* support: Remove questionnaire (#10185) @yuki-takei
* support: Node.JS 22 (#10140, #10149) @miya
* support: Elasticsearch v9 (#10127) @miya
* support: Bump mermaid to v11.9.0 (#10194) @yuki-takei
* support: Update biome to ver2 (#10142) @arafubeatbox
* support: Configure biome for slackbot-proxy services (#10206) @arafubeatbox
* support: Configure biome for slackbot-proxy (excluding services) (#10126) @arafubeatbox
* support: Configure biome for pdf-converter (#10125) @arafubeatbox
* ci(deps): bump form-data from 4.0.0 to 4.0.4 (#10177) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump myrotvorets/info-from-package-json-action from 2.0.1 to 2.0.2 (#9823) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump docker/metadata-action from 4 to 5 (#9821) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump peter-evans/dockerhub-description from 3 to 4 (#9822) @[dependabot[bot]](https://github.com/apps/dependabot)

## [v7.2.10](https://github.com/weseek/growi/compare/v7.2.9...v7.2.10) - 2025-08-20

### 🐛 Bug Fixes

* fix: Auto-scroll to anchor for page view (for v7.2.x) (#10241) @miya
* fix: OpenTelemetry metrics setup (#10219) @yuki-takei
* fix: Share link copy button couldn't be pressed (#10221) @yuki-takei
* fix: Mermaid diagrams are not displayed when svg ids are duplicated (for v7.2.x) (#10184) @miya

### 🧰 Maintenance

* support: Change OpenTelemetry configuration (#10218) @yuki-takei

## [v7.2.9](https://github.com/growilabs/growi/compare/v7.2.8...v7.2.9) - 2025-07-01

### 🚀 Improvement

* imprv(ai): Assistant instructions (#10129) @yuki-takei
* imprv: OpenTelemetry phase 2 (#10095) @yuki-takei
* imprv: Adjust margin-top for .main at md and lg breakpoints (#10131) @yuki-takei

### 🐛 Bug Fixes

* fix: Sharelink expiration date parsing when the date is cleared by the calendar UI (#10132) @yuki-takei
* fix: Cannot change file upload destination to "MongoDB (GridFS)" or "local" for dev/7.2.x (#10119) @miya

## [v7.2.8](https://github.com/growilabs/growi/compare/v7.2.7...v7.2.8) - 2025-06-26

### 💎 Features

* feat(ai): Send pre-message before main chat stream (#10089) @miya

### 🚀 Improvement

* imprv(ai): Add page content around the cursor position as context for editor assistant (#10106) @yuki-takei
* imprv(ai): Search and Replace strategy for Editor Assistant (#10093) @yuki-takei
* imprv(ai): Submit with Enter key (#10085) @yuki-takei
* imprv: Make axios response convert dates to type Date (#10064) @arvid-e
* imprv: OpenAPI Spec for GROWI API v1 (#10063) @yuki-takei

### 🐛 Bug Fixes

* fix: Unhandled exception in GlobalNotificationMailService (#10076) @yuki-takei
* fix: Prevent dropdown menu from hiding behind sidebar (#10103) @arvid-e
* fix(ai): Message gets sent when pressing Enter to confirm text conversion (#10094) @miya

### 🧰 Maintenance

* support: Configure biome for core package utils and models (#10082) @arafubeatbox
* support: Configure biome for pdf-converter-client package (#10077) @arafubeatbox
* support: Configure biome for core package biome (excluding utils and models) (#10078) @arafubeatbox
* support: Configure biome for pluginkit package (#10071) @arafubeatbox
* support: Configure biome for remark-attachment-refs package (#10054) @arafubeatbox
* support: Configure biome for presentation package (#10067) @arafubeatbox
* ci(deps): bump next from 14.2.26 to 14.2.30 (#10068) @[dependabot[bot]](https://github.com/apps/dependabot)

## [v7.2.7](https://github.com/growilabs/growi/compare/v7.2.6...v7.2.7) - 2025-06-11

### 🐛 Bug Fixes

* fix: Input values ​​in the admin settings form are sometimes not reflected (#10051) @yuki-takei
* fix: Hide Google OAuth client secret field (#10049) @yuki-takei
* fix: Prevent unnecessary API request when the user is guest (#10046) @yuki-takei
* fix(ai): Prevent unnecessary API request when GROWI AI is disabled (#10044) @yuki-takei

### 🧰 Maintenance

* support: Configure biome for preset-templates package (#10058) @arafubeatbox
* support: Configure biome for preset-themes package (#10055) @arafubeatbox
* support: Configure biome for remark-drawio package (#10033) @arafubeatbox

## [v7.2.6](https://github.com/growilabs/growi/compare/v7.2.5...v7.2.6) - 2025-06-10

### 💎 Features

* feat(ai): Display spinner while creating diff (#9991) @miya

### 🚀 Improvement

* imprv: Message card markdown header size (#10038) @miya
* imprv: Type safe configuration for file uploading (#10032) @yuki-takei
* imprv: EditorAssistant instruction (#10030) @miya
* imprv: Add NonEmptyString type (#10031) @yuki-takei
* imprv: Security settings search results redesign (#9992) @arvid-e
* imprv: OpenAPI spec properties ref (#10023) @yuki-takei
* imprv(ai): Make input form position sticky (#10002) @miya
* imprv: Prevent path traversal attack in pdf converter (#9993) @arafubeatbox
* imprv: Discard when form is submitted without Accept/Discard after showing diff (#9980) @miya

### 🐛 Bug Fixes

* imprv:  The delete button on the user home page is now hidden for unauthorized users. (#9915) @taikou-m
* fix: OpenAI threads can be retrieved regardless of assistant's public permissions (#9994) @miya
* fix: Editor assistant button is being displayed when ai functionality is not enabled (#9985) @miya
* fix: Improve attribute handling in Lsx (#9989) @yuki-takei

### 🧰 Maintenance

* support: OpenAPI operationId generation (#10009) @yuki-takei
* support: Configure biome for remark-growi-directive (#9999) @arafubeatbox

## [v7.2.5](https://github.com/growilabs/growi/compare/v7.2.4...v7.2.5) - 2025-05-28

### 💎 Features

* feat: Save attachment to VectorStore (#9906) @miya

### 🚀 Improvement

* imprv: Headers and CopyDropdown UX (#9973) @yuki-takei
* imprv(api): Support Bearer token (#9971) @yuki-takei
* imprv: Add orgId and appId to bulk export path (#9946) @arafubeatbox

### 🐛 Bug Fixes

* fix: Prevent submission during text composition in SearchTypeahead (#9977) @miya
* fix(ai): First user message is not displayed (#9976) @miya
* fix: Vectorstore file not rebuilt after page update (#9951) @miya

### 🧰 Maintenance

* ci(deps-dev): bump vite from 5.4.17 to 5.4.19 (#9911) @[dependabot[bot]](https://github.com/apps/dependabot)
* support: Prevent SSRF for slack integration (#9952) @yuki-takei
* support: Remark lsx package biome migration (#9948) @arafubeatbox
* support: UI package biome migration (#9945) @arafubeatbox
* support: Migrate linter/formatter to biome for @growi/slack package (#9917) @arafubeatbox

## [v7.2.4](https://github.com/growilabs/growi/compare/v7.2.3...v7.2.4) - 2025-05-15

### 🐛 Bug Fixes

* fix: Picture size (#9938) @yuki-takei

## [v7.2.3](https://github.com/growilabs/growi/compare/v7.2.2...v7.2.3) - 2025-05-14

### 💎 Features

* feat(ai): Unified merge view (#9643) @yuki-takei

### 🚀 Improvement

* imprv(ai): AI models and instructions (#9913) @yuki-takei
* imprv(ai): Evaluate article headers (#9921) @yuki-takei
* imprv(ai): Tidy up instructions (#9918) @yuki-takei
* imprv: Disable page bulk export when file upload settings are not configured (#9900) @arafubeatbox
* imprv: add contributors that has not been added to konami command (#9901) @Ryosei-Fukushima
* imprv(ai): AI models and instructions (#9913) @yuki-takei
* imprv: Hide summary mode switch in editor assistant mode (#9897) @miya
* imprv: User picture tooltip (#9892) @yuki-takei
* imprv: User picture tooltip (2) (#9898) @yuki-takei

### 🐛 Bug Fixes

* fix: PagePathHeader maxWidth for editor (#9930) @yuki-takei
* fix: Pages list API (#9928) @yuki-takei
* fix: Set OpenTelemetry resource attribute `service.instance.id` (#9902) @yuki-takei
* fix: User picture tooltip (2) (#9898) @yuki-takei
* fix: ConfigLoader.loadFromDB for JSON parsing error handling (#9890) @yuki-takei
* fix: Profile image upload functionality and accepted file types (#9886) @yuki-takei
* fix: Tooltip for UserPicture doesn't work (#9884) @yuki-takei

### 🧰 Maintenance

* support: Improve the official docker image size (#9874) @yuki-takei
* support: Upgrade openai package (#9909) @yuki-takei
* support(pdf-converter): Improve the official docker image size for pdf-converter (#9880) @yuki-takei
* support: Improve the official docker image size (#9874) @yuki-takei

## [v7.2.2](https://github.com/growilabs/growi/compare/v7.2.1...v7.2.2) - 2025-04-17

### 🐛 Bug Fixes

* fix: Export page API is broken (#9870) @yuki-takei

## [v7.2.1](https://github.com/growilabs/growi/compare/v7.2.0...v7.2.1) - 2025-04-16

### 💎 Features

* feat: Page bulk export (pdf export included) (#9678) @arafubeatbox

### 🚀 Improvement

* imprv: Add util method to get react instance of growi via growifacade (#9775) @NaokiHigashi28
* imprv: Adjust comment editor clickable area (#9840) @yuki-takei
* imprv: Make user activation middleware securely (#9818) @yuki-takei
* imprv: Prepare to upgrade React and Next.js (#9816) @yuki-takei

### 🐛 Bug Fixes

* fix: The order of multer middleware (#9772) @NaokiHigashi28
* fix: growi pluginkit growifacade typo (#9812) @NaokiHigashi28
* fix: Migration script to remove index for 'ns' from config collection (#9770) @yuki-takei
* fix: Assistant remains default when made unpublished (#9763) @miya
* fix: Fix layout when safari browse (#9744) @satof3
* fix:  Prevent GrowiPlugin from being downloaded outside the plugin directory (#9712) @NaokiHigashi28
* fix: The link for Telemetry of GROWI Docs (#9737) @yuki-takei

### 🧰 Maintenance

* ci(deps): bump next from 14.2.22 to 14.2.25 (#9761) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps-dev): bump vite from 5.4.16 to 5.4.17 (#9837) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps-dev): bump vite from 5.4.15 to 5.4.16 (#9830) @[dependabot[bot]](https://github.com/apps/dependabot)
* support: Upgrade Next.js (#9825) @yuki-takei
* support: Upgrade SWR (#9814) @yuki-takei
* ci(deps-dev): bump vite from 5.4.14 to 5.4.15 (#9781) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump dependabot/fetch-metadata from 1 to 2 (#9636) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump docker/build-push-action from 4 to 6 (#9638) @[dependabot[bot]](https://github.com/apps/dependabot)
* ci(deps): bump release-drafter/release-drafter from 5 to 6 (#9637) @[dependabot[bot]](https://github.com/apps/dependabot)

## [v7.2.0](https://github.com/growilabs/growi/compare/v7.1.9...v7.2.0) - 2025-03-11

### 💎 Features

* feat: GROWI AI Next Gen (#9492) @miya
* feat: Support OpenTelemetry (#8810) @yuki-takei
* feat: Add AuthorInfo display setting to PageSideContents (#9689) @satof3
* feat: Expose React Insance to window via GrowiFacade (#9729) @NaokiHigashi28
* feat: Normalize remark growi directives for v6.0.x or above (#9690) @yuki-takei

### 🚀 Improvement

* imprv: Fix RecentChanges dropdown label (#9711) @satof3
* imprv: Border color for dark mode (#9695) @satof3
* imprv: Update shortcut key modal (#9651) @satof3
* imprv: Suppresses unnecessary re-rendering within PageEditor (#9629) @reiji-h

### 🐛 Bug Fixes

* fix: Redirection after login does not work on systems with guest mode enabled (#9653) @reiji-h
* fix: Data migration script for CSV and TSV (#9641) @miya
* fix: Authenticate before uploading at /_api/v3/import/upload endpoint (#9647) @NaokiHigashi28
* fix: Add XSS filter to remark-attachment-refs /refs endpoint (#9631) @NaokiHigashi28
* fix: PageTree auto-scrolling sometimges not woking (#9544) @reiji-h
* fix: Middlewares about installation (#9616) @yuki-takei
* fix: Typo for bookmark API (#9613) @yuki-takei

### 🧰 Maintenance

* support: Upgrade runtime versions (#9655) @yuki-takei
* support: Display brand logo when editor mode (#9632) @satof3
* support: Upgrade CodeMirror (#9633) @yuki-takei
* ci(deps): bump docker/login-action from 2 to 3 (#8208) @dependabot
* ci(deps): bump google-github-actions/auth from 1 to 2 (#9557) @dependabot
* ci(deps): bump myrotvorets/info-from-package-json-action from 2.0.1 to 2.0.2 (#9558) @dependabot
* support: Remove legacy ConfigManager (#9624) @yuki-takei

## [v7.1.9](https://github.com/growilabs/growi/compare/v7.1.8...v7.1.9) - 2025-02-03

### 💎 Features

* feat: Add error handling for data migration (#9582) @miya

### 🚀 Improvement

* imprv: Data migration script performance (#9599) @miya
* imprv: Initialization for Passport strategies (#9353) @yuki-takei
* imprv: Make data migration type safe (#9590) @miya
* imprv: Printing styles (#9576) @yuki-takei

### 🐛 Bug Fixes

* fix: Serializing page data for share link (#9602) @yuki-takei

### 🧰 Maintenance

* ci(deps-dev): bump vite from 5.4.6 to 5.4.12 (#9574) @dependabot
* ci(deps): bump mongoose from 6.13.0 to 6.13.6 (#9570) @dependabot
* ci(deps): bump katex from 0.16.11 to 0.16.21 (#9564) @dependabot

## [v7.1.8](https://github.com/growilabs/growi/compare/v7.1.7...v7.1.8) - 2025-01-21

### 🐛 Bug Fixes

* fix: Escape page path when generating RegExp to find ancestors children (#9550) @yuki-takei

## [v7.1.7](https://github.com/growilabs/growi/compare/v7.1.6...v7.1.7) - 2025-01-16

### 🐛 Bug Fixes

* fix: Unable to select group viewing permissions (#9541) @miya
* fix: Fix i18n of oidc settings (#9536) @ryu-sato

### 🧰 Maintenance

* support: Update Swagger documentation for the PUT endpoint to update a page (#9529) @tkfm1991
* ci(deps): bump docker/metadata-action from 4 to 5 (#9181) @dependabot
* ci(deps): bump github/codeql-action from 2 to 3 (#9180) @dependabot
* ci(deps): bump next from 14.2.15 to 14.2.21 (#9538) @dependabot
* ci(deps-dev): bump @marp-team/marp-core from 3.9.0 to 3.9.1 (#9530) @dependabot

## [v7.1.6](https://github.com/growilabs/growi/compare/v7.1.5...v7.1.6) - 2024-12-26

### 💎 Features

* feat(ai): Save file to VectorStore in HTML format   (#9462) @miya

### 🐛 Bug Fixes

* fix: remark-lsx pagination (#9513) @miya
* fix: Spelling miss of external_link in i18n (#9456) @reiji-h
* fix: Wider copy to clipboard area (#9450) @Ryosei-Fukushima
* fix: Error when creating pages with deep hierarchy (#9487) @reiji-h

### 🧰 Maintenance

* ci(deps): bump next from 14.2.13 to 14.2.15 (#9501) @dependabot

## [v7.1.5](https://github.com/growilabs/growi/compare/v7.1.4...v7.1.5) - 2024-12-13

### 🚀 Improvement

* imprv: Slim down the sidebar scrollbar (#9430) @reiji-h

### 🐛 Bug Fixes

* fix: Usage for stream pipeline of callback version (#9455) @reiji-h
* fix: TypeError occurs during export (#9481) @miya
* fix: Put `/` before the page name (#9471) @Ryosei-Fukushima
* fix: Cannot comment when comments from rom user are allowed (#9472) @miya

## [v7.1.4](https://github.com/growilabs/growi/compare/v7.1.3...v7.1.4) - 2024-11-26

### 🐛 Bug Fixes

* fix: Failed to export the page markdown (#9444) @miya

## [v7.1.3](https://github.com/growilabs/growi/compare/v7.1.2...v7.1.3) - 2024-11-26

### 💎 Features

* feat(ai): Set a rate limit for vector store rebuild (#9404) @miya

### 🚀 Improvement

* imprv: Fonts preload settings (#9432) @yuki-takei
* imprv: Use stream.pipeline (#9361) @reiji-h

### 🐛 Bug Fixes

* fix: Retrieving runtime versions (#9438) @yuki-takei
* fix: Notification for new user creation (#9434) @yuki-takei
* fix:  Deleted pages appear in the page tree (#9337) @reiji-h

## [v7.1.2](https://github.com/growilabs/growi/compare/v7.1.1...v7.1.2) - 2024-11-18

### 🚀 Improvement

* imprv(ai): GROWI AI Knowledge Assistant instructions (#9407) @yuki-takei
* imprv(ai): Knowedge Assistant model configuration by env var (#9410) @yuki-takei
* imprv(ai): Shorten thread deletion expiredAt (#9419) @yuki-takei
* imprv(ai): Remove unnecessary strings from markdown when creating VectorStoreFIie (#9411) @miya
* imprv(ai): Create thead before the first post (#9414) @yuki-takei

### 🐛 Bug Fixes

* fix: Fixed the message when all read (#9405) @Ryosei-Fukushima

### 🧰 Maintenance

* support: Import OpenAI features dynamically (#9413) @yuki-takei
* support: Welcome back Hufflepuff badger (#9403) @satof3

## [v7.1.1](https://github.com/growilabs/growi/compare/v7.1.0...v7.1.1) - 2024-11-12

### 💎 Features

* feat(ai): Swtch summary mode (#9377) @yuki-takei
* feat: Return sources when generating responses (Knowledge assistant) (#9362) @miya
* feat: Set the maximum number of minutes until the request in an environment variable (#9347) @miya

### 🚀 Improvement

* imprv: GitHub Alert with directive syntax (#9392) @yuki-takei
* imprv: Sidebar button displays tooltip (#9371) @reiji-h
* imprv: Open the link of PageTreeItem in a new tab when the user middle click (#9365) @yuki-takei
* support: Avoid using req.t() (#9149) @shironegi39
* imprv: Tidy up /Sandbox (#9355) @yuki-takei
* imprv: Reduce sanitizing (#9350) @yuki-takei

### 🐛 Bug Fixes

* fix: Output TextDirective and LeafDirective HTML (#9388) @yuki-takei
* fix: NextLink isCreatablePage always returns false (#9356) @yuki-takei
* fix: Duplicate page names alert should not occur on a single page (#9348) @reiji-h
* fix: i18n for security settings (#9379) @yuki-takei
* fix: Output TextDirective and LeafDirective HTML (#9388) @yuki-takei
* fix(i18n): i18n for server side (#9372) @yuki-takei
* fix: Duplicate page names alert should not occur on a single page (#9348) @reiji-h
* fix: NextLink isCreatablePage always returns false (#9356) @yuki-takei

### 🧰 Maintenance

* support: Welcome back new Christmas theme (#9374) @satof3
* support: Type checking (#9393) @yuki-takei
* support: Welcome back new Christmas theme (#9374) @satof3
* support: Omit remark-toc (#9383) @yuki-takei
* support: Stop managing font files with Git LFS (#9351) @yuki-takei
* support: Avoid using req.t() (#9149) @shironegi39
* support: Improve playwright report (#9363) @yuki-takei
* support: Avoid using req.t() (#9149) @shironegi39
* support: Stop managing font files with Git LFS (#9351) @yuki-takei

## [v7.1.0](https://github.com/growilabs/growi/compare/v7.0.23...v7.1.0) - 2024-10-31

### BREAKING CHANGES

* imprv: Update default value for S3_OBJECT_ACL (#9332) @yuki-takei

### 💎 Features

* feat: GROWI OpenAI Integration (#9246) @yuki-takei

### 🚀 Improvement

* imprv: Add GitHub Markdown alerts  (#9127) @reiji-h
* imprv: Upgrade unified and remark-growi-directive (#9048) @reiji-h
* imprv: ROM users can manage comments (#9101) @WNomunomu
* imprv: Update default value for S3_OBJECT_ACL (#9332) @yuki-takei
* imprv: Sandbox (#9330) @yuki-takei
* support: JSDoc for OpenAPI document (#9311) @yuki-takei

### 🐛 Bug Fixes

* fix: Couldn't show old revision (#9296) @yuki-takei
* fix: Replace the word ROM (#9295) @satof3
* fix: forgot-password API (#9257) @reiji-h
* fix: Edit button appear for the side of header (#9270) @yuki-takei
* fix: Ensure text-only paste for mixed content from various sources (#9096) @reiji-h
* fix: Notification count badge (#9124) @shironegi39
* fix(ogp): Set an unknown label when the user is not found (#9232) @yuki-takei

### 🧰 Maintenance

* support: Migrate to pnpm from yarn v1 (#9249) @yuki-takei
* support: Omit MongoDB 4.x compatible code (#9334) @yuki-takei
* support: Pull LFS files with turbo (#9325) @yuki-takei
* support: Use `pnpm deploy` instead of `turbo prune` (#9323) @yuki-takei
* support: Maintenance API docs generation (#9302) @yuki-takei
* support: Improve typings for PageService (#9220) @yuki-takei
* support: Typescriptize accessTokenParser (#9320) @yuki-takei
* support: Migrate to pnpm from yarn v1 (#9249) @yuki-takei
* support: JSDoc for OpenAPI document (#9311) @yuki-takei
* support: Maintenance API docs generation (#9302) @yuki-takei
* support: Omit docs route (#9299) @yuki-takei

## [v7.0.23](https://github.com/growilabs/growi/compare/v7.0.22...v7.0.23) - 2024-10-24

### 🐛 Bug Fixes

* fix: Couln't show old revision (#9296) @yuki-takei

### 🧰 Maintenance

* support: Maintenance API docs generation (#9302) @yuki-takei
* support: Omit docs route (#9299) @yuki-takei

## [v7.0.22](https://github.com/growilabs/growi/compare/v7.0.21...v7.0.22) - 2024-10-21

### 🐛 Bug Fixes

* fix: Edit button appear for the side of header (#9270) @yuki-takei
* fix: Collaborative editing occurs unstable behavior (#9267) @yuki-takei

## [v7.0.21](https://github.com/growilabs/growi/compare/v7.0.20...v7.0.21) - 2024-10-15

### 🚀 Improvement

* imprv: Update Recent Changes when a page is created, updated, or deleted (#9092) @nHigashiWeseek
* imprv: Documentation URL for g2gtransfer (#9183) @moekumasaka

### 🐛 Bug Fixes

* fix: Add validators to lsx API (#9182) @WNomunomu
* fix: Display revisions only if they are not corrupted (#9099) @WNomunomu
* fix: Make it impossible to overwrite grants on descendant pages when 'anyone with the link' is selected. (#9125) @WNomunomu
* fix: Forgot password API - reject requests with invalid email format (#9179) @abichan99911111

### 🧰 Maintenance

* support: Upgrade codemirror and yjs packages (#9218) @yuki-takei

## [v7.0.20](https://github.com/growilabs/growi/compare/v7.0.19...v7.0.20) - 2024-09-25

### 🚀 Improvement

* imprv: The color of the dropdown list when it is activated (#9102) @WNomunomu
* imprv: PageTitleHeader max-width (#9166) @yuki-takei
* imprv: Documentation URL for g2gtransfer (#9157) @yuki-takei
* imprv: Corrected wording on admin page (/admin/data-transfer) (#9106) @miya
* imprv: Add hover-activated clipboard copy button with icon (#9095) @reiji-h

### 🐛 Bug Fixes

* fix: Make PageAccessoriesModal responsive (#9171) @moekumasaka
* fix: PageControls unexpectedly move in response to opening and closing the sidebar (#9094) @WNomunomu
* fix: Make CustomNavTab responsive (#9123) @moekumasaka

### 🧰 Maintenance

* ci(deps): bump rollup from 4.22.0 to 4.22.4 (#9160) @dependabot
* ci(deps): bump google-github-actions/setup-gcloud from 1 to 2 (#9153) @dependabot
* ci(deps): bump softprops/action-gh-release from 1 to 2 (#9152) @dependabot
* support: Improve vitest environment (#9144) @yuki-takei
* ci(deps): bump next from 14.1.3 to 14.2.13 (#9154) @dependabot
* support: Upgrade @testing-library/react (#9141) @yuki-takei
* support: Update logo image in README.md for the official docker image (#9139) @satof3
* ci(deps-dev): bump vite from 5.2.9 to 5.2.14 (#9134) @dependabot
* ci(deps): bump myrotvorets/info-from-package-json-action from 1.2.0 to 2.0.1 (#9129) @dependabot
* ci(deps): bump stefanzweifel/git-auto-commit-action from 4 to 5 (#9128) @dependabot
* ci(deps): bump nodemailer from 6.9.14 to 6.9.15 (#9075) @dependabot
* ci(deps): bump docker/setup-buildx-action from 2 to 3 (#8207) @dependabot
* ci(deps): bump jose from 4.11.4 to 4.15.9 (#9114) @dependabot
* ci(deps): bump express from 4.19.2 to 4.20.0 (#9110) @dependabot
* ci(deps): bump body-parser from 1.20.2 to 1.20.3 (#9109) @dependabot

## [v7.0.19](https://github.com/growilabs/growi/compare/v7.0.18...v7.0.19) - 2024-09-12

### 🐛 Bug Fixes

* fix: Shared page is not displayed when skipping SSR (#9089) @miya
* fix: The grant of pages can be changed via api even if restricted (#9087) @WNomunomu
* fix: Updated content is not reflected on the View screen even after refreshing the page (#9086) @miya
* fix: Removing comment doesn't work (#9083) @yuki-takei

## [v7.0.18](https://github.com/growilabs/growi/compare/v7.0.17...v7.0.18) - 2024-09-09

### 🚀 Improvement

* imprv: Prevent looping to update a hook for TrashPageAlert (#9066) @yuki-takei
* imprv: Display page tree in page select modal with scrollbar (#9023) @kazutoweseek

### 🐛 Bug Fixes

* fix: issue that material symbols icons are not displayed in ReplyComments component (#9076) @WNomunomu
* fix: Unable to navigate to the data transfer page (#9071) @miya
* fix: Page content does not update when switching revisions (#9072) @miya
* fix: Supress rendering too many invisible DropdownMenu components (#9073) @yuki-takei
* fix: Return error when grant is string for PUT /_api/v3/page (#9069) @arafubeatbox
* fix: Scrolling may not occurs when clicking on the edit button next to the header (#9043) @reiji-h
* fix: API v3 Page update (#9053) @maeshinshin
* fix: Input text becomes empty when opening the ReadOnlyEditor (#9059) @miya
* fix: Show pages with grants that are set to be visible in security settings on RecentChanges and PageTree as well (#9044) @miya

### 🧰 Maintenance

* support: Omit Cypress (#9065) @miya
* ci(deps): bump unzip-stream from 0.3.1 to 0.3.2 (#9049) @dependabot

## [v7.0.17](https://github.com/growilabs/growi/compare/v7.0.16...v7.0.17) - 2024-08-26

### 🚀 Improvement

* imprv: Serializers for User model and Attachment model (#9019) @yuki-takei
* imprv: translation modification (#9035) @maeshinshin
* imprv: Add UI and logic for disabled user registration (#9034) @maeshinshin
* imprv: lang attribute in Html element (#8960) @maeshinshin

### 🐛 Bug Fixes

* fix: Serializer for accessing to an empty page (#9042) @yuki-takei
* fix: Import data (#8994) @yuki-takei
* fix: Comment operation by API (#9026) @yuki-takei
* fix: Tests fail due to docker image and Playwright  version mismatch on CI (#9022) @miya
* fix: Use the scrollbar to prevent the toolbar from being hidden (#8976) @maeshinshin
* fix: Revision pageId schema type (#9008) @yuki-takei
* fix: Revision pageId schema type (add a changeset) (#9010) @yuki-takei
* fix: Hide WideViewMenuItem in search result (#9009) @yuki-takei
* fix: Wrongly autofocus to PageHeader even after updating (#9011) @yuki-takei

### 🧰 Maintenance

* support: Dark mode support for CountBadge (#9036) @satof3
* support: Update import lines (#9018) @yuki-takei
* support: Typescriptize REPL launcher (#9013) @yuki-takei

## [v7.0.16](https://github.com/growilabs/growi/compare/v7.0.15...v7.0.16) - 2024-07-31

### 💎 Features

* feat: Automatically repair corrupted data, at least for the latest revision (#9002) @yuki-takei

### 🚀 Improvement

* imprv: User group link in admin page (#8855) @kazutoweseek
* imprv: Sidebar header text size (#8986) @satof3
* imprv: Replace possition usericon (#8991) @satof3

### 🐛 Bug Fixes

* fix: Undo in the comment editor (#9005) @yuki-takei
* fix: Some OIDC authentication settings not being applied (#9000) @WNomunomu
* fix: font-family for monospace (#9004) @yuki-takei
* fix: Pointer cursor for the create button in the installer (#9003) @yuki-takei
* fix: Migration script (20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js) (#8998) @miya
* fix: Non-admin user gets 500 error when opening history modal (#9001) @miya
* fix: Enable page creation under GRANT_RESTRICTED pages (#8996) @arafubeatbox

## [v7.0.15](https://github.com/growilabs/growi/compare/v7.0.14...v7.0.15) - 2024-07-23

### 🐛 Bug Fixes

* fix: The $size query when aggregation to rebuild the index (#8987) @yuki-takei
* fix: Regaining lost backward compatibility for MongoDB 4.4 (#8985) @yuki-takei
* fix: Activate express-session middlewares for all sockets in SocketIoService (#8981) @yuki-takei

### 🧰 Maintenance

* support: Chage text size in sidebar (#8965) @satof3

## [v7.0.14](https://github.com/growilabs/growi/compare/v7.0.13...v7.0.14) - 2024-07-19

### 🐛 Bug Fixes

### 💎 Features

* feat: Alerts when trying to sync with latest revision when yjs data is corrupt (#8971) @miya

### 🚀 Improvement

* imprv: Restrict use of the editing UI from View if there is at least one user currently editing (#8966) @miya

### 🐛 Bug Fixes

* fix: Handle error when folding drawio blocks (#8977) @yuki-takei
* fix: Sync the editor text with the latest revision menu (1) (#8975) @yuki-takei
* fix: Sync the editor text with the latest revision menu (2) (#8978) @yuki-takei

### 🧰 Maintenance

* support: Normalize Revision.pageId (for #8954) (#8973) @miya

## [v7.0.13](https://github.com/growilabs/growi/compare/v7.0.12...v7.0.13) - 2024-07-16

### 💎 Features

* feat: Sync latest revision body to Yjs draft (#8939) @miya

### 🚀 Improvement

* imprv: Better synchronizing between YDoc and the latest revision (#8959) @yuki-takei

### 🐛 Bug Fixes

* fix: Revision model (#8967) @yuki-takei
* fix: Healthcheck with checkServices=mongo (#8961) @yuki-takei
* fix: Enable  # next to headline in view (#8826) @reiji-h

### 🧰 Maintenance

* ci(deps): bump nodemailer from 6.6.2 to 6.9.14 (#8928) @dependabot
* support: Update favicon (#8957) @satof3

## [v7.0.12](https://github.com/growilabs/growi/compare/v7.0.11...v7.0.12) - 2024-07-10

### 🚀 Improvement

* imprv: lang attribute in Html element to correctly reflect locale (#8940) @maeshinshin
* imprv: Archive importing and exporting (#8943) @yuki-takei
* imprv: Restrict indexing for full text search when the body length exceeds the threshold (#8937) @yuki-takei
* imprv: Dark theme support for emoji mart (#8936) @reiji-h
* imprv: Add env var for set Elasticsearch reindex bulk size (#8933) @yuki-takei
* imprv: Size for skeleton for tags (#8923) @yuki-takei
* imprv: Button opacity of TableWithEditButton and DrawioViewerWithEditButton (#8924) @yuki-takei

### 🐛 Bug Fixes

* fix: Initialize sanitize option (#8946) @yuki-takei
* fix: PageTitleHeader rename input status (#8944) @yuki-takei
* fix: Presentation section tag (#8941) @yuki-takei
* fix: Page history colorscheme is broken (#8938) @reiji-h
* imprv: Rename label for bookmark item (#8925) @yuki-takei

### 🧰 Maintenance

* support: Refactor Yjs service (#8949) @yuki-takei
* support: Upgrade y-mongodb-provider (#8953) @yuki-takei
* support: Typescriptize Revision model (#8954) @yuki-takei
* support: Typescriptize SocketIoService (#8948) @yuki-takei
* support: Update GROWI logo type in NoLogin (#8942) @satof3
* support: Update logo design (#8934) @satof3
* ci(deps): bump @azure/identity from 4.0.1 to 4.3.0 (#8927) @dependabot
* support: Upgrade vitest (#8920) @yuki-takei
* support: Upgrade playwright (#8921) @yuki-takei

## [v7.0.11](https://github.com/growilabs/growi/compare/v7.0.10...v7.0.11) - 2024-06-25

### 💎 Features

### 🚀 Improvement

* imprv: New marker color (#8891) @satof3
* imprv: SSR performance (#8916) @yuki-takei

### 🐛 Bug Fixes

* fix: Vim keymap works correctly (#8901) @reiji-h
* fix: Readonly editor prevents ctrl+v and paste. (#8902) @reiji-h
* fix: Missing HTTP Response in SAML Login With ABLC Callback (#8879) @maeshinshin
* fix: Set `z-0` to correct navbar and header overlap when the anchor is specified (#8905) @yuki-takei
* fix: Minimum number of characters in password cannot be changed (#8896) @miya

### 🧰 Maintenance

* support: Replace tests with playwright (20-basic-features/20-basic-features--click-page-icons) (#8903) @miya
* support: Relocate components dir (#8917) @yuki-takei
* ci(deps): bump ws from 8.11.0 to 8.17.1 (#8906) @dependabot
* support: Update module resolution settings (#8898) @yuki-takei
* support: Decrease max SSR body length (#8895) @yuki-takei
* support: Use typescript-transform-paths instead of tsconfig-paths (#8892) @yuki-takei

## [v7.0.10](https://github.com/growilabs/growi/compare/v7.0.9...v7.0.10) - 2024-06-13

### 💎 Features

* imprv: Autofocus on PageTitleHeader when edigin untitled page (#8813) @WNomunomu
* imprv: Autofocus on PageTitleHeader when creating untitled page (#8813) @WNomunomu

### 🚀 Improvement

* imprv: DrawioViewerScript should respect the base path in DRAWIO_URI 2 (#8889) @yuki-takei
* imprv: Styling icon on the side of header (#8833) @reiji-h
* imprv: DrawioViewerScript should respect the base path in DRAWIO_URI (#8878) @yuki-takei
* imprv: Behavior when clicking on a label in the dropdown (#8857) @maeshinshin
* imprv(plugin): Support github tag in githuburl.ts (#8868) @reiji-h
* imprv: Display selected tree item in page select modal as active (#8802) @WNomunomu

### 🐛 Bug Fixes

* fix: Match width of video tag to img tag (#8836) @TatsuyaIse
* fix: Behaviour of input during Japanese input (#8880) @miya
* fix: Supress warning of checkbox 2 (#8871) @yuki-takei

### 🧰 Maintenance

* support: Watch with nodemon (#8877) @yuki-takei
* support: Add playwright test for installer (#8874) @yuki-takei
* support: Upgrade turbo to v2 (#8875) @yuki-takei

## [v7.0.9](https://github.com/growilabs/growi/compare/v7.0.8...v7.0.9) - 2024-05-30

### 🐛 Bug Fixes

* fix: Supress warning of checkbox (#8865) @yuki-takei
* fix: Editor package import/export (#8864) @yuki-takei

## [v7.0.8](https://github.com/growilabs/growi/compare/v7.0.7...v7.0.8) - 2024-05-30

### 💎 Features

* feat: Select unrelated group inheritance on child page create (#8812) @arafubeatbox

### 🚀 Improvement

* imprv: Design coding of search result page (#8828) @miya

### 🐛 Bug Fixes

* fix: Page body sometimes appears doubled up when the editor is opened (#8858) @miya
* fix: Brackets appearance when Nord editor theme (#8852) @satof3
* fix: Slack notification not sent on page update (#8841) @miya
* fix: Table icon is not displayed when hovering over the table (#8830) @WNomunomu

### 🧰 Maintenance

* support: Reorganize editor module exports (#8846) @yuki-takei

## [v7.0.7](https://github.com/growilabs/growi/compare/v7.0.6...v7.0.7) - 2024-05-27

### 🚀 Improvement

* imprv: Behavior of dropdown toggle in groundglassbar (#8832) @maeshinshin
* imprv: toastr location (#8831) @yuki-takei

### 🐛 Bug Fixes

* fix: Do not insert initial value when input is empty in editor (#8773) @miya

### 🧰 Maintenance

* support: Apply changesets (#8840) @yuki-takei
* support: Upgrade yjs packages (#8839) @yuki-takei
* support: Upgrade stylelint (#8835) @yuki-takei

## [v7.0.6](https://github.com/growilabs/growi/compare/v7.0.5...v7.0.6) - 2024-05-20

### 🐛 Bug Fixes

* fix: S3 configurations are considered invalid wrongly (#8823) @yuki-takei

### 🧰 Maintenance

* support: Publish @growi/core-styles package (#8819) @yuki-takei

## [v7.0.5](https://github.com/growilabs/growi/compare/v7.0.4...v7.0.5) - 2024-05-20

### 🚀 Improvement

* imprv: Behavior of dropdown toggle for WIP in 'Page Tree' sidebar (#8796) @maeshinshin
* imprv: Hide the page creation button for users without editing permissions (#8808) @miya
* imprv: Add config to toggle ACL between public_read and private on PutObject when using S3 with FileUploader (#8778) @ToshihitoKon

### 🐛 Bug Fixes

* fix: BookmarkItem occures an error when the related page has been deleted 2 (#8818) @yuki-takei
* fix: BookmarkItem occures an error when the related page has been deleted (#8817) @yuki-takei
* fix: Display share page date (#8809) @TatsuyaIse
* fix: Admin layout (#8806) @satof3

### 🧰 Maintenance

* support: Modify env var for S3 Object-ACL (#8805) @yuki-takei

## [v7.0.4](https://github.com/growilabs/growi/compare/v7.0.3...v7.0.4) - 2024-05-13

### 💎 Features

* feat: Add a button to open PageCreateModal in the new page creation lead (#8774) @miya
* feat: Show Yjs status indicator in SubNavigation (#8709) @miya
* feat: Apply locale to defualt page title (#8600) @jam411

### 🚀 Improvement

* imprv: Behavior when creating first user fails (#8801) @miya
* imprv: Add indexes for performance (#8800) @yuki-takei
* imprv: Autosize Input for rename (#8795) @yuki-takei
* imprv: behavior of dropdown toggle in 'Recent Changes' sidebar (#8782) @maeshinshin
* imprv: Hide  personal drop down when guest user (#8786) @kazutoweseek

### 🐛 Bug Fixes

* fix: Drawio not available with GROWI slides (#8725) @reiji-h
* fix: Auto-scroll to the active page in the page tree (#8772) @reiji-h

### 🧰 Maintenance

* ci(deps): bump ejs from 3.1.9 to 3.1.10 (#8784) @dependabot

## [v7.0.3](https://github.com/growilabs/growi/compare/v7.0.2...v7.0.3) - 2024-05-01

### 🚀 Improvement

* imprv: Rename on blur (#8777) @yuki-takei
* imprv: Re-calculate max-width for page tile on editor (#8775) @yuki-takei
* imprv: Truncate page path title in editor (#8726) @reiji-h
* imprv: FootstrampIcon uses material symbols (#8699) @kazutoweseek
* imprv: behaviour when pressing enter after numerical input (ex: 2.3.4.) (#8754) @WNomunomu

### 🐛 Bug Fixes

* fix: An error occurred during user activation via email (#8767) @maeshinshin
* fix: Admin customize screen (#8765) @yuki-takei
* fix: Editor theme active line (material, nord) (#8762) @satof3
* fix: 500 error occur when pressing the button for opening PageSelectModal (#8761) @WNomunomu
* fix: Admin screen min-height for body (#8764) @yuki-takei
* fix: Behaviour of table operation by enter key in editor (#8756) @WNomunomu
* fix: EditingUserList shows user icons even when the user is not opening the editor (#8752) @miya
* fix: Tags are not created when space key is entered (Firefox) (#8758) @miya
* fix: Parent group selection dropdown does not work (#8759) @miya
* fix: Codeblock overflow (#8753) @yuki-takei
* fix:  Nord and Original-dark theme in editor (#8748) @satof3
* fix: Material and Eclipse colors (#8749) @satof3
* fix: Always autofocus when moving to the Editor (#8730) @reiji-h
* fix: CopyDropdown protrudes from the screen issue (#8734) @WNomunomu
* fix: Error on today's memo create from hotkey when memo exists (#8746) @arafubeatbox
* fix: Editor styles (#8742) @yuki-takei
* fix: Close the comment editor after the post (#8741) @yuki-takei

### 🧰 Maintenance

* ci(deps): bump typeorm from 0.3.0 to 0.3.20 (#8745) @dependabot
* support: Make AwsFileUploader type safe (#8780) @yuki-takei
* support: Update modal header design (#8766) @satof3
* support: Improve types in IPage and IRevision (#8763) @yuki-takei
* support: Editor mobile appearance (#8760) @satof3
* support: Localize in app tags language en change ja ch revision (#8757) @kazutoweseek
* support: Upgrade vite and vitest (#8743) @yuki-takei
* support: Adjust design details (#8738) @satof3
* ci(deps): bump typeorm from 0.2.32 to 0.3.0 (#8602) @dependabot
* support: Upgrade date-fns (#8744) @yuki-takei

## [v7.0.2](https://github.com/growilabs/growi/compare/v7.0.1...v7.0.2) - 2024-04-17

### 💎 Features

* feat: fr_FR locale

### 🚀 Improvement

* imprv: Hide title of untitled page when creating newly (#8536) @WNomunomu
* imprv: Comment editor performance (#8731) @yuki-takei
* imprv: Truncate page path title in view (#8707) @reiji-h
* imprv: Show unrelated groups and disable ungrantable groups in grant select (#8695) @arafubeatbox
* imprv: Bookmark sidebar layout (#8703) @satof3
* imprv: Responsive layout (#8710) @yuki-takei
* imprv: Sm size dropdown menu (#8711) @satof3
* imprv: search results form improvements (#8705) @maeshinshin
* imprv: WIP Page behavior (#8700) @miya
* imprv: Disable groups not assignable to page due to parent grant (#8570) @arafubeatbox
* imprv: Border delete in search modal (#8629) @kazutoweseek
* imprv: Border in search modal (#8629) @kazutoweseek
* imprv: New Comment style (#8631) @satof3
* imprv: Hide title of untitled page when creating newly (#8536) @WNomunomu
* imprv: Render lightbox above the sidebar (#8673) @yuki-takei
* imprv: Add border to the page title header when editing (#8671) @yuki-takei
* imprv: Set font-display to icon fonts (#8670) @yuki-takei
* imprv: Enable box-shadow (#8668) @yuki-takei

### 🐛 Bug Fixes

* fix: Login layout when external auth only (#8717) @satof3
* fix: Initialize grant correctly after when page transition (#8633) @yukendev
* fix: lsx icon layout and color (#8691) @satof3
* fix: Tags are unintentionally created when a conversion is finalized (#8682) @miya
* fix: Footnotes making page scrollable. (#8678) @reiji-h
* fix: Automatic installation failure (#8685) @miya
* fix: Page content preview not shown in duplicate alert page (#8645) @arafubeatbox
* fix: react-toastify colors (#8672) @yuki-takei
* fix: Add filePath to the schema of attachement for backward compatibility for v3.3 or earlier (#8679) @shield-9
* fix: Questionnaire modal styles in dark mode (#8669) @yuki-takei
* fix: Cannot display error when page path is duplicated (#8664) @TatsuyaIse

### 🧰 Maintenance

* ci(deps): bump express from 4.17.1 to 4.19.2 (#8617) @dependabot
* support: Localize in app (#8716) @satof3
* ci(deps): bump tar from 6.2.0 to 6.2.1 (#8712) @dependabot
* support: Localize comment components (#8694) @satof3
* support: Upgrade actions from v3 to v4 (2) (#8688) @yuki-takei
* support: Upgrade actions from v3 to v4 (#8684) @yuki-takei
* ci(deps): bump undici from 5.21.2 to 5.28.4 (#8686) @dependabot
* ci(deps-dev): bump vite from 4.5.2 to 4.5.3 (#8675) @dependabot

## [v7.0.1](https://github.com/growilabs/growi/compare/v7.0.0...v7.0.1) - 2024-04-02

### 🚀 Improvement

* imprv: PagePathNav and PagePathHeader styles (#8643) @yuki-takei
* imprv: Prevent tooltip flickering (#8642) @yuki-takei
* imprv: PersonalDropdown style (#8641) @yuki-takei
* imprv: Support color scheme in Page History (diff2html) (#8637) @yuki-takei
* imprv: Disable RequestedAuthnContext in SAML authentication (v7.0.x) (#8635) @yuki-takei

### 🐛 Bug Fixes

* fix: Admin users badge color in /admin/users (#8655) @satof3
* fix: Custom logo style (#8656) @satof3
* fix: Error when creating TTL index (#8653) @miya
* fix: Login form style is broken (#8651) @yuki-takei
* fix: Login buttons for external auth provider does not work (#8648) @yuki-takei
* fix: Set `d-none` when the sidebar is closed in order to prevent scrollbars from appearing (#8640) @yuki-takei
* fix: Style for Handsontable in dark mode (#8639) @yuki-takei
* fix: Supress PageAccessoriesModal rerendering for keeping radio button selections of PageHistory (#8638) @yuki-takei
* fix: Uncorrect update bookmark button clicked on page control (#8608) @jam411
* fix: Counting comments when removing the thread (#8624) @yukendev

### 🧰 Maintenance

* support: Add light and dark badge color (#8652) @satof3
* support: Omit configurations for publishing to GitHub Container Registry(ghcr.io) (#8628) @yuki-takei

## [v7.0.0](https://github.com/growilabs/growi/compare/v6.3.2...v7.0.0) - 2024-03-27

### BREAKING CHANGES

* support: Remove obsolete route for attachment on MongoDB GridFS (#8239) @yuki-takei
* support: Omit promster (#8105) @yuki-takei
* support: Omit HackMD (CodiMD) (#8094) @yuki-takei
* support: Revoke well classes (#8041) @soumaeda

### 💎 Features

* feat: Not required latest revision when updating from Editor (#8522) @miya
* feat: Add editing user list on page header (#8486) @jam411
* feat: implement to add table when doing a line break in table markdown (#8461) @WNomunomu
* feat: WIP Page (#8484) @miya
* feat: 140020 140992 sidebar style (#8497) @yukendev
* feat: Select parent page from PageSelectModal (#8446) @WNomunomu
* feat: CollapsedParentsDropdown to display ancestor pathname (#8444) @miya
* feat: Enable and fix page duplication of user unrelated pages (#8442) @arafubeatbox
* feat: Multiple group grant for page (#8331) @arafubeatbox
* feat: Built-in Collaborative Editor (#8176) @jam411
* feat: Changing page title and path in edit mode (#8252) @WNomunomu
* feat: Notification count badge (#8372) @miya
* feat: Unread filtering for In-app notification (#8373) @miya
* feat: Show notifications in sidebar (#8371) @miya
* feat: Uniform behavior when creating pages from create new page button (#8297) @jam411
* feat: New incremental search (#8238) @miya
* feat: Allow deletion of user homepage when the user is deleted (#8224) @jam411
* feat: LDAP/Keycloak group sync (#7857) @arafubeatbox
* feat: Implementation of autocompletion function for emoji input (#8137) @WNomunomu
* feat: Create page when click edit button if page is not found (#8174) @jam411
* feat: Presentation preview and support Marp  (#8029) @reiji-h

### 🚀 Improvement

* imprv: New login design (#8607) @satof3
* imprv: Multi group grant page duplicate explanation (#8507) @arafubeatbox
* imprv: Update design for user homepage side contents (#8465) @jam411
* imprv: Update page accessories modal design (#8466) @jam411
* imprv: Creating/updating page APIs (#8459) @yuki-takei
* imprv: improve PageHeader component (#8439) @WNomunomu
* imprv: Use unzip stream instead of unzipper (#8378) @ryu-sato
* imprv: Allow plugin that contain slashes in the branch name to be installed (#8359) @ryu-sato
* imprv: Refactor DrawioViewer re-rendering by the resizing trigger (#8314) @yuki-takei
* imprv: Upload handler use apiv3 post (#8279) @reiji-h
* imprv: Apply content headers for attachment response (#8245) @yuki-takei
* imprv: Add Marp preset template for ja_JP and zh_CN (#8179) @AikaHiyama
* imprv: Update RichAttachments feat on shared pages (#8206) @jam411
* imprv: Certify shared page attachment middleware (#8211) @yuki-takei
* imprv: Able to edit tags in editor (#8167) @soumaeda
* imprv: Responsive layout (#8200) @yuki-takei
* imprv: Sidebar on edit (#8181) @yuki-takei
* imprv: Sidebar mode (#8160) @yuki-takei
* imprv: Limit the file types in editor. (#8146) @reiji-h
* imprv: Support Ctrl+V file paste. (#8124) @reiji-h
* imprv: i18n for marp settings (#8110) @moekumasaka
* imprv: Download a markdown file using the page name as the file name (#8061) @soumaeda
* imprv: i18n "Create /Sidebar page" label (#8085) @yuki-takei
* imprv: Admin customize presentation form (#8083) @meiri-k
* imprv: Search behavior (#8069) @yuki-takei
* imprv: i18n resetting password mail body (#8058) @meiri-k
* imprv: Add installed date to questionnaire answer (#7971) @TatsuyaIse
* imprv: Export md with page name (#8005) @soumaeda
* imprv: Show modal when you delete plugin (#7875) @soumaeda
* imprv: Create  Japanese  ejs files (#7957) @meiri-k
* imprv: Sidebar shows skelton with suspense (#7975) @yuki-takei

### 🐛 Bug Fixes

* fix: Show both UserGroups and ExternalUserGroups for group delete modal transfer select (#8519) @arafubeatbox
* fix: Multi group grant page becomes public when one of groups deleted (#8518) @arafubeatbox
* fix: pages are not displayed in page tree (#8515) @WNomunomu
* fix: Page being able to delete completely when not allowed (#8374) @arafubeatbox
* fix: Logs are not saved when viewing the page (#8406) @miya
* fix: Normalize duplicated root pages to valid paths when server startup (#8414) @miya
* fix: Configured auditlog environment variables are not reflected in the administration screen (#8383) @miya
* fix: Plugin is broken after unzipping (#8358) @ryu-sato
* fix: Keycloak group sync config not loaded on sync execution (#8339) @arafubeatbox
* fix: SAML callback action throws the field is undefined error when the ACL Rule string is only white space (#8322) @yuki-takei
* fix: Update deleteCompletelyUserHomeBySystem for v4 process (#8289) @jam411
* fix: Remove groups not related to the user from the user groups that are specified automatically when creating child pages (#8266) @arafubeatbox
* fix: Certify shared page attachment middleware (#8255) @yuki-takei
* fix: Show liker counts in lsx (#8194) @yuki-takei
* fix: Marp is enabled incorrectly problem (#8100) @reiji-h
* fix: Fixing swagger for tag update api (#8010) @miya
* fix: Modification of links in the docs (#8004) @miya
* fix: Type safe implementation for objects imported from ElasticsearchClient (#7862) @miya
* fix: Consider an empty page when renaming and duplicating (v6.1.x) (#7980) @yuki-takei
* fix: Consider an empty page when renaming and duplicating (#7979) @yuki-takei

### 🧰 Maintenance

* support: Upgrade Next.js v14 (#8586) @yuki-takei
* imprv: New login design (#8607) @satof3
* support: Node.js v20 (#8528) @miya
* support: Upgrade react bootstrap typeahead (#8500) @jam411
* ci(deps): bump ip from 2.0.0 to 2.0.1 (#8508) @dependabot
* support: React Testing Library (#8393) @miya
* ci(deps-dev): bump vite from 4.5.1 to 4.5.2 (#8392) @dependabot
* support: Build GROWI custom icons (#8356) @yukendev
* ci(deps-dev): bump vite from 4.5.0 to 4.5.1 (#8302) @dependabot
* support: Remove obsolete route for attachment on MongoDB GridFS (#8239) @yuki-takei
* support: Install material-symbols (#8182) @yuki-takei
* ci(deps-dev): bump postcss from 8.4.26 to 8.4.31 (#8142) @dependabot
* ci(deps): bump cypress-io/github-action from 5 to 6 (#8051) @dependabot
* ci(deps): bump amannn/action-semantic-pull-request from 5.0.2 to 5.3.0 (#8127) @dependabot
* ci(deps): bump aws-actions/configure-aws-credentials from 2 to 4 (#8128) @dependabot
* support: Internationalization USER_REGISTRATION_APPROVAL_REQUEST label for v62x (#8130) @jam411
* ci(deps): bump get-func-name from 2.0.0 to 2.0.2 (#8119) @dependabot
* support: Omit promster (#8105) @yuki-takei
* support: Omit HackMD (CodiMD) (#8094) @yuki-takei
* support: Revoke well classes (#8041) @soumaeda
* support: Upgrade to reactstrap v9 (#7984) @jam411
* support: Update CodeMirror to v6 (#7968) @yuki-takei

## [v6.3.2](https://github.com/growilabs/growi/compare/v6.3.1...v6.3.2) - 2024-03-25

### 🐛 Bug Fixes

* fix: Show both UserGroups and ExternalUserGroups for group delete modal transfer select (#8519) @arafubeatbox

### 🧰 Maintenance

* ci(deps): bump ip from 2.0.0 to 2.0.1 (#8508) @dependabot

## [v6.3.1](https://github.com/growilabs/growi/compare/v6.3.0...v6.3.1) - 2024-02-01

### 💎 Features

* feat: Normalize duplicated root pages to valid paths when server startup (#8414) @miya

### 🚀 Improvement

* imprv: Use unzip stream instead of unzipper (#8378) @ryu-sato
* imprv: Allow plugin that contain slashes in the branch name to be installed (#8359) @ryu-sato

### 🐛 Bug Fixes

* fix: Page being able to delete completely when not allowed (#8374) @arafubeatbox
* fix: Logs are not saved when viewing the page (#8406) @miya
* fix: Preventing duplication of `/user/username` pages (#8413) @WNomunomu
* fix: Non-admin user cannot rename pages v63x (#8410) @jam411
* fix: Duplicate root pages are created unintentionally (#8404) @miya
* fix: Configured auditlog environment variables are not reflected in the administration screen (#8383) @miya
* fix: plugin is broken after unzipping (#8358) @ryu-sato
* fix: Keycloak group sync config not loaded on sync execution (#8339) @arafubeatbox

### 🧰 Maintenance

* support: React Testing Library (#8393) @miya
* ci(deps-dev): bump vite from 4.5.1 to 4.5.2 (#8392) @dependabot

## [v6.3.0](https://github.com/growilabs/growi/compare/v6.2.5...v6.3.0) - 2023-12-14

### BREAKING CHANGES

* support: Remove obsolete route for attachment on MongoDB GridFS (#8239) @yuki-takei

### 💎 Features

* feat: LDAP/Keycloak group sync (#7857) @arafubeatbox

### 🚀 Improvement

* imprv: Refactor DrawioViewer re-rendering by the resizing trigger (#8314) @yuki-takei
* imprv: Apply content headers for attachment response (#8245) @yuki-takei

### 🐛 Bug Fixes

* fix: SAML callback action throws the field is undefined error when the ACL Rule string is only white space (#8322) @yuki-takei
* fix: Remove groups not related to the user from the user groups that are specified automatically when creating child pages (#8266) @arafubeatbox
* fix: Certify shared page attachment middleware (#8255) @yuki-takei

### 🧰 Maintenance

* support: Add test for delete-completely-user-home-by-system.ts (#8323) @jam411
* ci(deps-dev): bump vite from 4.5.0 to 4.5.1 (#8302) @dependabot
* support: TypeScriptize attachment codes (#8243) @yuki-takei
* support: Remove obsolete route for attachment on MongoDB GridFS (#8239) @yuki-takei

## [v6.2.5](https://github.com/growilabs/growi/compare/v6.2.4...v6.2.5) - 2023-12-14

### 🐛 Bug Fixes

* fix: Update deleteCompletelyUserHomeBySystem for v4 process (#8289) @jam411

## [v6.2.4](https://github.com/growilabs/growi/compare/v6.2.3...v6.2.4) - 2023-11-29

### 💎 Features

* feat: Show create date in Attachment Data list (#8229) @sakazuki

### 🚀 Improvement

* imprv: Add Marp preset template for ja_JP and zh_CN (#8179) @AikaHiyama
* imprv: Allow deletion of user homepage when the user is deleted (#8224) @jam411

### 🐛 Bug Fixes

* fix: Certify shared page attachment middleware (6.2.x) (#8256) @yuki-takei

### 🧰 Maintenance

* support: Refactor deleteCompletelyUserHomeBySystem (#8262) @jam411

## [v6.2.3](https://github.com/growilabs/growi/compare/v6.2.2...v6.2.3) - 2023-11-13

### 🚀 Improvement

- imprv: Certify shared page attachment middleware (#8211) @yuki-takei
- imprv: Printing styles 2 (#8203) @yuki-takei

## [v6.2.2](https://github.com/growilabs/growi/compare/v6.2.1...v6.2.2) - 2023-10-30

### 🚀 Improvement

- imprv: Printing styles (#8195) @yuki-takei

### 🐛 Bug Fixes

- fix: Show liker counts in lsx (#8194) @yuki-takei

### 🧰 Maintenance

- ci(deps-dev): bump postcss from 8.4.26 to 8.4.31 (#8142) @dependabot
- ci(deps): bump cypress-io/github-action from 5 to 6 (#8051) @dependabot
- ci(deps): bump amannn/action-semantic-pull-request from 5.0.2 to 5.3.0 (#8127) @dependabot
- ci(deps): bump aws-actions/configure-aws-credentials from 2 to 4 (#8128) @dependabot

## [v6.2.1](https://github.com/growilabs/growi/compare/v6.2.0...v6.2.1) - 2023-10-03

### BREAKING CHANGES

- support: Omit promster (#8105) @yuki-takei

### 🚀 Improvement

- imprv: Download a markdown file using the page name as the file name (#8061) @soumaeda
- imprv: Admin customize presentation form (#8083) @meiri-k
- imprv: i18n for marp settings (#8110) @moekumasaka
- imprv: i18n "Create /Sidebar page" label (#8085) @yuki-takei

### 🐛 Bug Fixes

- fix: Marp is enabled incorrectly problem (#8100) @reiji-h
- fix: Do not work img tag if use style property 62x (#8092) @jam411

### 🧰 Maintenance

- support: Internationalization USER_REGISTRATION_APPROVAL_REQUEST label for v62x (#8130) @jam411
- ci(deps): bump get-func-name from 2.0.0 to 2.0.2 (#8119) @dependabot
- support: Omit promster (#8105) @yuki-takei

## [v6.2.0](https://github.com/growilabs/growi/compare/v6.1.12...v6.2.0) - 2023-09-14

### 💎 Features

- feat: Presentation preview and support Marp  (#8029) @reiji-h

### 🚀 Improvement

- imprv: Able to customize users homepage deletion (#7921) @yuki-takei
- imprv: Search behavior (#8069) @yuki-takei
- imprv: Add CSP style-src for Safari and Content-Disposition of attachment (#8049) @ykanematsu
- imprv: Correct update message (#8040) @reiji-h
- imprv: Add installed date to questionnaire answer (#7971) @TatsuyaIse
- imprv: Show modal when you delete plugin (#7875) @soumaeda
- imprv: i18n resetting password mail body (#8058) @meiri-k
- imprv: Create Japanese ejs files (#7957) @meiri-k
- imprv: Clean up old toastr (#7949) @jam411
- imprv: Persist the installed date in the Config collection (#7936) @TatsuyaIse

### 🐛 Bug Fixes

- fix: Pages can be created under a non-existent user page (#7974) @miya
- fix: Pages can be created under a non-existent user page (During attachment upload) (#8001) @miya
- fix: Type safe implementation for objects imported from ElasticsearchClient (#7862) @miya
- fix: Consider an empty page when renaming and duplicating (#7979) @yuki-takei
- fix: Remove redundant toastSuccess for pasted attachments (#8044) @jam411
- fix: Fixing swagger for tag update api (#8010) @miya
- fix: Modification of links in the docs (#8004) @miya

### 🧰 Maintenance

- support: Omit core-js v2 (#7944) @yuki-takei
- support: Improve build settings (#7919) @yuki-takei
- support: Url to join to the slack team (#8073) @WNomunomu

## [v6.1.15](https://github.com/growilabs/growi/compare/v6.1.14...v6.1.15) - 2023-09-11

### 🚀 Improvement

- imprv: Add CSP style-src for Safari and Content-Disposition of attachment (for v6.1.x) (#8057) @yuki-takei

## [v6.1.14](https://github.com/growilabs/growi/compare/v6.1.13...v6.1.14) - 2023-08-22

### 🐛 Bug Fixes

- fix: Add option to lightbox (6.1.x) (#8003) @yuki-takei

## [v6.1.13](https://github.com/growilabs/growi/compare/v6.1.12...v6.1.13) - 2023-08-17

### 🐛 Bug Fixes

- fix: Do not work img tag if use style property (#7988) @jam411
- fix: "Searching..." label appearing unnecessarily (#7990) @yuki-takei

## [v6.1.12](https://github.com/growilabs/growi/compare/v6.1.11...v6.1.12) - 2023-08-14

### 🐛 Bug Fixes

- fix: Consider an empty page when renaming and duplicating (v6.1.x) (#7980) @yuki-takei
- fix: Do not work image tag properties (#7977) @jam411

## [v6.1.11](https://github.com/growilabs/growi/compare/v6.1.10...v6.1.11) - 2023-08-07

### 🐛 Bug Fixes

- fix: Admin page permission when the user transit with next-routing (#7908) @WNomunomu
- fix: Transitioning to a non-existent page under "/me" results in a 500 error (#7946) @miya
- fix: Auto-scroll search result content 2 (#7943) @yuki-takei

## [v6.1.10](https://github.com/growilabs/growi/compare/v6.1.9...v6.1.10) - 2023-08-01

### 🐛 Bug Fixes

- fix: Unsaved comments remain in the editor when transitioning to a new page  (#7912) @miya
- fix: SWR settings for searching (#7940) @yuki-takei
- fix: Auto-scroll search result content (#7935) @yuki-takei

## [v6.1.9](https://github.com/growilabs/growi/compare/v6.1.8...v6.1.9) - 2023-07-31

### 💎 Features

- feat: LightBox for enlargement of image (#7899) @WNomunomu

### 🚀 Improvement

- imprv: Do not use loadConfigs in skipSSR (#7929) @jam411
- imprv: Improve default behavior of skipSSR (#7927) @jam411
- imprv: Improved Design for Bookmarks Sidebar (#7886) @soumaeda

### 🐛 Bug Fixes

- fix: Page creation and update process (#7925) @yuki-takei
- fix: Sidebar doesn't show the link to the administration panel when logged in as an Admin (#7914) @miya
- fix: Improve page data mutation after renaming and deleting by GrowiContextualSubNavigation (#7926) @yuki-takei
- fix: Revert dynamic import. (#7923) @TatsuyaIse
- fix: Questionnaire wikiType (#7907) @TatsuyaIse

## [v6.1.8](https://github.com/growilabs/growi/compare/v6.1.7...v6.1.8) - 2023-07-24

### 💎 Features

- feat: Add plugin badge to TemplateModal's list of templates (#7897) @TatsuyaIse

### 🚀 Improvement

- imprv: Replace isAdmin with usersAdminHooks (#7840) @WNomunomu
- imprv: Show alert for trashed pages only when the page is not empty (#7903) @TatsuyaIse
- imprv: Template name truncation (#7898) @TatsuyaIse

### 🐛 Bug Fixes

- fix: Cancel a comment will cancel all comments (#7804) @mudana-grune

### 🧰 Maintenance

- ci(deps-dev): bump vite from 4.3.8 to 4.4.5 (#7901) @dependabot
- ci(deps): bump semver from 5.7.1 to 5.7.2 (#7867) @dependabot
- ci(deps): bump mongoose from 6.11.1 to 6.11.3 (#7891) @dependabot
- ci(deps): bump word-wrap from 1.2.3 to 1.2.4 (#7892) @dependabot

## [v6.1.7](https://github.com/growilabs/growi/compare/v6.1.6...v6.1.7) - 2023-07-19

### 💎 Features

- feat: Authentication settings cannot be disabled if there will be no administrator user available to log in (#7761) @mudana-grune

### 🚀 Improvement

- imprv: Show spinner while installing and logging-in (#7823) @soumaeda
- imprv: Routing with next link (#7880) @yuki-takei

### 🐛 Bug Fixes

- fix: Auto popup PageAccessoriesModal and show page history (#7888) @yuki-takei
- fix: Auto-scroll does not work when accessing the page when the header string is CJK (#7882) @yuki-takei
- fix: Avoid unnecessary next routing (#7863) @miya
- fix: Work put back page on bookmark sidebar (#7698) @mudana-grune

### 🧰 Maintenance

- support: Render SearchPageBase in CSR (#7889) @yuki-takei

## [v6.1.6](https://github.com/growilabs/growi/compare/v6.1.5...v6.1.6) - 2023-07-12

### 🐛 Bug Fixes

- fix: Revert current page mutation and add workaround for saving page (#7877) @yuki-takei
- fix: The official docker image missed preset-templates (#7865) @yuki-takei
- fix: SSL connection error to Elasticsearch8 using self certificate (#7818) @miya

## [v6.1.5](https://github.com/growilabs/growi/compare/v6.1.4...v6.1.5) - 2023-07-10

### 💎 Features

- feat: Rich Attachment (#7534) @jam411
- feat: Plugin kit (#7830) @yuki-takei
- feat: Deciding whether to use SSR based on the volume of latestRevisionBodyLength (#7772) @miya

### 🚀 Improvement

- imprv: Load templates from the server 2 (#7850) @yuki-takei
- imprv: Improve release parent group button (#7838) @WNomunomu
- imprv: Load templates from the server (#7842) @yuki-takei
- imprv: Able to send new passsword by email (#7758) @soumaeda
- imprv: Convert jsx into tsx (#7832) @WNomunomu
- imprv: After reset password footer modal design (#7790) @soumaeda
- imprv: Update email alert (#7771) @WNomunomu
- imprv: Can use normal browser transition in searching page (#7826) @yuki-takei
- imprv: Show tooltip when copying password (#7800) @soumaeda

### 🐛 Bug Fixes

- fix(lsx): Except option (#7855) @yuki-takei
- fix: Page body is not displayed when skipSSR (#7849) @miya
- fix: When uploading an attachment file to a new page and pressing the update button, an error occurs (#7844) @miya
- fix: Editing user group settings (#7827) @WNomunomu
- fix: Handsontable not display full screen (#7784) @mudana-grune
- fix: Brand logo fill color transition (#7828) @yuki-takei
- fix: Email body of global notification is not displayed (#7824) @jam411
- fix(lsx): Prefix is not uniquely determined by usage (#7815) @yuki-takei

### 🧰 Maintenance

- support: Dependencies specification for local packages (#7809) @yuki-takei

## [v6.1.4](https://github.com/growilabs/growi/compare/v6.1.3...v6.1.4) - 2023-06-12

### 💎 Features

- feat(plugin): Specify repository branch name (#7783) @yuki-takei

### 🚀 Improvement

- imprv: Suppress unnecessary bookmark API requests (#7798) @yuki-takei

### 🐛 Bug Fixes

- fix: Bookmarks mutation for the current user (#7797) @yuki-takei
- fix: Slack channels data for User Triggered Notification is not loaded (#7794) @yuki-takei
- fix: The input of the editor is cleared when an attachment is added when a new page editing (#7788) @miya

## [v6.1.3](https://github.com/growilabs/growi/compare/v6.1.2...v6.1.3) - 2023-06-07

### 💎 Features

- feat(lsx):  Load more (#7774) @yuki-takei

### 🚀 Improvement

- imprv: Insert template (#7764) @yuki-takei
- imprv: Update preset templates (#7762) @yuki-takei
- imprv: Make migration script type safe (#7702) @miya
- imprv: Update migration script docs (#7699) @miya

### 🐛 Bug Fixes

- fix(lsx): Parsing num/depth options (#7769) @yuki-takei
- fix: When uploading an attachment and creating a new page, it does not inherit the grant of the parent page (#7768) @miya
- fix: Unable to perform bookmark operations from bookmark item control (#7750) @miya
- fix: Bookmarks status not updated on search result (#7667) @mudana-grune

### 🧰 Maintenance

- support: Refactor plugin related modules (#7765) @yuki-takei
- support: Refactor AclService (#7754) @yuki-takei
- support: typescriptize SlackLegacyUtil (#7751) @yuki-takei
- support: Refactor ConfigManager (#7752) @yuki-takei
- support: Convert unit tests by Jest to Vitest (#7749) @yuki-takei

## [v6.1.2](https://github.com/growilabs/growi/compare/v6.1.1...v6.1.2) - 2023-05-25

### 🚀 Improvement

- imprv: Unify whitelist description (#7638) @soumaeda
- imprv: Refactoring migration script (#7694) @miya
- imprv: Implement infinite scroll into PageTimeline (#7679) @reiji-h

### 🐛 Bug Fixes

- fix: Hash and search query in the relative link are omitted wrongly (#7697) @yuki-takei

### 🧰 Maintenance

- support: Restrict the 'populate' method in model modules (#7689) @yuki-takei
- support: Refactor LinkEditModal (#7654) @yukendev
- ci(deps): bump aws-actions/configure-aws-credentials from 1 to 2 (#7620) @dependabot
- ci(deps): bump hugo19941994/delete-draft-releases from 1.0.0 to 1.0.1 (#7448) @dependabot

## [v6.1.1](https://github.com/growilabs/growi/compare/v6.1.0...v6.1.1) - 2023-05-24

### 🐛 Bug Fixes

- fix: Bookmark folders owned by others are accessible for manipulation (#7688) @miya
- fix: remark-attachment-refs does not work in production (#7681) @yuki-takei
- fix: User picture of bookmark not showing inside bookmark folder (#7678) @mudana-grune
- fix: Update name attribute of PageRenameModal.tsx (#7677) @jam411
- fix: The user's bookmarks are displayed on unrelated user's home (#7668) @miya
- fix: The user's bookmarks are updated by unrelated user's operation (#7670) @jam411

## [v6.1.0](https://github.com/growilabs/growi/compare/v6.0.15...v6.1.0) - 2023-05-17

### BREAKING CHANGES

- Node.js v14 is no longer supported.
- Elasticsearch v6 is no longer supported.
- imprv: Omit clobber prefix (#7627) @yuki-takei
- support: Omit textlint (#7578) @yuki-takei
- support: Remove Blockdiag codes (#7576) @yuki-takei

See the upgrading guide for v6.1.x. => [English](https://docs.growi.org/en/admin-guide/upgrading/61x.html) / [Japanese](https://docs.growi.org/ja/admin-guide/upgrading/61x.html)

### 💎 Features

- feat: Add read-only user feature (#7648) @jam411
- feat: Support Mermaid (move into the feature dierctory) (#7647) @miya
- feat: Fix APP_SITE_URL with an environment variable (#7646) @yuki-takei
- feat: Support Mermaid (#7645) @miya
- feat: Support Elasticsearch v8 (#7623) @miya
- feat: Elasticsearchv8 module (#7623) @miya
- feat: Bookmarks folder and sidebar menu (#7450) @mudana-grune
- feat: GROWI Questionnaire (#7316) @hakumizuki
- feat: Revive attachment-refs with remark (#7597) @arafubeatbox

### 🚀 Improvement

- imprv: Font size (#7663) @yuki-takei
- imprv: Admin user can use `reset-password` without email settings (#7650) @jam411
- imprv: Optimize fonts with next/font (#7633) @yuki-takei
- imprv: GFM table performance 2 (#7640) @yuki-takei
- imprv: GFM footnote styles (#7628) @yuki-takei
- imprv: GFM table performance (#7619) @yuki-takei
- imprv: Show unsaved warning when comment not posted (#7603) @arafubeatbox
- imprv: Suppress UI Flickering for dropdowns (#7608) @jam411
- imprv: Allow registering without GROWI email settings for ID/Password authentication's restricted registration (#7591) @jam411
- imprv: Enable browsing video (for v6.1.0) (#7589) @yuki-takei
- imprv: Show a spinner into the save button while the saving process (#7579) @yuki-takei
- imprv: Inject PlantUML URI with config-loader (#7577) @yuki-takei
- imprv: Loading draw.io (diagrams.net) resources (#7575) @yuki-takei

### 🐛 Bug Fixes

- fix: The environment variable for disabling link sharing (#7652) @yuki-takei
- fix: Cursor resetting occurs after updating with the built-in editor (#7644) @yuki-takei
- fix: Revision schema migration for v5 to v6 (#7637) @yuki-takei
- fix: Editor not resetting when the same markdown (#7625) @arafubeatbox
- fix: AlignRight DropdownMenu flickering (#7606) @mudana-grune
- fix: Not display page list count badge in trash page (#7600) @yukendev
- fix: Reverted descendant pages do not appear in search results (#7587) @miya
- fix: Deleted descendant pages do not appear in search results (#7583) @miya
- fix: Show lsx page list in trash page correctly (#7582) @yukendev
- fix: Uncaught type error by `sticky-event` (#7566) @mudana-grune

### 🧰 Maintenance

- support: mongoose update (#7659) @jam411
- support: Elasticsearch8 (#7592) @miya
- support: Replaced by IAttachmentHasId (#7629) @reiji-h
- support: Dedupe packages (#7590) @yuki-takei
- support: Typescriptize CustomNav (#7584) @yuki-takei
- support: Replaced by IAttachmentHasId (#7629) @reiji-h
- support: Migrate to Turborepo (#7417) @yuki-takei

## [v6.0.15](https://github.com/growilabs/growi/compare/v6.0.14...v6.0.15) - 2023-04-10

### 🐛 Bug Fixes

- fix: Templates are not applied when pages are created from PageTree (#7553) @miya
- fix(drawio): Render uncompressed data when line-breaks option is set (#7555) @yuki-takei
- fix: Is not working i18n on `/admin/export`  (#7554) @jam411
- fix: PageTree mutiple DnD unexpected disappear and unexpected tree move if renamed path (#7542) @jam411
- fix: Username incremental search is not working in comment (#7548) @mudana-grune
- fix: H6 line-height (#7541) @yukendev

## [v6.0.14](https://github.com/growilabs/growi/compare/v6.0.13...v6.0.14) - 2023-04-04

### 🐛 Bug Fixes

- fix(drawio): Set compressXml option (#7536) @yuki-takei
- fix(drawio): Rendering uncompressed data (#7537) @yuki-takei

## [v6.0.13](https://github.com/growilabs/growi/compare/v6.0.12...v6.0.13) - 2023-04-03

### 🐛 Bug Fixes

- fix: The "note" and "keep" commands of the GROWI bot are not functioning (#7529) @miya
- fix: The "search" command of the GROWI bot is not functioning (#7525) @miya
- fix: Lsx filter and except option do not work when the path includes special characters (#7523) @yuki-takei

## [v6.0.12](https://github.com/growilabs/growi/compare/v6.0.11...v6.0.12) - 2023-03-30

### 🐛 Bug Fixes

- fix: DrawioViewer script URL (#7518) @yuki-takei

## [v6.0.11](https://github.com/growilabs/growi/compare/v6.0.10...v6.0.11) - 2023-03-29

### 🚀 Improvement

- imprv: ToC placeholder (#7506) @yuki-takei

### 🐛 Bug Fixes

- fix: Support draw.io v21.1.0 (support both of compressed/uncompressed data) (#7515) @yuki-takei
- fix: The same level template page is being applied to lower level pages unintentionally (#7510) @miya
- fix: Supress `activeTab` prop type error (#7504) @jam411

## [v6.0.10](https://github.com/growilabs/growi/compare/v6.0.9...v6.0.10) - 2023-03-23

### 🚀 Improvement

- imprv: Reverse switch for display or hidden page settings (#7483) @yuki-takei

### 🐛 Bug Fixes

- fix: CodeBlock string is be `[object Object]` if searched (#7484) @jam411
- fix: Show handsontable edit modal color in dark theme  (#7497) @yukendev
- fix: Error when transitioning to a user home page where creator does not exist (#7499) @miya
- fix: Attachment links do not work correctly (#7498) @jam411
- fix: Language selection dropdown in installer does not reflect browser language setting (#7494) @miya
- fix:  Search results are not highlighted when searching for quoteted words (PageListItemL) (#7491) @miya
- fix: Responses 500 status code when invalid regular expressions are inputted to lsx's execpt option (#7488) @jam411
- fix: Page paths in search results are not displayed correctly (#7463) @miya

## [v6.0.9](https://github.com/growilabs/growi/compare/v6.0.8...v6.0.9) - 2023-03-14

### 💎 Features

- feat: Replaced with new toast (#7466) @mudana-grune

### 🚀 Improvement

- imprv: Page path hierarchical link color (#7474) @yuki-takei
- imprv: Add markdown header link (h4, h5, h6) (#7465) @miya
- imprv: Include anyone with the link page in the deletion target (#7461) @miya

### 🐛 Bug Fixes

- fix: Scrolling table in preview causes editor to scroll to row 1 (workaround) (#7473) @miya
- fix: Internal server error when input wrong tag to markdown (#7471) @jam411
- fix: Search results are not highlighted when searching for quoteted words (#7443) @miya

### 🧰 Maintenance

- support: Bump Next.js to v13 (#7458) @yuki-takei

## [v6.0.8](https://github.com/growilabs/growi/compare/v6.0.7...v6.0.8) - 2023-03-06

### 💎 Features

- feat: Compare all page revisions on PageAccessoriesModal History tab (#7414) @jam411

### 🚀 Improvement

- imprv: Save the correct page body when uploading the attachment (#7432) @miya
- imprv: Determine page grant considering wiki mode when creating a new page by uploading attachments (#7428) @miya

### 🐛 Bug Fixes

- fix: Email is not sent to Admin user when the user is created at user registration restricted (#7454) @miya
- fix: Error when trying to create a new page with attachments (#7424) @miya
- fix: Unable to delete multiple pages (#7435) @miya
- fix: PageDeleteModal warns even if you have delete permission (#7436) @miya
- fix: Color of the close icon in modal header (#7419) @ayaka0417
- fix: Behavior when conflicts occur when saving pages (#7425) @miya

## [v6.0.7](https://github.com/growilabs/growi/compare/v6.0.6...v6.0.7) - 2023-02-21

### 💎 Features

- feat: Manage guest ui setting with session (#7401) @yukendev
- feat: Manage guest sidebar mode with session (#7393) @yukendev

### 🚀 Improvement

- imprv: UnsavedAlertDialog and page transition when next routing (#7400) @miya
- imprv: PasswordResetModal styles and ejs format (#7404) @jam411
- imprv: Initialize UserUISettings (#7397) @yuki-takei
- imprv: Presentation behavior (#7399) @yuki-takei

### 🐛 Bug Fixes

- fix: PageStatusAlert is displayed on unnecessary pages (#7413) @miya
- fix: PageStatusAlert does not disappear after loading latest revision (#7412) @miya
- fix: Unable to transition requested page after login (#7402) @miya
- fix: Page body is blank when opening editor after duplicating page (#7394) @miya
- fix: Error when pressing the conflict resolution button on PageStatusAlert (#7395) @miya
- fix: mono-blue subnavigation color (#7398) @ayaka0417
- imprv: Add send email to user feat to `/reset-password` endpoint v6 (#7356) @jam411
- fix: Behavior when color schema is forced by GROWI themes (#7391) @yuki-takei
- fix: Sidebar mode on editor doesn't work in HackMD tab (#7396) @yuki-takei
- fix: Can't controll slack notification button in comment editor (#7389) @yukendev

## [v6.0.6](https://github.com/growilabs/growi/compare/v6.0.5...v6.0.6) - 2023-02-14

### 💎 Features

- feat: Presentation (#7367) @yuki-takei
- feat: Detect i18n locale from browser accept languages (#7341) @jam411
- feat: Server Side Rendering (#7352) @yuki-takei

### 🚀 Improvement

- imprv: Allow iframe tag (#7368) @yuki-takei
- imprv: User data serialization (#7355) @miya
- imprv: Anchor link (#7354) @yuki-takei
- imprv: classname for fluid layout (#7353) @yuki-takei
- imprv: Disable lsx in shared page (#7333) @miya
- imprv: Data mutation (#7336) @yuki-takei

### 🐛 Bug Fixes

- fix: Make collapse work for anchor tags (#7381) @jam411
- fix: Revision short body is not displayed on search results page (#7373) @miya
- fix: Error when clicking on a page you are not authorized to view on the search results page (#7343) @miya
- fix: Omit S3 credentials from the response for /_api/v3/app-settings (#7369) @miya
- fix: Omit S3 credentials from the response for /_api/v3/app-settings (#7369) @miya
- fix: Keep showing page restricted alert (#7371) @yukendev
- fix: Recent changes and Timeline (#7366) @yuki-takei
- fix: Login screen background (#7350) @ayaka0417
- fix: Comment form background (#7365) @ayaka0417
- fix: Scroll into view by anchor (#7360) @yuki-takei
- fix: Routing after creating page with shortcut (#7359) @yuki-takei
- fix: Border-color in edit mode (#7349) @ayaka0417
- fix: Can't controll slack notification switch in editor (#7332) @yukendev
- fix: Show load latest revision button when update drawio or table from view (#7324) @yukendev
- fix: Can delete own user (#7321) @miya
- fix: Request to "/_api/v3/page/is-grant-normalized" occurs when in guest mode (#7313) @miya

### 🧰 Maintenance

- support: create README.md for v6 migration (#7380) @yukendev
- support: Bump SWR to v2.0.3 (#7362) @yuki-takei
- feat: Refactor common processes in Next Page (#7357) @yukendev
- support: Migrate Notation for v5 to v6 (#7326) @yukendev
- ci(deps-dev): bump sass from 1.53.0 to 1.57.1 (#7223) @dependabot
- ci(deps): bump amannn/action-semantic-pull-request from 4.2.0 to 5.0.2 (#7338) @dependabot
- ci(deps): bump bakunyo/git-pr-release-action from 281e1fe424fac01f3992542266805e4202a22fe0 to master (#7340) @dependabot
- ci(deps): bump docker/build-push-action from 2 to 4 (#7339) @dependabot
- ci(deps): bump http-cache-semantics from 4.1.0 to 4.1.1 (#7344) @dependabot
- support: Bump SWR to v2 (#7318) @yuki-takei
- support: Add test for View and Edit contents when saving (#7323) @yukendev

## [v6.0.5](https://github.com/growilabs/growi/compare/v6.0.4...v6.0.5) - 2023-01-30

### 🚀 Improvement

- imprv: Override process for CommonSanitizeOptions (#7305) @miya

### 🐛 Bug Fixes

- fix:  Request to "/_api/v3/personal-settings"  occurs when in guest mode (#7307) @miya
- fix: Undeleteable trash pages when clicked empty trash button bug (#7250) @jam411
- fix: Guest users are able to move to pages that require authentication (#7300) @miya
- fix: Modal does not close after clicking on path in DescendantsPageListModal (#7291) @miya
- fix: GrowiContextualSubNavigation style is broken (#7304) @jam411
- fix: Markdown in the editor reverted when save with shortcut (#7301) @yukendev

## [v6.0.4](https://github.com/growilabs/growi/compare/v6.0.3...v6.0.4) - 2023-01-25

### 🐛 Bug Fixes

- fix: Invalid URL in markdown breaks browser (#7292) @yuki-takei
- fix: Previous editing markdown remains after changing page (#7285) @yukendev

### 🧰 Maintenance

- ci(deps): bump ua-parser-js from 0.7.31 to 0.7.33 (#7293) @dependabot

## [v6.0.3](https://github.com/growilabs/growi/compare/v6.0.2...v6.0.3) - 2023-01-24

### 💎 Features

- feat: GROWI to GROWI transfer (#6727) @hakumizuki
- feat: Use configured xss custom whitelist (#7252) @miya
- imprv: UI admin g2g transfer advanced options (#7261) @hakumizuki

### 🚀 Improvement

- imprv: Do not retrieve page data using API in shared page (#7240) @miya
- imprv: Use CSS variables (#7093) @yuki-takei
- imprv: Do not request /pages.getPageTag when on a shared page (#7214) @miya

### 🐛 Bug Fixes

- fix: Share link management button is not available (#7286) @yuki-takei
- fix: Color for blinked section (#7287) @ayaka0417
- fix: Error toaster appears after renaming (#7276) @miya
- fix: Search Tag From Tag Sidebar Correctly (#7282) @yukendev
- fix: Ignore backslash in page path (#7284) @yuki-takei
- fix: Bug in Page Tree Selected Item Background Color (#7272) @yukendev
- fix: Type guard comment.createdAt (#7281) @hakumizuki
- fix: Color of login form (#7275) @ayaka0417
- fix: Body of shared page is not displayed (#7270) @miya
- fix: Refactor uri decoding in getServerSideProps (#7268) @yukendev
- fix: Cannot login with LDAP unless local strategy is enabled (#7259) @miya
- fix: Skeleton color (#7264) @ayaka0417
- fix: Refactor axios date serializer config (#7249) @yukendev
- fix: DeletePageModal shows an incorrect label when open (#7224) @yukendev
- fix: Page path is not displayed in browser tab on shared page (#7243) @miya
- fix: Lsx encode prefix twice (#7239) @yuki-takei
- fix: Initial value of the page grant respects the parent page's one (#7232) @yukendev

### 🧰 Maintenance

- support: Build container images with AWS CodeBuild (#7258) @yuki-takei

## [v6.0.2](https://github.com/growilabs/growi/compare/v6.0.1...v6.0.2) - 2023-01-10

### 🐛 Bug Fixes

- fix: Attaching page title as initial header section (#7228) @yukendev
- fix: Update PageTree data after saving page (#7227) @yukendev
- fix: Lsx "filter" and "except" options does not work (#7226) @yuki-takei
- fix: Omit remark-growi-directive shortcuts (#7225) @yuki-takei

### 🧰 Maintenance

- ci(deps-dev): bump textlint-rule-no-doubled-joshi from 4.0.0 to 4.0.1 (#7222) @dependabot

## [v6.0.1](https://github.com/growilabs/growi/compare/v6.0.0...v6.0.1) - 2023-01-07

### 🚀 Improvement

- imprv: Reduce frequent API calling by SWR (#7218) @yuki-takei
- imprv: Do not use api for fetching pages when using shared pages (#7213) @miya

### 🐛 Bug Fixes

- fix: Custom logo not displayed on shared page (#7205) @miya
- fix: Attach i18n User Setting and TagEditModal (#7216) @jam411
- fix: Make PLANTUML_URI v5.x compatible (#7215) @yuki-takei
- fix: Launch with PROMSTER_ENABLED=true failed (#7210) @yuki-takei
- fix: Lsx performs with strange behavior (#7209) @yuki-takei

### 🧰 Maintenance

- support: Arm architecture (#7212) @yuki-takei
- ci(deps): bump anothrNick/github-tag-action from 1.38.0 to 1.56.0 (#7195) @dependabot
- ci(deps): bump google-github-actions/setup-gcloud from 0 to 1 (#7193) @dependabot
- ci(deps): bump github/codeql-action from 1 to 2 (#7194) @dependabot
- ci(deps): bump flat from 5.0.0 to 5.0.2 (#7200) @dependabot
- ci(deps): bump json5 from 1.0.1 to 1.0.2 (#7201) @dependabot
- ci(Mergify): configuration update (#7202) @yuki-takei
- support: Uninstall swig-template (#7192) @yuki-takei

## [v6.0.0](https://github.com/growilabs/growi/compare/v5.1.8...v6.0.0) - 2022-12-27

### 💎 Features

- feat: Apply Next.js
- feat: New plugin (#7034) @yuki-takei
- feat: Save prevent xss custom settings in new format (#7124) @miya

### 🧰 Maintenance

- support: Request scoped SWR (#6742) @yuki-takei
- support: Build preset themes within external package (#7057) @yuki-takei

## [v5.1.8](https://github.com/growilabs/growi/compare/v5.1.7...v5.1.8) - 2022-11-17

### 🐛 Bug Fixes

- fix: Put back page from trash (#6835) @yukendev
- fix: Updating page content width is not working (#6914) @yukendev
- fix: Create page at installer (#6930) @hakumizuki @yuki-takei

## [v5.1.7](https://github.com/growilabs/growi/compare/v5.1.6...v5.1.7) - 2022-10-26

### 🐛 Bug Fixes

- fix: Page move event notification message (#6823) @hakumizuki

## [v5.1.6](https://github.com/growilabs/growi/compare/v5.1.5...v5.1.6) - 2022-10-19

### 🐛 Bug Fixes

- fix: image not showing and exceed crop modal area (#6712) @mudana-grune
- fix: Conflict Diff Modal Error getCurrentOptionsToSave is not a function (#6745) @kaoritokashiki

## [v5.1.5](https://github.com/growilabs/growi/compare/v5.1.4...v5.1.5) - 2022-10-04

### 💎 Features

- feat: Add option to not use crop modal on brand logo upload (#6677) @Yohei-Shiina

### 🚀 Improvement

- imprv: Emoji picker performance for v5.x (#6689) @hakumizuki

### 🐛 Bug Fixes

- fix(auditlog): Attachment download is displayed even if the filter is unchecked (#6688) @miya
- fix: firstName and lastName japanese translations in SAML  (#6631) @kaoritokashiki

## [v5.1.4](https://github.com/growilabs/growi/compare/v5.1.3...v5.1.4) - 2022-09-12

### 💎 Features

- feat:  Truncate long path when recent changes is in S size (#6263) @mudana-grune
- feat: In-app notifications when removing descendants of subscribed pages (#6192) @Shunm634-source
- feat: Not increment ordered list number in CodeMirror (#6462) @mudana-grune

### 🚀 Improvement

- imprv: Added page URL to mail subject (#6554) @hakumizuki

### 🐛 Bug Fixes

- fix: Cannot update user group without parent (#6530) @kaoritokashiki
- fix: Make PageTree input not draggable when editting (#6525) @hakumizuki
- fix: Pagetree input hit enter (#6526) @hakumizuki
- fix: Disallow retrieval of revision data that does not match the page (#6537) @miya

## [v5.1.3](https://github.com/growilabs/growi/compare/v5.1.2...v5.1.3) - 2022-08-28

### 💎 Features

- feat(auditlog): Copy URL of the table (#6421) @miya

### 🚀 Improvement

- imprv(auditlog): Activity paging UI (#6444) @miya
- imprv: Improvement behavior when click on drawio diagram. (#6486) @kaishuu0123

### 🐛 Bug Fixes

- fix: Label of alert when updating tags (#6478) @miya
- fix: Uploading image using shortcut key(ctrl+v) shows toastError (#6474) @Yohei-Shiina
- fix: Pager is not displayed (#6468) @miya

### 🧰 Maintenance

- support: Use vscode-stylelint (#6430) @yuki-takei

## [v5.1.2](https://github.com/growilabs/growi/compare/v5.1.1...v5.1.2) - 2022-08-03

### 💎 Features

- feat: Make content width of each page configurable (#6107) @mudana-grune

### 🚀 Improvement

- imprv(auditlog): Clear and reload button (#6398) @miya
- imprv(auditlog): Date Range Picker  (#6395) @miya

### 🐛 Bug Fixes

- fix: MathJax rendering (#6396) @yuki-takei

### 🧰 Maintenance

- support: Make Editor component Functional Component and TypeScript (#6374) @yukendev

## [v5.1.1](https://github.com/growilabs/growi/compare/v5.1.0...v5.1.1) - 2022-08-01

### 💎 Features

- feat: Users can set users per ip from env var at API Rate Limit  (#6379) @yukendev
- feat: Show user picture in Audit Log (#6342) @miya
- feat: Reset search criteria button (#6327) @miya

### 🚀 Improvement

- imprv(auditlog): Display number of actions that can be saved (#6353) @miya
- imprv(auditlog): Include delete-related actions in small group (#6351) @miya

### 🐛 Bug Fixes

- fix: Default markdown linker with relative path does not respect the current page path (v5.1.0) (#6378) @yuki-takei
- fix: Recover page path operation (#6368) @hakumizuki
- fix: Migration script for inserting NamedQuery (#6364) @yuki-takei
- fix: "Error: cannnot get grant label" occured with lsx (#6348) @yukendev

## [v5.1.0](https://github.com/growilabs/growi/compare/v5.0.11...v5.1.0) - 2022-07-21

### 💎 Features

- feat: Custom brand logo image (#5709) @mudana-grune
- feat: Rate Limit by rate-limit-flexible (#6053) @yukendev
- feat: Audit Log (#5915) @miya

### 🚀 Improvement

- imprv: Prevent XSS with React (#6274) @yuki-takei
- imprv: Reflect tmp tag data (#6124) @kaoritokashiki
- imprv: Update subscribe button icon on Navbar (#6213) @jam411
- imprv: Event emittion by socket.io is triggered only when ES reindexing (#6077) @hirokei-camel

### 🐛 Bug Fixes

- fix: Drawio rendering (#6275) @hakumizuki
- fix: Blink section header on init (#6249) @yuki-takei
- fix: Error when trying login with an email that contains plus sign (#6232) @miya
- fix: Use APIv3 for api get check_username (#6226) @kaoritokashiki
- fix: Slack integration connection test (#6201) @yukendev
- fix: Not found page for `/${ObjectId like string}` path (#6208) @yuki-takei

### 🧰 Maintenance

- support: Refactor PageInfo types (#6283) @yuki-takei
- support: Refactor growi renderer using hooks 2 (#6237) @yuki-takei
- support: Refactor growi renderer using hooks (#6223) @hakumizuki
- imprv: Omit Personal Container (#6182) @kaoritokashiki

## [v5.0.11](https://github.com/growilabs/growi/compare/v5.0.10...v5.0.11) - 2022-07-05

### 💎 Features

- feat: Integrate recount descendant count after paths fix (#6170) @Yohei-Shiina

### 🚀 Improvement

- imprv: Redirect when the anchor is #password (#6144) @Kami-jo

### 🐛 Bug Fixes

- fix: User registration page is not redirected after tmp login (#6197) @kaoritokashiki
- fix: Empty trash doesn't work (#6168) @yukendev

### 🧰 Maintenance

- support: Ease rate limit temporary (#6191) @yuki-takei
- support: Omit page history container and page revision comparer container (#6185) @yukendev

## [v5.0.10](https://github.com/growilabs/growi/compare/v5.0.9...v5.0.10) - 2022-06-27

### 💎 Features

- feat: Sidebar default mode settings (#6111) @yukendev
- feat: Get GCS instance that uses Application Default Credentials for v5 (#6051) @Yohei-Shiina
- feat: Resume rename on server boot (#5862)(#6014) @Yohei-Shiina
- feat: Show page item control menu on empty page (#6070)(#6103) @Yohei-Shiina

### 🚀 Improvement

- imprv: Show page control on subnavigation at existing empty page  (#5638) @Yohei-Shiina
- imprv: Remove toc and page authors in empty page (#5661) @Yohei-Shiina
- imprv: SWRize apiGet /tag.search (#6062) @kaoritokashiki

### 🐛 Bug Fixes

- fix: Scrolling preview (#6148) @yuki-takei
- fix: Show page history comparation modal on init (#6072) @hirokei-camel
- fix: Ensure backword compatibility for ES6 when using max_analyzed_offset (#6121) @hakumizuki
- fix: Set max_analyzed_offset to elasticsearch querying options (#6115) @hakumizuki
- fix: Revision err when updating tags (#6073) @kaoritokashiki
- fix: Support 3 types of syntax for OpenID Connect Issuer Host (#6061) @mudana-grune

### 🧰 Maintenance

- support: Omit comment container (#6147) @yuki-takei
- support: Upgrade typescript to ^4.6.0 (#6082) @hakumizuki

## [v5.0.9](https://github.com/growilabs/growi/compare/v5.0.8...v5.0.9) - 2022-06-13

### 🚀 Improvement

- imprv: Render MathJax in Preview tab of comment (#6025) @yuki-takei
- imprv: Exception handling for user authentication (#6019) @kaoritokashiki
- imprv: Sidebar background color on light theme and add shadow on dark theme (#6012) @shukmos
- imprv: Limit display of notification paths (#5991) @jam411

### 🐛 Bug Fixes

- fix: Getting page API is broken (#6023) @yuki-takei
- fix: MathJax does not working (#6020) @yuki-takei

## [v5.0.8](https://github.com/growilabs/growi/compare/v5.0.7...v5.0.8) - 2022-06-07

### 🚀 Improvement

- imprv: Fix subnavigation spacing (#5995) @yuki-takei
- imprv: Set Content-Length header in response of attachment (#5972) @hiroki-hgs
- imprv: Fix sidebar tag layout (#5984) @jam411
- imprv: PageStatusAlert labels when data is outdated (#5961) @yuki-takei
- imprv: Delete NotFoundAlert from not found page (#5919) @Shunm634-source

### 🐛 Bug Fixes

- fix: Too many footstamps icons are shown by lsx output 3 (#6000) @yuki-takei
- fix: Adjust PageItemControl alignment (#5994) @yuki-takei
- fix: CodeMirror placeholder color (#5993) @yuki-takei
- fix: Chinese notation is broken on create new page modal (#5973) @jam411
- fix: Document timestamps does not updated (#5979) @yuki-takei
- fix: Slack channels are not automatically filled after setting up user trigger notification on v5.0.x (#5911) @kaoritokashiki
- fix: Login required when viewing sharelink page (#5959) @yuki-takei
- fix: Editor scroll sync by Preview scrolling does not work (#5949) @yuki-takei

### 🧰 Maintenance

- support: Enable garbage collection at runtime with expose-gc package (#5986) @yuki-takei
- support: Upgrade aws-sdk to v3 (#5863) @mudana-grune

## [v4.5.22](https://github.com/growilabs/growi/compare/v4.5.21...v4.5.22) - 2022-06-07

### 🐛 Bug Fixes

- fix: Fixed the bug of auto-filling unintended values into the Email field of the User settings (#5885) @Shunm634-source
- fix: google-oauth2 Automatically bind external accounts does not work (#5891) @kaoritokashiki
- fix: Slack channels are not automatically filled after setting up user trigger notification (#5976) @kaoritokashiki

### 🧰 Maintenance

- support: Enable garbage collection at runtime with expose-gc package (#5998) @kaoritokashiki

## [v5.0.7](https://github.com/growilabs/growi/compare/v5.0.6...v5.0.7) - 2022-05-30

### 💎 Features

- feat: Set the min length of passwords by environment variable (#5899) @Shunm634-source
- feat: API to find username (#5907) @miya

### 🐛 Bug Fixes

- fix: Page is not rendered for guest (#5930) @yuki-takei
- fix: Server error due to the canDeleteLogic method (#5927) @hakumizuki
- fix: Show pagename on toastr when page deleted (#5772) @hirokei-camel
- fix: Search result screen is broken under content 100% setting (#5917) @jam411

## [v5.0.6](https://github.com/growilabs/growi/compare/v5.0.5...v5.0.6) - 2022-05-27

### 💎 Features

- feat: Emoji - replace emojione to emojimart (#5668) @kaoritokashiki
- feat: Show username suggestion for mention in comment (#5856) @mudana-grune
- feat: Send in-app notification when containing username mention in comment  (#5906) @mudana-grune
- feat: Customize menu in navbar for guest user (#5858) @yukendev
- feat: Admin only page convert by path (#5902) @hakumizuki
- feat: Fix grant alert (#5903) @hakumizuki

### 🚀 Improvement

- imprv: Automatic login after registration (#5860) @hiroki-hgs
- imprv: Add tooltip to SubNavButtons (#5887) @miya
- imprv: Mixin of argument-of-override-list-group-item-for-pagetree for dark theme (#5904) @shukmos
- imprv: Move code to the appropriate place for fix browser auto-complete email wiith username (#5892) @Yohei-Shiina
- imprv: Initial rendering when opening Custom Sidebar (#5880) @Kami-jo
- imprv: Add contributors to staff credit (#5841) @hiroki-hgs

### 🐛 Bug Fixes

- fix: Can not toggle textlint function on v5.0.x (#5854) @kaoritokashiki
- fix(google-oauth2): Automatically bind external accounts  does not work on v5.0.x (#5886) @kaoritokashiki

## [v4.5.21](https://github.com/growilabs/growi/compare/v4.5.20...v4.5.21) - 2022-05-23

### 🐛 Bug Fixes

- fix: Can not toggle textlint function on v4.5.x (https://github.com/growilabs/growi/pull/5855) @kaoritokashiki
- fix: Error on searching (https://github.com/growilabs/growi/pull/5873) @miya

## [v5.0.5](https://github.com/growilabs/growi/compare/v5.0.4...v5.0.5) - 2022-05-16

### 💎 Features

- feat: Empty trash button in trash page (#5816) @yukendev

### 🚀 Improvement

- imprv: Count badge colors (#5835) @shukmos
- imprv: List group background colors on PageTree (#5812) @shukmos
- imprv: Page path auto complete function for page rename modal (#5805) @kaoritokashiki
- imprv: Show toastr when converting is completed on Private Legacy Page (#5810) @yukendev
- imprv: Create parent pages as needed by path that includes slash (#5809) @kaoritokashiki

### 🐛 Bug Fixes

- fix: Change the execution user of the official docker image to root (#5846) @yuki-takei
- fix: Display admin link only with logged in (#5799) @hirokei-camel
- fix: Error when renaming (#5793) @miya

### 🧰 Maintenance

- support: Typescriptize tag model (#5778) @kaoritokashiki

## [v4.5.20](https://github.com/growilabs/growi/compare/v4.5.19...v4.5.20) - 2022-05-12

### 🐛 Bug Fixes

- fix: Guest user cannot access share link pages (#5819) @kaoritokashiki

## [v5.0.4](https://github.com/growilabs/growi/compare/v5.0.3...v5.0.4) - 2022-04-28

### 💎 Features

- feat: Private legacy pages convert by path (#5787) @hakumizuki
- feat: Generate activity when page is created (#5765) @miya
- feat: Private legacy pages convert by path API (#5760) @hakumizuki
- feat:  Create notification when page is reverted (#5756) @miya
- feat: Create notification when page is duplicated (#5749) @miya
- feat: Add count badge to Page List button and Comment button (#5740) @yukendev
- feat: Infinite scroll for Recent Changes in Sidebar (#5647) @mudana-grune

### 🚀 Improvement

- imprv: Change GET method to POST for logout operation (#5751) @kaoritokashiki
- imprv: Redesign tags (#5730) @miya
- imprv: i18n for already_exists error in PutBackPageModal (#5747) @kaoritokashiki

### 🐛 Bug Fixes

- fix: Default markdown linker with relative path does not respect the current page path (#5788) @yuki-takei
- fix: Include any public pages as applicable ancestors (#5786) @hakumizuki
- fix: Not create unnecessary empty pages when ancestors are public (#5774) @hakumizuki
- fix: Too many footstamps icons are shown by lsx output 2 (#5763) @yuki-takei
- fix:  footstamp-icon size (#5759) @kaoritokashiki

## [v4.5.19](https://github.com/growilabs/growi/compare/v4.5.18...v4.5.19) - 2022-04-28

### 🐛 Bug Fixes

- fix: Swiping to previous/next page for Mac users (4.5.x) (#5758) @hirokei-camel
- fix: Get attachment list api without "page" parameter returns 500 response (#5726) @miya

## [v5.0.3](https://github.com/growilabs/growi/compare/v5.0.2...v5.0.3) - 2022-04-21

### 💎 Features

- feat: Search on private legacy pages (#5723) @hakumizuki

### 🚀 Improvement

- imprv: Dark theme color optimization (#5737) @shukmos
- imprv: Change the order of menu items (#5722) @miya

### 🐛 Bug Fixes

- fix: Get attachment list api without "page" parameter returns 500 response (#5726) @miya
- fix: New user notification email is also sent TO: deleted_at_<epoch_time>@deleted (#5735) @yuki-takei
- fix: Too many footstamps icons are shown by lsx output (#5727) @yuki-takei

## [v5.0.2](https://github.com/growilabs/growi/compare/v5.0.1...v5.0.2) - 2022-04-15

### 🐛 Bug Fixes

- fix: Edit button to open built-in editor does not work when HackMD is disabled (#5719) @yuki-takei
- fix: Share link list occures error when related page is not found (#5718) @yuki-takei

## [v5.0.1](https://github.com/growilabs/growi/compare/v5.0.0...v5.0.1) - 2022-04-15

### 💎 Features

- feat: Input Slack member ID (#5412) @mudana-grune
- feat: Remove child group from parent group (#5600) @miya

### 🚀 Improvement

- imprv: Add spinner to tag sidebar (#5700) @miya
- imprv: Adjust pagelist and comment position (#5682) @Yohei-Shiina
- imprv: Adjust layout for PageTree Descendant Count (#5666) @miya
- imprv: adjust spaces in page item control and subnav btn (#5655) @Yohei-Shiina
- imprv: Clickable area of PageListItemL (#5665) @yuki-takei
- imprv: Add an expiration date for the link in the email (#5660) @miya
- imprv: remove min-width from search-sort-option-btn (#5656) @kaoritokashiki

### 🐛 Bug Fixes

- fix: Correction of expiredAt attached to email (#5715) @miya
- fix: Normalize parent so it does not include siblings (#5678) @hakumizuki
- fix: Prevent auto completing email with username stored by browser in /me page (#5702) @Yohei-Shiina
- fix: Do not include granted users if change page permission restricted (#5693) @miya
- fix: Do not include in search results if the page grant is restricted (#5691) @miya
- fix: Password reset gives error update password failed when submitting a new password (#5685) @kaoritokashiki
- fix: Cannot register new users (#5683) @kaoritokashiki
- fix: Sync change of count for both like and bookmark in search page (#5667) @Yohei-Shiina
- imprv: Adjust layout for PageTree Descendant Count (#5666) @miya
- fix: HackMD disabled tooltip on mobile (#5658) @yuki-takei
- fix: One Time Token is not available (#5654) @miya
- fix: Page items disappear when dnd (#5651) @miya

### 🧰 Maintenance

- ci(deps): bump anothrNick/github-tag-action from 1.36.0 to 1.38.0 (#5271) @dependabot
- ci(deps): bump amannn/action-semantic-pull-request from 3.4.5 to 4.2.0 (#5627) @dependabot
- ci(deps): bump actions/upload-artifact from 2 to 3 (#5686) @dependabot
- ci(deps): bump actions/download-artifact from 2 to 3 (#5687) @dependabot
- support: Migration for setting sparce option to slack member id (#5694) @kaoritokashiki
- support: Update eslint-config-weseek (#5673) @yuki-takei

## [v4.5.18](https://github.com/growilabs/growi/compare/v4.5.17...v4.5.18) - 2022-04-15

### 🐛 Bug Fixes

- fix: One Time Token is not available for v4.5.x (#5713) @miya
- fix: Prevent auto completing email with username stored by browser in /me page for v4.5.x (#5703) @Yohei-Shiina
- fix: Page view count stops at 15 (#5705) @miya

## [v4.5.17](https://github.com/growilabs/growi/compare/v4.5.16...v4.5.17) - 2022-04-07

### 🐛 Bug Fixes

- fix: Elasticsearch doesn't work properly on production (#5676) @Yohei-Shiina

## [v4.5.16](https://github.com/growilabs/growi/compare/v4.5.15...v4.5.16) - 2022-04-06

### 💎 Features

- feat: Support Elasticsearch 7 (#5613) @Yohei-Shiina

### 🐛 Bug Fixes

- fix: Domain whitelist is not respected (fix #5408) (#5488) @yuto-oweseek
- fix: Add tags to pages restricted by specified groups on View mode (for v4.5.x) (#5487) @yuto-oweseek

## [v5.0.0](https://github.com/growilabs/growi/compare/v4.5.15...v5.0.0) - 2022-04-01

### 💎 Features

- feat: Support Elasticsearch 7 (#5080) @yuki-takei
- feat: Elasticsearch reindex on boot (#5149) @LuqmanHakim-Grune
- feat: PageTree and re-impl SearchResult with list group (#5286) @yuki-takei
- feat: Rename(Move) by Drag & Drop (#5292) @hakumizuki
- feat: Maintenance mode (#5486) @hakumizuki
- feat: Delete permission config (#5527) @hakumizuki

### 🚀 Improvement

- imprv: Show comments in search page result (#5645) @yuki-takei
- imprv: Add description for user addition (#5614) @hakumizuki
- imprv: Validate deletion settings (#5581) @hakumizuki

### 🐛 Bug Fixes

- fix: Swiping to previous/next page for Mac users (5.0.x) (#5491) @hakumizuki
- fix: Guest User Access Dropdown shows wrong value (#5643) @miya
- fix: Show full text on presentation mode (#5636) @hakumizuki
- fix: Displaying minimum length of password (#5630) @Yohei-Shiina
- fix: Domain whitelist is not respected (fix #5408) (#5470) @yuto-oweseek
- fix: Add tags to pages restricted by specified groups on View mode (#5457) @yuto-oweseek

### 🧰 Maintenance

- ci(deps-dev): bump plantuml-encoder from 1.2.5 to 1.4.0 (#5633) @dependabot
- ci(deps-dev): bump codemirror from 5.63.0 to 5.64.0 (#4777) @dependabot
- ci(deps): bump nanoid from 3.1.30 to 3.2.0 (#5142) @dependabot
- support: Upgrade openid client (#5185) @mudana-grune
- ci(deps): bump amannn/action-semantic-pull-request from 3.4.2 to 3.4.5 (#4559) @dependabot
- ci(deps): bump extend from 3.0.1 to 3.0.2 (#5222) @dependabot
- ci(deps-dev): bump jquery-ui from 1.12.1 to 1.13.0 (#4548) @dependabot
- ci(deps): bump actions/setup-node from 2 to 3 (#5437) @dependabot
- ci(deps): bump actions/checkout from 2 to 3 (#5462) @dependabot
- ci(deps): bump peter-evans/dockerhub-description from 2 to 3 (#5615) @dependabot
- ci(deps): bump actions/cache from 2 to 3 (#5584) @dependabot
- ci(deps-dev): bump reveal.js from 3.6.0 to 4.3.1 (#5603) @dependabot
- support: Update yarn git-hosted-info v2.8.8 to v2.8.9 (#5215) @LuqmanHakim-Grune
- support: dependabot trim-off-newlines (#5336) @mudana-grune
- support: dependabot @npmcli/git (#5337) @mudana-grune
- support: dependabot highlight.js (#5352) @mudana-grune
- support: dependabot extend (#5335) @mudana-grune
- support: dependabot ajv (#5333) @mudana-grune
- support: dependabot dot-drop (#5204) @LuqmanHakim-Grune
- support: update nanoid yarn.lock v3.1.30 to v3.2.0 (#5216) @LuqmanHakim-Grune
- support: update validator version (#5562) @LuqmanHakim-Grune

## [v4.5.15](https://github.com/growilabs/growi/compare/v4.5.14...v4.5.15) - 2022-02-17

### 🚀 Improvement

- imprv: Hide forgot password when localstrategy is disabled (#5380) @yuki-takei

### 🐛 Bug Fixes

- fix: The condition to attempt to reconnect to Elasticsearch (#5344) @yuki-takei
- fix: Highlight-addons and drawio-viewer for view missing (#5376) @yuki-takei

### 🧰 Maintenance

- support:  modify docker-compose indent (#5322) @yuto-oweseek

## [v4.5.14](https://github.com/growilabs/growi/compare/v4.5.13...v4.5.14) - 2022-02-10

### 💎 Features

- feat: OGP in public wiki (#5304) @yuto-oweseek

## [v4.5.13](https://github.com/growilabs/growi/compare/v4.5.12...v4.5.13) - 2022-02-08

### 🐛 Bug Fixes

- fix: fix: Sidebar collapsing (#5283) @yuki-takei

## [v4.5.12](https://github.com/growilabs/growi/compare/v4.5.11...v4.5.12) - 2022-02-01

### 🚀 Improvement

- imprv: Sidebar opening delay (for v4.5.x) (#5218) @yuki-takei

### 🐛 Bug Fixes

- fix: /_api/v3/page with pageId param occurs an 500 error (#5212) @yuki-takei
- fix: Resolving OIDC issure host (#5220) @yuki-takei

## [v4.5.11](https://github.com/growilabs/growi/compare/v4.5.10...v4.5.11) - 2022-01-26

### 🐛 Bug Fixes

- fix: Internal server error occured when "Restrict complete deletion of pages" option's value is "Admin and author" (#5175 ) @yuki-takei

## [v4.5.10](https://github.com/growilabs/growi/compare/v4.5.9...v4.5.10) - 2022-01-26

### 💎 Features

- feat: Automatic installation (#5141) @yuki-takei

### 🚀 Improvement

- imprv: Migrate like states to swr (#5137) @miya

### 🐛 Bug Fixes

- fix: 86631-cannot-reset-password-in-case-that-register-limitation-is-Closed (#5155) @kaoritokashiki

### 🧰 Maintenance

- support: VRT with Cypress (#5030) @yuki-takei

## [v4.5.9](https://github.com/growilabs/growi/compare/v4.5.8...v4.5.9) - 2022-01-21

### 🚀 Improvement

- imprv: 79291 make password min length 8 charactors (#5116) @kaoritokashiki

### 🐛 Bug Fixes

- fix: OIDC reconnection bug fix (#5104) @mudana-grune
- fix: /_api/v3/page is broken and dump 500 error "get-page-failed TypeError: user.canDeleteCompletely is not a function" (#5103) @yuki-takei
- fix: Default completely deletion settings label mismatched against to actual (#5102) @yuki-takei
- fix: OIDC issuer host availability check (#5099) @mudana-grune

### 🧰 Maintenance

- support: Improve multistage build (#5090) @yuki-takei
- support: Omit node-re2 (#5089) @yuki-takei
- ci(deps-dev): bump swr from 1.0.1 to 1.1.2 (#5018) @dependabot

## [v4.5.8](https://github.com/growilabs/growi/compare/v4.5.7...v4.5.8) - 2022-01-12

### 💎 Features

- feat: Display a list of bookmarked users (#5044) @miya

### 🐛 Bug Fixes

- fix: Built-in editor scroll position is reset after save (Introduced by v4.5.3) (#5074) @yuki-takei

### 🧰 Maintenance

- support: Bump y18n to v4.0.3 (#5071) @yuki-takei
- support: Omit prettier-stylelint (#5070) @yuki-takei
- support: Bump tar to 6.1.11 (#5069) @yuki-takei

## [v4.5.7](https://github.com/growilabs/growi/compare/v4.5.6...v4.5.7) - 2022-01-11

### 🐛 Bug Fixes

- fix: Subnavigation sticking initialization (#5062) @yuki-takei
- fix: Built-in editor was broken (#5061) @yuki-takei

### 🧰 Maintenance

- support: Bump re2 to 1.17.2 (#5059) @yuki-takei

## [v4.5.6](https://github.com/growilabs/growi/compare/v4.5.5...v4.5.6) - 2022-01-07

### 💎 Features

- feat: Resolve conflict with 3-way merge like editor (#5012) @yuto-oweseek

### 🚀 Improvement

- imprv: Subnavigation behavior (#5047) @yuki-takei
- imprv: Switching editor mode behavior (#5043) @yuki-takei

### 🐛 Bug Fixes

- Bug: Error: The specified instance couldn't register because same id has already been registered (#5031) by #5043 @yuki-takei

## [v4.5.5](https://github.com/growilabs/growi/compare/v4.5.4...v4.5.5) - 2022-01-05

### 💎 Features

- feat: OIDC reconnection (#5016) @mudana-grune
- feat: In-App Notification (#4792) @kaoritokashiki

### 🚀 Improvement

- imprv: Improve tags functions (#5001) @yuto-oweseek
- imprv: Migrate editor container grant to SWR (#4957) @stevenfukase

### 🐛 Bug Fixes

- Bug: Error: The specified instance couldn't register because same id has already been registered (#5031) by 573216c @yuki-takei

### 🧰 Maintenance

- fix: dependabot alert trim-newlines (#4931) @mudana-grune
- fix: dependabot alert dot-prop (#4921) @mudana-grune
- ci(deps-dev): bump tsconfig-paths-webpack-plugin from 3.5.1 to 3.5.2 (#4852) @dependabot
- ci(deps): bump ua-parser-js from 0.7.17 to 0.7.31 (#4895) @dependabot
- support: dependabot alert ssri (#4973) @mudana-grune

## [v4.5.4](https://github.com/growilabs/growi/compare/v4.5.3...v4.5.4) - 2021-12-23

### 💎 Features

- feat: Hotkey to focus to search (#5006) @yuki-takei

### 🚀 Improvement

- imprv: Omit magnifier icon from global SearchTypeahead (#5005) @yuki-takei
- imprv: Focus to input when resetting SearchTypeahead (#5003) @yuki-takei
- imprv: Make updatedAt SWR (#4954) @kaoritokashiki
- imprv: Make createdAt SWR (#4819) @kaoritokashiki
- imprv: Performance optimization for large drawio diagrams (#4221) @kaishuu0123

### 🐛 Bug Fixes

- fix: Sidebar height is a little large (#4988) @yuki-takei

### 🧰 Maintenance

- imprv: Focus to input when resetting SearchTypeahead (#5003) @yuki-takei
- support: Typescriptize search components (#4982) @yuki-takei
- fix:  dependabot alert object-path (#4964) @mudana-grune
- fix: dependabot alert axios (#4960) @mudana-grune
- fix: dependabot alert elliptic (#4959) @mudana-grune
- fix: dependabot alert acorn (#4951) @mudana-grune
- fix: dependabot alert is-svg (#4937) @mudana-grune
- fix: dependabot alert socket.io-parser (#4934) @mudana-grune
- fix: dependabot alert serialize-javascript (#4910) @mudana-grune
- fix: dependabot alert js-yaml (#4906) @mudana-grune
- ci(deps): bump ws from 7.5.1 to 8.3.0 (#4728) @dependabot
- support: omit growi-commons (#4938) @yuki-takei

## [v4.5.3](https://github.com/growilabs/growi/compare/v4.5.2...v4.5.3) - 2021-12-17

### 💎 Features

- feat: user activation by email (#4862) @kaoritokashiki

### 🚀 Improvement

- imprv: Use SWR for isSlackEnabled (#4827) @stevenfukase
- imprv: Disable rubber band scroll for Mac & iOS users (#4834) @hakumizuki
- imprv: Omit atlaskit and implement sidebar only with original codes (#4598) @yuki-takei

### 🐛 Bug Fixes

- fix: GROWI Bot search command after transplanting search service from dev/5.0.x (#4916) @hakumizuki
- fix: Set min-height to sidebar scroll target (#4884) @yuki-takei

### 🧰 Maintenance

- support: fix dependabot alert for kind-of (#4891) @LuqmanHakim-Grune
- support: fix dependabot alert for ini (#4892) @LuqmanHakim-Grune
- support: fix and debug mixin-deep dependabot alert (#4867) @LuqmanHakim-Grune
- support: dependabot alert xmlhttprequest-ssl (#4878) @mudana-grune
- support: Transplant search service from dev/5.0.x (#4869) @hakumizuki
- support: dependabot alert set-value (#4864) @LuqmanHakim-Grune
- ci(deps): bump aws-sdk from 2.179.0 to 2.1044.0 (#4821) @dependabot

## [v4.5.2](https://github.com/growilabs/growi/compare/v4.5.1...v4.5.2) - 2021-12-06

### 🐛 Bug Fixes

- fix: Added scope for unfurl (#4811) @hakumizuki

## [v4.5.1](https://github.com/growilabs/growi/compare/v4.5.0...v4.5.1) - 2021-12-06

### 🐛 Bug Fixes

- fix: /admin/slack-integration page dump undefined error (#4806) @yuki-takei

## [v4.5.0](https://github.com/growilabs/growi/compare/v4.4.13...v4.5.0) - 2021-12-06

### BREAKING CHANGES

- imprv: APIv3 payload (#4770) @LuqmanHakim-Grune

### 💎 Features

- feat: Slackbot unfurl (#4720) @hakumizuki

### 🚀 Improvement

- imprv: APIv3 payload (#4770) @LuqmanHakim-Grune
- imprv: upgrade passport from v0.4.x to v0.5.x (#4727) @mudana-grune
- imprv: Show site url in unfurl footer (#4755) @hakumizuki
- imprv: SWRize context (#4740) @hakumizuki
- imprv: Upgrade mongoose from 5.x to 6.x (#4659) @mudana-grune

### 🐛 Bug Fixes

- fix(slackbot-proxy): Support new API v3 data scheme (#4800) @yuki-takei
- fix(Slackbot): Slash commands response when sent from disabled channels (#4754) @stevenfukase

### 🧰 Maintenance

- ci(deps): bump detect-indent from 6.0.0 to 7.0.0 (#4635) @dependabot
- ci(deps): bump passport-saml from 2.2.0 to 3.2.0 (#4431) @dependabot

## [v4.4.13](https://github.com/growilabs/growi/compare/v4.4.12...v4.4.13) - 2021-11-19

### 💎 Features

- feat: Including comments in full text search (#4703) @kaoritokashiki

### 🐛 Bug Fixes

- fix(slackbot): Interactions from private channels not working (#4688) @stevenfukase

## [v4.4.12](https://github.com/growilabs/growi/compare/v4.4.11...v4.4.12) - 2021-11-15

### 🐛 Bug Fixes

- fix: Cannot use HackMD (#4667)

### 🧰 Maintenance

- ci(deps): Downgrade passport to 0.4.0 (#4669) @mudana-grune

## [v4.4.11](https://github.com/growilabs/growi/compare/v4.4.10...v4.4.11) - 2021-11-12

### 🚀 Improvement

- imprv: SAML settings by DB (#4656) @yuki-takei

### 🐛 Bug Fixes

- fix: Unescape Attribute-based Login Control field value (#4651) @haruhikonyan
- fix: Slack Integration 'note' command causes expired_trigger_id error (#4629) @stevenfukase
- fix: Timeline was broken (#4639) @yuki-takei

### 🧰 Maintenance

- support: Bump mpath with mongoose (#4638) @yuki-takei
- ci(deps): bump passport-oauth2 from 1.4.0 to 1.6.1 (#4599) @dependabot
- ci(deps): bump passport from 0.4.0 to 0.5.0 (#4582) @dependabot
- ci(deps): bump axios from 0.21.1 to 0.24.0 (#4604) @dependabot
- ci(deps): bump tar from 4.4.13 to 4.4.19 (#4601) @dependabot

## [v4.4.10](https://github.com/growilabs/growi/compare/v4.4.9...v4.4.10) - 2021-11-08

### 🚀 Improvement

- imprv: Sidebar content header style (#4526) @yuki-takei

### 🐛 Bug Fixes

- fix: /pages/info API is broken (#4602) @yuki-takei
- fix: blackboard theme location in theme list (#4506) @ayaka0417

### 🧰 Maintenance

- support: Use SWR (#4487) @yuki-takei
- support: Replaced PageList with SWR (#4498) @takayuki-t
- support: Improve devcontainer (#4510) @yuki-takei
- support: Update passport-ldpauth from ^2.0.0 to ^3.0.1 (#4578) @LuqmanHakim-Grune
- ci(deps): bump validator from 13.6.0 to 13.7.0 (#4588) @dependabot
- ci(deps-dev): bump stylelint from 13.2.0 to 14.0.1 (#4583) @dependabot
- Bump browserslist from 4.0.1 to 4.16.6 (#3776) @dependabot
- ci(deps-dev): bump colors from 1.2.5 to 1.4.0 (#4365) @dependabot
- ci(deps-dev): bump on-headers from 1.0.1 to 1.0.2 (#4366) @dependabot
- ci(deps-dev): bump jquery-ui from 1.12.1 to 1.13.0 (#4549) @dependabot
- docs(page): Add docs to /page/info api (#4531) @Mxchaeltrxn

## [v4.4.9](https://github.com/growilabs/growi/compare/v4.4.8...v4.4.9) - 2021-10-18

### 💎 Features

- feat: blackboard theme (#4501) @ayaka0417
- feat: jade-green theme (#4500) @ayaka0417
- feat: fire-red theme (#4499) @ayaka0417
- feat: Add user list for like button (#4346) @Mxchaeltrxn

### 🚀 Improvement

- imprv: GROWI slackbot help message (#4488) @hakumizuki

### 🐛 Bug Fixes

- fix: Migration update-mail-transmission (#4482) @yuki-takei

### 🧰 Maintenance

- support: Localize Copy bug report button (#4436) @AbiFirmandhani-Grune

## [v4.4.8](https://github.com/growilabs/growi/compare/v4.4.7...v4.4.8) - 2021-10-08

### 🚀 Improvement

- imprv: Permissions to operate comment (#4466) @yuki-takei
- imprv: Show modal when enabling Textlint (#4373) @stevenfukase
- imprv: Slackbot reaction to user (#4442) @yuki-takei

### 🐛 Bug Fixes

- fix: Redirected to apiv3 endpoint when guest mode is enabled (#4443) @stevenfukase
- fix: Unnecessary extra JSON.stringify for configurations for slackbot without proxy (#4467) @hakumizuki
- fix: Migration for slackbot configurations without proxy (#4465) @hakumizuki
- fix: Slackbot error/command handling (#4463) @hakumizuki
- fix(slackbot): Respond bad gateway error & improved help message (#4470) @hakumizuki
- fix(slackbot): Stop auto-join to channels with middlewarer (#4424) @yuki-takei

## [v4.4.7](https://github.com/growilabs/growi/compare/v4.4.6...v4.4.7) - 2021-09-29

### 🚀 Improvement

- imprv: Slackbot search (#4420) @yuki-takei
- imprv: Omit textlint-rule-en-capitalization (#4403) @yuki-takei
- imprv: Apply terminus for graceful shutdown (#4398) @yuki-takei

### 🐛 Bug Fixes

- fix: A problem that GROWI server doesn't retrieve connection status from Official bot proxy (#4416) @yuki-takei
- fix: Dictionary path of kuromoji invalid when uploaded to server (#4381) @stevenfukase
- fix: Copy correct dotenv file for NO_CDN docker image (#4397) @yuki-takei
- fix: Stop using ts-node in production (#4411) @yuki-takei
- fix: SAML setting says 'setup is not yet complete' even if setup properly (#4390) @nakashimaki
- fix: SidebarSmall button does not keep selection on reload (#4389) @nakashimaki
- fix: Migrations for updating data for slackbot (#4406) @yuki-takei
- fix: Migrations do not run in production (#4395) @yuki-takei
- fix: Migration file for mongodb 3.6 compatibility (#4413) @hakumizuki
- fix(slackbot): Sync permission when data stored is not enough (#4417) @yuki-takei

### 🧰 Maintenance

- support: Install Git LFS when provisioning of devcontainer (#4405) @stevenfukase
- chore: Add .dockerignore (#4396) @yuki-takei

## [v4.4.6](https://github.com/growilabs/growi/compare/v4.4.5...v4.4.6) - 2021-09-24

### 🚀 Improvement

- imprv: Slackbot response flow (#4296) @yuki-takei
- imprv(slackbot-proxy): Show version on the top page (#4342) @yuto-oweseek

### 🧰 Maintenance

- support(slackbot-proxy): Bump slackbot proxy version independentry (#4385) @yuki-takei

## [v4.4.5](https://github.com/growilabs/growi/compare/v4.4.4...v4.4.5) - 2021-09-23

### 🐛 Bug Fixes

- fix: Revert #4347
- fix: ERROR: Cannot find module 'tslib' on v4.4.4 (#4368) @yuki-takei

### 🧰 Maintenance

- support: bump @promster/express and @promster/server (#4370) @yuki-takei
- support: Upgrade codemirror to 5.63.0 (#4364) @yuki-takei
- ci(deps-dev): bump codemirror from 5.48.4 to 5.58.2 (#4363) @dependabot

## [v4.4.4](https://github.com/growilabs/growi/compare/v4.4.3...v4.4.4) (Discontinued) - 2021-09-22

### 💎 Features

- feat: Add Textlint support (#4228) @kaoritokashiki

### 🚀 Improvement

- imprv: Highlighting searching keyword (#4327) @yuki-takei

### 🐛 Bug Fixes

- fix: Backspace key on last line doesn't work in vim mode (#4347) @yuki-takei
- fix: Recent Created of home is empty (#4345) @yuki-takei
- fix: IME suggestion list obscures inputted text (#4335) @yuki-takei
- fix: Highlighting section header (#4326) @yuki-takei

### 🧰 Maintenance

- chore: Update passport-saml 2.2.0 (#4360) @LuqmanHakim-Grune
- ci(deps): bump http-errors from 1.6.2 to 1.8.0 (#4353) @dependabot
- ci(deps-dev): bump @tsed/json-mapper from 6.43.0 to 6.70.1 (#4352) @dependabot
- ci(deps): bump graceful-fs from 4.1.11 to 4.2.8 (#4351) @dependabot
- ci(deps): bump myrotvorets/info-from-package-json-action from 0.0.2 to 1.1.0 (#4348) @dependabot
- ci(deps): bump path-parse from 1.0.5 to 1.0.7 (#4126) @dependabot
- ci(deps): bump tmpl from 1.0.4 to 1.0.5 (#4337) @dependabot

## [v4.4.3](https://github.com/growilabs/growi/compare/v4.4.2...v4.4.3) - 2021-09-17

### 💎 Features

- feat: Slack command permission for each channel (#4302) @hakumizuki

### 🚀 Improvement

- imprv: Copy buttons interaction (#4303) @maow89126
- imprv: Use socket.io room (#4307) @hakumizuki
- imprv: Recent changes of sidebar (#4293) @kaho819

### 🐛 Bug Fixes

- fix: Response to slackbot when no pages are found /growi search (#4321) @stevenfukase
- fix: Keyword highlight styling in search result (#4312) @maow89126
- fix(slackbot-proxy): Call next in connect-styled middleware (#4286) @yuki-takei

### 🧰 Maintenance

- chore: Refactor for "Slack command permission for each channel" (#4295) @zahmis
- support: Update APIv3 docs for pages (#4280) @yuki-takei

## [v4.4.2](https://github.com/growilabs/growi/compare/v4.4.0...v4.4.2) - 2021-09-07

### Changes

- Release v4.4.1 (#4262) @github-actions

### 🐛 Bug Fixes

- fix: Plugin backend's permission (#4271) @yuki-takei

### 🧰 Maintenance

- support: Make lerna mode fixed (#4274) @yuki-takei
- support: Make lerna mode fixed (#4263) @yuki-takei

## v4.4.1 (Missing number)

## [v4.4.0](https://github.com/growilabs/growi/compare/v4.3.3...v4.4.0) (Discontinued) - 2021-09-06

### Changes

### BREAKING CHANGES

- Official plugins are now preinstalled
- It is no longer compatible with previous versions of official bots

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/44x.html](https://docs.growi.org/en/admin-guide/upgrading/44x.html)

### 💎 Features

- feat: Password resetting by users (#4135) @kaoritokashiki
- feat: Copy bug report btn (#4200) @Mxchaeltrxn
- Feature: User trigger notification and Global notification are available by new Slack integration

### 🚀 Improvement

- imprv: Add attachment button in editor navbar
- imprv: Modified with proxy app installation tutorial (#4174) @hakumizuki
- imprv: Slackbot proxy respone (#4194) @hakumizuki
- imprv: Slackbot proxy respone (#4175, #4201) @zahmis
- Imprv: Admin slack integration (#4190) @yuki-takei

### 🐛 Bug Fixes

- fix: Recursive rename operation from `/parent` to `/parent/child` (#4101) @miya
- fix: adminRequired middleware for socket.io (#4245) @yuki-takei
- fix: Encode spaces in page path in LinkEditModal

### 🧰 Maintenance

- support: Supress warnings for mongo (#4247) @yuki-takei
- support: Add bump-versions script (#4241) @yuki-takei
- support: New release workflow (#4236) @yuki-takei
- Support: Create @growi/core package
- Support: Create @growi/ui package
- Support: Include official plugins as sub packages
- Support: Upgrade libs

## v4.3.3

- Improvement: Welcome page markdown
- Fix: Some recursive operation exclude descendant pages that are restricted for groups (Rename / Delete / Delete completely / Put back / Duplicate)
- Fix: Layout is broken when editing users page ([#4128](https://github.com/growilabs/growi/issues/4128))
- Support: Upgrade libs

## v4.3.2

- Feature: Hufflpuff theme
- Improvement: CodeMirror header styles
- Improvement: CodeMirror syntax-highlighting fenced code blocks
- Improvement: Slack Integration Settings: Error behavior when getting connection statuses
- Improvement: Slack Integration Settings: Add links to docs
- Improvement: /_api/v3/recent can be accessed with access token
- Support: Using http-errors

## v4.3.1

- Fix: Build script for production

## v4.3.0

### BREAKING CHANGES

- GROWI manages dependencies with `lerna`: Use `npx lerna bootstrap` instead of `yarn install`
- GROWI includes some official plugins in default: Users no longer need to install [growi-plugin-lsx](https://github.com/growilabs/growi-plugin-lsx), [growi-plugin-pukiwiki-like-linker](https://github.com/growilabs/growi-plugin-pukiwiki-like-linker) and [growi-plugin-attachment-refs](https://github.com/growilabs/growi-plugin-attachment-refs) before build client.

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/43x.html](https://docs.growi.org/en/admin-guide/upgrading/43x.html)

### Updates

- Feature: Enable/Disable option for share link
- Feature: Re-send invitation mail from user management page
- Improvement: Mark users who failed to send invitation emails
- Fix: lsx plugin in the custom sidebar does not work when showing search result page
- Support: Switch the official docker base image from Alpine based to Ubuntu based
- Support: Upgrade libs

## v4.2.21

- Improvement: Headers style on built-in editor
- Improvement: Codemirror is now scrollable one editor height of empty space into view at the bottom of the editor
- Improvement: Upgrade mongodb driver to fix [NODE-2784](https://jira.mongodb.org/browse/NODE-2784)
- Support: Upgrade libs

## v4.2.20

- Improvement: Error message when the password is too short
- Improvement: Repeat XSS processing as a countermeasure against nesting
- Fix: NoSQL injection of access-token-parser
- Fix: Checking permission when operating share links
- Fix: Invalid NaN label is shown when deletedAt of the page is undefined (Introduced by v4.2.8)

## v4.2.19

- Feature: Set max-age of the user's cookie with the env var `SESSION_MAX_AGE`
- Feature: Set max-age of the user's cookie in admin page
- Improvement: Change the first accessing page after installation to the top page
- Support: Upgrade libs

## v4.2.18

- Feature: Convertible page contents width
- Fix: Group selector of User Group Delete Modal does not show all groups
- Fix: Global notification to Slack does not encode spaces of page path
- Support: Upgrade libs

## v4.2.17

- Improvement: Invoke garbage collection when reindex all pages by elasticsearch
- Improvement: Hide Sidebar at shared pages
- Fix: No unsaved alert is displayed without difference the latest markdown and editor value
- Support: Update libs

## v4.2.16

- Fix: "Only inside the group" causes an error (Introduced by v4.2.15)

## v4.2.15

- Improvement: toastr location for editing
- Improvement: Handsontable with static backdrop to prevent from closing when backdrop is clicked
- Fix: Accept invalid page path like `..%2f`
- Fix: Pages updated date is corrupted after recursive operation (Introduced by v4.2.8)
- Support: Upgrade libs

## v4.2.14

- Feature: Add an option to restrict publishing email property for new users
- Improvement: Invite modal in admin page without email server settings
- Improvement: Global notification settings in admin page without email server settings
- Fix: Can create pages on the share route (Introduced by v4.2.8)
- Fix: Pages restrected by group are excluded for recurrence operation (Introduced by v4.2.8)
- Fix: Rename and duplicate to descendants path does not work correctly (Introduced by v4.2.8)
- Support: Update libs

## v4.2.13

- Feature: Detect indent size automatically
- Fix: Some API responses includes email unintentionally
- Fix: An error always displayed in admin pages

## v4.2.12

- Feature: Custom Sidebar
- Fix: Set language correctly for draw.io (diagrams.net)

## v4.2.11

- Fix: Rename decendants is not working (Introduced by v4.2.8)

## v4.2.10

- Feature: Staff Credits for apps on GROWI.cloud
- Improvement: Hackmd button behavior when disabled
- Improvement: Layout of comparing revisions
- Fix: Empty trash is not working

## v4.2.9

- Feature: Comparing revisions
- Improvement: Memory consumption when re-indexing for full text searching
- Improvement: Site URL settings valildation
- Fix: Show comfirmation when transiting page without save
- Fix: Save slack channels history when user trigger notification is invoked
- Fix: The label of alerts for move/rename/delete are borken

## v4.2.8

- Improvement: Performance for pages to rename/duplicate/delete/revert pages
- Fix: Preview scrollbar doesn't sync to editor (Introduced by v4.2.6)
- Fix: Failed to save temporaryUrlCached with using gcs (Introduced by v4.2.3)
- Fix: Fixed not being able to update ses settings (Introduced by v4.2.0)
- Fix: Fixed the display of updtedAt and createdAt being reversed
- Fix: Pass app title value through the XSS filter

## v4.2.7

- Fix: Installer doesn't work on Chrome

## v4.2.6

- Feature: Add a button to jump to Comments section
- Feature: Paste Bootstrap4 Grid HTML with GUI
- Feature: Disable auto formating table option
- Improvement: Layout of Edit Link Modal
- Improvement: Focus to the first input when modal is opened
- Improvement: Preview layout in edit mode
- Improvement: Install process under redundant environment
- Improvement: Add contributors
- Fix: Upgrading to v4.x failed when the user uses Kibela Layout (Introduced by v4.2.0)
- Fix: diagrams.net (draw.io) errors
- Fix: Navbar is not rendered on old iOS
- Support: Expose metrics with Promster
- Support: Upgrade libs

## v4.2.5

- Improvement: Invoke garbage collection when reindex all pages by elasticsearch
- Fix: MathJax rendering does not work

## v4.2.4

- Fix: Fixed an error when creating a new page with `Ctrl-S` (Introduced by v4.2.2)
- Fix: Fixed a strange diff in PageHistory due to Pagination
- Fix: Fixed that the user group page could not be found when using api from the outside

## v4.2.3

- Feature: Insert/edit links with GUI
- Feature: Auto reconnecting to search service
- Improvement: New style of params for Healthcheck API
- Fix: Referencing attachments when `FILE_UPLOAD_DISABLED` is true
- Fix: The message of timeline for restricted pages
- Fix: Parameter validation for Import/Export Archive API
- Fix: Prevent regexp for Search Tags API
- Fix: Add `Content-Security-Policy` when referencing attachments
- Fix: Sanitize at presentation time
- Fix: Remove page path string from message for page lists and timeline when there is no contents

## v4.2.2

- Fix: Consecutive save operations with built-in editor fail (Introduced by v4.2.1)

## v4.2.1

- Fix: Consecutive save operations with HackMD fail (Introduced by v4.2.0)
- Fix: Switching theme to kibela fail (Introduced by v4.2.0)

## v4.2.0

### BREAKING CHANGES

- GROWI v4.2.x no longer support Kibela layout. Kibela theme is newly added and the configuration will migrate to it automatically.

### Updates

- Feature: File Upload Settings on admin pages
- Improvement: Basic layout of page
- Support: Support MongoDB 4.0, 4.2 and 4.4
- Support: Upgrade libs

## v4.1.13

- Fix: MathJax rendering does not work

## v4.1.12

- Fix: Adjust line-height for pre under li
- Fix: Emptying trash process is broken

## v4.1.11

- Improvement: Generating draft DOM id strategy
- Fix: GROWI version downgrade causes a validation error for user.lang

## v4.1.10

- Fix: Make listing users API secure
- Fix: Error message when the server denies guest user connecting with socket.io

## v4.1.9

- Feature: Environment variables to set max connection size to deliver push messages to all clients

## v4.1.8

- Improvement: Rebuilding progress bar colors for Full Text Search Management
- Improvement: Support operations on page data with a null value for author

## v4.1.7

- Improvement: Fire global notification when a new page is created by uploading file
- Fix: Change default `DRAWIO_URI` to embed.diagrams.net
- Fix: An unhandled rejection occures when a user who does not send referer accesses

## v4.1.6

- Improvement: Hide Fab at admin pages
- Fix: Presentation does not work
- Fix: Update GrantSelector status when uploading a file to a new page
- Fix: CopyDropdown origin refs draw.io host wrongly

## v4.1.5

- Feature: Independent S3 configuration and SES configuration for AWS
- Fix: Author name does not displayed in page history
- Fix: Hide unnecessary component when pringing

## v4.1.4 (Discontinued)

## v4.1.3

- Feature: Create/edit linker with GUI
- Improvement: Paging page histories
- Improvement: Avoid using `cursor.snapshot()` in preparation for MongoDB version upgrade
- Improvement: Allow to save "From e-mail address" only in App Settings
- Improvement: Allow to empty "From e-mail address" in App Settings
- Improvement: Export/Import archive data serially so as not to waste memory
- Fix: To be able to delete attachment metadata even when the actual data does not exist
- Fix: Limit the attrubutes of user data for `/_api/v3/users`
- Fix: Prevent XSS with SVG
- Upgrade libs

## v4.1.2

- Fix: Uploaded images do not displayed (Introduced by v4.1.1)

## v4.1.1

- Feature: External share link
- Improvement: Optimize some features that operate revision data
- Fix: Cmd+c/v/... does not work on Mac (Introduced by v4.1.0)
- Fix: "Append params" switch of CopyDropdown does not work when multiple CopyDropdown instance exists
- Fix: "Append params" switch of CopyDropdown escapes spaces
- Fix: Blockdiag does not be rendered
- Fix: Access token parser

## v4.1.0

### BREAKING CHANGES

- GROWI v4.1.x no longer support Node.js v10.x
- GROWI v4.1.x no longer support growi-plugin-attachment-refs@v1

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/41x.html](https://docs.growi.org/en/admin-guide/upgrading/41x.html)

### Updates

- Feature: Server settings synchronization for multiple GROWI Apps
- Feature: Page status alert synchronization for multiple GROWI Apps
- Feature: Smooth scroll for anchor links
- Feature: Mirror Mode with [Konami Code](https://en.wikipedia.org/wiki/Konami_Code)
- Improvement: Determine whether the "In Use" badge is displayed or not by attachment ID
- Improvement: draw.io under NO_CDN environment
- Fix: Deleting/renaming with recursive option affects pages that are inaccessible to active users
- Fix: DrawioModal cuts without beginning/ending line
- Fix: New settings of SMTP and AWS SES are not reflected when server is running
- Fix: Sidebar layout broken when using Kibela layout
- Support: Support Node.js v14
- Support: Update libs

## v4.0.11

- Fix: Fab on search result page does not displayed
- Fix: Adjust margin/padding for search result page
- Fix: PageAlert broken (Introduced by v4.0.9)

## v4.0.10

- Improvement: Adjust ToC height
- Fix: Fail to rename/delete a page set as "Anyone with the link"

## v4.0.9

- Feature: Detailed configurations for OpenID Connect
- Improvement: Navigations
- Improvement: Sticky admin navigation
- Fix: Reseting password doesn't work
- Fix: Styles for printing
- Fix: Unable to create page with original path after emptying trash
- I18n: Support zh-CN

## v4.0.8 (Discontinued)

## v4.0.7

- Feature: Set request timeout for Elasticsearch with env var `ELASTICSEARCH_REQUEST_TIMEOUT`
- Improvement: Apply styles faster on booting client
- Fix: Styles are not applyed on installer
- Fix: Remove last-resort `next()`
- Fix: Enable/disable Notification settings couldn't change when either of the params is undefined
- Fix: Text overflow

## v4.0.6

- Fix: Avatar images in Recent Changes are not shown
- Fix: Full screen modal of Handsontable and Draw.io don't work
- Fix: Shortcut for creating page respond with modifier key wrongly (Introduced by v4.0.5)

## v4.0.5

- Improvement: Return pre-defined session id when healthcheck
- Improvement: Refactor caching for profile image
- Improvement: Layout for global search help on mobile
- Improvement: Layout for confidential notation
- Fix: Shortcut for creating page doesn't work
- Support: Dev in container
- Support: Upgrade libs

## v4.0.4

- Feature: Drawer/Dock mode selector
- Improvement: Admin pages navigation
- Improvement: Ensure not to avoid session management even when accessing to healthcheck
- Support: Refactor unstated utils
- Support: Upgrade libs

## v4.0.3

- Feature: Copy page path dropdown with Append params switch
- Improvement: Truncate overflowed user browsing history
- Improvement: Tabs appearance on mobile
- Improvement: Search help appearance on mobile
- Improvement: Accessibility of login page
- Fix: Editor was broken by long lines
- Fix: Editor doesn't work on mobile
- Fix: Word break in Recent Updated contents
- Fix: navbar is broken on Safari

## v4.0.2

- Fix: Internal Server Error occurred when the guest user access to the pages that has likes
- Fix: Some buttons are broken on Safari

## v4.0.1

- Improvement: Accessibility for Handsontable under dark mode
- Improvement: Refactor '/pages.exist' API
- Fix: Storing the state of sidebar
- Fix: Comments order should be asc
- Fix: Show/Hide replies button doesn't work
- Fix: Tooltip doesn't work
- Fix: Change the display of the scroll bar when modal is shown
- Fix: Submit with enter key on Create/Rename modals
- Fix: Show/Hide Unlink redirection button conditions
- Fix: Link color in alerts
- Support: Upgrade libs

## v4.0.0

### BREAKING CHANGES

- Crowi Classic Behavior is removed
- Crowi Classic Layout is removed
- 'default-dark' theme is now merged as a dark mode variant of 'default' theme
- 'blue-night' theme is now merged as a dark mode variant of 'mono-blue' theme

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/40x.html](https://docs.growi.org/en/admin-guide/upgrading/40x.html)

### Updates

- Feature: Sidebar
- Feature: Recent changes on Sidebar
- Feature: Switch Light/Dark Mode
- Improvement: Migrate to Bootstrap 4
- Improvement: Copy Page URL menu item to copy path dropdown
- Improvement: Show contributors by Bootstrap Modal
- Support: Upgrade libs

## v3.8.1

### BREAKING CHANGES

- Now Elasticsearch requires the privilege `cluster:monitor/health` instead of `cluster:monitor/nodes/info`

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/38x.html](https://docs.growi.org/en/admin-guide/upgrading/38x.html)

### Updates

- Improvement: Change the health check method for Elasticsearch
- Fix: Unset overflow-y style for Edit Tags Modal
- Fix: Duplicate page source is overwrited (Introduced by 3.7.6)

## v3.8.0  (Discontinued)

## v3.7.7

- Feature: Empty trash pages
- Improvement: Behavior of Reconnect to Elasticsearch button
- Fix: Duplicate page source is overwrited (Introduced by 3.7.6)

## v3.7.6  (Discontinued)

## v3.7.5

- Fix: Draw.io diagrams rendered twice
- Fix: Behavior of password reset modal is strange
- Fix: Import GROWI Archive doesn't restore some data correctly
- Fix: Attachments list on root page and users top pages
- Fix: Trash page is no longer editable
- Fix: Rendering Timeline on /trash

## v3.7.4

- Fix: Broken by displaying user image

## v3.7.3

- Feature: Profile Image Cropping
- Improvement: Reactify users pages
- Improvement: Detect language and adjust the order of first and last names when creating accounts in OAuth
- Fix: Installation is broken when selecting Japanese (Introduced by 3.7.0)
- Fix: Mathjax Rendering is unstable (workaround) (Introduced by 3.7.0)
- Fix: Notification Setting couldn't update without slack token (Introduced by 3.6.6)
- Support: Add GROWI Contributers

## v3.7.2

- Feature: User Management Filtering/Sort
- Feature: Show env vars on Admin pages
- Fix: Attachment row z-index
- I18n: HackMD integration alert

## v3.7.1

- Improvement: Add an option that make it possible to choose what to send notifications
- Improvement: Add the env var `DRAWIO_URI`
- Improvement: Accessibility for 'spring' theme
- Improvement: Editor scroll sync behaves strangely when using draw.io blocks
- Fix: Coudn't upload file on Comment Editor (Introduced by 3.5.8)
- I18n: HackMD integration

## v3.7.0

### BREAKING CHANGES

None.

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/37x.html](https://docs.growi.org/en/admin-guide/upgrading/37x.html)

### Updates

- Feature: [Draw.io](https://www.draw.io/) Integration
- Feature: SAML Attribute-based Login Control
- Improvement: Reactify admin pages (Security)
- Improvement: Behavior of pre-editing screen of HackMD when user needs to resume

## v3.6.10

- Fix: Redirect logic for users except for actives (Introduced by 3.6.9)

## v3.6.9

- Improvement: Redirection when login/logout
- Improvement: Add home icon before '/'
- Fix: Client crashed when the first login (Introduced by 3.6.8)

## v3.6.8

- Improvement: Show page history side-by-side
- Improvement: Optimize markdown rendering
- Improvement: Reactify admin pages (Navigation)
- Fix: Reply comments collapsed are broken (Introduced by 3.6.7)
- Support: Update libs

## v3.6.7

- Feature: Anchor link for comments
- Improvement: Show error toastr when saving page is failed because of empty document
- Fix: Admin Customise couldn't restore stored config value (Introduced by 3.6.2)
- Fix: Admin Customise missed preview functions (Introduced by 3.6.2)
- Fix: AWS doesn't work (Introduced by 3.6.4)
- Fix: Ensure not to get unrelated indices information in Elasticsearch Management (Introduced by 3.6.6)
- Support: Optimize bundles
- Support: Optimize build-prod job with caching node_modules/.cache

## v3.6.6

- Feature: Reconnect to Elasticsearch from Full Text Search Management
- Feature: Normalize indices of Elasticsearch from Full Text Search Management
- Improvement: Add 'spring' theme
- Improvement: Reactify admin pages (Notification)
- Impromvement: Add `checkMiddlewaresStrictly` option to Healthcheck API
- Improvement: Accessibility for History component under dark themes
- Fix: Warning on client console when developing /admin/app
- Support: Upgrade libs

## v3.6.5 (Discontinued)

## v3.6.4

- Feature: Alert for stale page
- Improvement: Reactify admin pages (Home)
- Improvement: Reactify admin pages (App)
- Improvement: Accessibility for editor icons of dark themes
- Improvement: Accessibility for importing table data pane
- Improvement: Resolve username and email when logging in with Google OAuth

## v3.6.3

- Improvement: Searching users in UserGroup Management
- Fix: Repair google authentication by migrating to jaredhanson/passport-google-oauth2
- Fix: Markdown Settings are broken by the button to import recommended settings
- Support: Upgrade libs

## v3.6.2

- Improvement: Reactify admin pages (Customize)
- Improvement: Ensure not to consider `[text|site](https://example.com]` as a row in the table
- Improvement: Enter key behavior in markdown table
- Fix: Pre-installed plugins in official docker image are not detected (Introduced by 3.6.0)
- Fix: Emoji Autocomplete window does not float correctly (Introduced by 3.5.0)

## v3.6.1

### BREAKING CHANGES

- GROWI v3.6.x no longer support Node.js v8.x
- The name of database that is storing migrations meta data has been changed. This affects **only when `MONGO_URI` has parameters**. v3.5.x or above has a bug ([#1361](https://github.com/growilabs/growi/issues/1361))

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/36x.html](https://docs.growi.org/en/admin-guide/upgrading/36x.html)

### Updates

- Improvement: Drop unnecessary MongoDB collection indexes
- Improvement: Accessibility of Antarctic theme
- Improvement: Reactify admin pages (Markdown Settings)
- Fix: Appending tag is failed by wrong index of PageTagRelation (Introduced by 3.5.20)
- Fix: Pages without heading slash is invalid but creatable
- Fix: Connect to Elasticsearch with `httpAuth` param
- Support: Support Node.js v12
- Support: Optimize build in dev with hard-source-webpack-plugin
- Support: Upgrade libs

## v3.6.0 (Discontinued)

## v3.5.25

- Improvement: Disable ESC key to close Handsontable Modal
- Fix: Exported data of empty collection is broken
- Fix: Some components crash after when the page with attachment has exported/imported

## v3.5.24

- Fix: Plugins are not working on Heroku

## v3.5.23

- Fix: Global Notification failed to send e-mail
- Fix: Pagination is not working for trash list
- Fix: Healthcheck API with `?connectToMiddlewares` returns error
- Support: Upgrade libs

## v3.5.22

- Improvement: Add `FILE_UPLOAD_DISABLED` env var

## v3.5.21

- Improvement: Cache control when retrieving attachment data
- Fix: Inviting user doesn't work (Introduced by 3.5.20)

## v3.5.20

- Improvement: Organize MongoDB collection indexes uniqueness
- Improvement: Reactify admin pages (External Account Management)
- Fix: Search result or Timeline shows loading icon eternally when retrieving not accessible page
- Support: Use SearchBox Elasticsearch Addon on Heroku
- Support: Upgrade libs

## v3.5.19 (Discontinued)

## v3.5.18

- Improvement: Import GROWI Archive
- Improvement: Optimize handling promise of stream when exporting archive
- Improvement: Optimize handling promise of stream when building indices
- Improvement: Add link to [docs.growi.org](https://docs.growi.org)
- Fix: Monospace font code is broken when printing on Mac

## v3.5.17

- Feature: Upload to GCS (Google Cloud Storage)
- Feature: Statistics API
- Improvement: Optimize exporting
- Improvement: Show progress bar when exporting
- Improvement: Validate collection combinations when importing
- Improvement: Reactify admin pages
- Fix: Use HTTP PlantUML URL in default (Introduced by 3.5.12)
- Fix: Config default values
- Support: REPL with `console` npm scripts

## v3.5.16

- Fix: Full Text Search doesn't work after when building indices (Introduced by 3.5.12)

## v3.5.15

- Feature: Import/Export Page data
- Fix: The link to Sandbox on Markdown Help Modal doesn't work
- Support: Upgrade libs

## v3.5.14 (Discontinued)

## v3.5.13

- Feature: Re-edit comments
- Support: [growi-plugin-attachment-refs](https://github.com/growilabs/growi-plugin-attachment-refs)
- Support: Upgrade libs

## v3.5.12

- Improvement: Use Elasticsearch Alias
- Improvement: Connect to HTTPS PlantUML URL in default
- Fix: Global Notification doesn't work after updating Webhook URL
- Fix: User Trigger Notification is not be sent when channel is not specified
- Support: Upgrade libs

## v3.5.11

- Fix: HackMD Editor shows 404 error when HackMD redirect to fqdn URI (Introduced by 3.5.8)
- Fix: Timeline doesn't work (Introduced by 3.5.1)
- Fix: Last Login field does not shown in /admin/user
- Support: Upgrade libs

## v3.5.10

- Feature: Send Global Notification with Slack
- Improvement: Show loading spinner when fetching page history data
- Improvement: Hierarchical page link when the page is in /Trash
- Fix: Code Highlight Theme does not change (Introduced by 3.5.2)
- Support: Upgrade libs

## v3.5.9

- Fix: Editing table with Spreadsheet like GUI (Handsontable) is failed
- Fix: Plugins are not initialized when first launching (Introduced by 3.5.0)
- Support: Upgrade libs

## v3.5.8

- Improvement: Controls when HackMD/CodiMD has unsaved draft
- Improvement: Show hints if HackMD/CodiMD integration is not working
- Improvement: GROWI server obtains HackMD/CodiMD page id from the 302 response header
- Improvement: Comment Thread Layout
- Improvement: Show commented date with date distance format

## v3.5.7 (Discontinued)

## v3.5.6

- Fix: Saving new page is failed when empty string tag is set
- Fix: Link of Create template page button in New Page Modal is broken
- Fix: Global Notification dows not work when creating/moving/deleting/like/comment

## v3.5.5

- Feature: Support S3-compatible object storage (e.g. MinIO)
- Feature: Enable/Disable ID/Password Authentication
- Improvement: Login Mechanism with HTTP Basic Authentication header
- Improvement: Reactify Table Of Contents
- Fix: Profile images are broken in User Management
- Fix: Template page under root page doesn't work
- Support: Upgrade libs

## v3.5.4

- Fix: List private pages wrongly
- Fix: Global Notification Trigger Path does not parse glob correctly
- Fix: Consecutive page deletion requests cause unexpected complete page deletion

## v3.5.3

- Improvement: Calculate string width when save with Spreadsheet like GUI (Handsontable)
- Fix: Search Result Page doesn't work
- Fix: Create/Update page API returns data includes author's password hash
- Fix: Dropdown to copy page path/URL/MarkdownLink shows under CodeMirror vscrollbar
- Fix: Link to /trash in Dropdown menu

## v3.5.2

- Feature: Remain metadata option when Move/Rename page
- Improvement: Support code highlight for Swift and Kotlin
- Fix: Couldn't restrict page with user group permission
- Fix: Couldn't duplicate a page when it restricted by a user group permission
- Fix: Consider timezone on admin page
- Fix: Editor doesn't work on Microsoft Edge
- Support: Upgrade libs

## v3.5.1

### BREAKING CHANGES

- GROWI no longer supports Protection system with Basic Authentication
- GROWI no longer supports Crowi Classic Authentication Mechanism
- GROWI no lonnger supports plugins with schema version 2
- The restriction mode of the root page (`/`) will be set 'Public'
- The restriction mode of the root page (`/`) can not be changed after v 3.5.1

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/35x.html](https://docs.growi.org/en/admin-guide/upgrading/35x.html)

### Updates

- Feature: Comment Thread
- Feature: OpenID Connect authentication
- Feature: HTTP Basic authentication
- Feature: Staff Credits with [Konami Code](https://en.wikipedia.org/wiki/Konami_Code)
- Feature: Restricte Complete Deletion of Pages
- Improvement Draft list
- Fix: Deleting page completely
- Fix: Search with `prefix:` param with CJK pathname
- Fix: Could not edit UserGroup even if `PUBLIC_WIKI_ONLY` is not set
- I18n: User Management Details
- I18n: Group Management Details
- Support: Apply unstated
- Support: Use Babel 7
- Support: Support plugins with schema version 3
- Support: Abolish Old Config API
- Support: Apply Jest for Tests
- Support: Upgrade libs

## v3.5.0 (Discontinued)

## v3.4.7

- Improvement: Handle private pages on group deletion
- Fix: Searching with `tag:xxx` syntax doesn't work
- Fix: Check CSRF when updating user data
- Fix: `createdAt` field initialization
- I18n: Import data page
- I18n: Group Management page

## v3.4.6

- Feature: Tags
- Feature: Dropdown to copy page path/URL/MarkdownLink
- Feature: List of drafts
- Improvement: Replace icons of Editor Tool Bar
- Improvement: Show display name when mouse hover to user image
- Fix: URL in slack message is broken on Safari
- Fix: Registration does not work when basic auth is enabled
- Support: Publish API docs with swagger-jsdoc and ReDoc
- Support: Upgrade libs

## v3.4.5

- Improvement: Pass autolink through the XSS filter according to CommonMark Spec
- Fix: Update ElasticSearch index when deleting/duplicating pages
- Fix: Xss filter breaks PlantUML arrows
- Support: Support growi-plugin-lsx@2.2.0
- Support: Upgrade libs

## v3.4.4

- Fix: Comment component doesn't work

## v3.4.3

- Improvement: Add 'antarctic' theme
- Support Apply eslint-config-airbnb based rules
- Support Apply prettier and stylelint
- Support: Upgrade libs

## v3.4.2

- Fix: Nofitication to Slack doesn't work (Introduced by 3.4.0)

## v3.4.1

- Fix: "Cannot find module 'stream-to-promise'" occured when build client with `FILE_UPLOAD=local`

## v3.4.0

### BREAKING CHANGES

None.

Upgrading Guide: [https://docs.growi.org/en/admin-guide/upgrading/34x.html](https://docs.growi.org/en/admin-guide/upgrading/34x.html)

### Updates

- Improvement: Restrict to access attachments when the user is not allowed to see page
- Improvement: Show fans and visitors of page
- Improvement: Full text search tokenizing
- Improvement: Markdown comment on Crowi Classic Layout
- Fix: Profile image is not displayed when `FILE_UPLOAD=mongodb`
- Fix: Posting comment doesn't work under Crowi Classic Layout (Introduced by 3.1.5)
- Fix: HackMD doesn't work when `siteUrl` ends with slash
- Fix: Ensure not to be able to move/duplicate page to the path which has trailing slash
- Support: Launch with Node.js v10
- Support: Launch with MongoDB 3.6
- Support: Launch with Elasticsearch 6.6
- Support: Upgrade libs

## v3.3.10

- Feature: PlantUML and Blockdiag on presentation
- Improvement: Render slides of presentation with GrowiRenderer
- Fix: Unportalizing doesn't work
- Support: Use mini-css-extract-plugin instead of extract extract-text-webpack-plugin
- Support: Use terser-webpack-plugin instead of uglifyjs-webpack-plugin
- Support: Upgrade libs

## v3.3.9

- Fix: Import from Qiita:Team doesn't work (Introduced by 3.3.0)
- Fix: Typeahead shows autocomplete wrongly (Introduced by 3.3.8)
- Support: Upgrade libs

## v3.3.8

- Fix: Move/Duplicate don't work (Introduced by 3.3.7)
- Fix: Server doesn't respond when root page is restricted
- Support: Upgrade libs

## v3.3.7

- Feature: Editor toolbar
- Feature: `prefix:/path` searching syntax to filter with page path prefix
- Feature: Add an option to filter only children to searching box of navbar
- Improvement: Suggest page path when moving/duplicating/searching
- Fix: Anonymous users couldn't search (Introduced by 3.3.6)
- I18n: Searching help
- Support: Prepare to suppoert Node.js v10
- Support: Upgrade libs

## v3.3.6

- Improvement: Site URL settings must be set
- Improvement: Site URL settings can be set with environment variable
- Fix: "Anyone with the link" ACL doesn't work correctly (Introduced by 3.3.0)
- Fix: Related pages list of /admin/user-group-detail/xxx doesn't show anything (Introduced by 3.3.0)
- Fix: Diff of revision contents doesn't appeared when notifing with slack
- Fix: NPE occured on /admin/security when Crowi Classic Auth Mechanism is set
- Fix: Coudn't render Timing Diagram with PlantUML
- I18n: Cheatsheet for editor
- I18n: Some admin pages
- Support: Upgrade libs

## v3.3.5 (Discontinued)

## v3.3.4

- Improvement: SAML configuration with environment variables
- Improvement: Upload file with pasting from clipboard
- Fix: `/_api/revisions.get` doesn't populate author data correctly
- Fix: Wrong OAuth callback url are shown at admin page
- Fix: Connecting to MongoDB failed when processing migration
- Support: Get ready to use new config management system

## v3.3.3

- Feature: Show line numbers to a code block
- Feature: Bulk update the scope of descendant pages when create/update page
- Improvement: The scope of ascendant page will be retrieved and set to controls in advance when creating a new page
- Fix: Pages that is restricted by groups couldn't be shown in search result page
- Fix: Pages order in search result page was wrong
- Fix: Guest user can't search
- Fix: Possibility that ExternalAccount deletion processing selects incorrect data
- Support: Upgrade libs

## v3.3.2

- Fix: Specified Group ACL is not persisted correctly (Introduced by 3.3.0)

## v3.3.1

- Feature: NO_CDN Mode
- Feature: Add option to show/hide restricted pages in list
- Feature: MongoDB GridFS quota
- Improvement: Refactor Access Control
- Improvement: Checkbox behavior of task list
- Improvement: Fixed search input on search result page
- Improvement: Add 'christmas' theme
- Improvement: Select default language of new users
- Fix: Hide restricted pages contents in timeline
- Support: Upgrade libs

## v3.3.0 (Discontinued)

## v3.2.10

- Fix: Pages in trash are available to create
- Fix: Couldn't create portal page under Crowi Classic Behavior
- Fix: Table tag in Timeline/SearchResult missed border and BS3 styles
- I18n: Installer

## v3.2.9

- Feature: Attachment Storing to MongoDB GridFS
- Fix: row/col moving of Spreadsheet like GUI (Handsontable) doesn't work
- Fix: Emoji AutoComplete dialog pops up at wrong position
- Support: Upgrade libs

## v3.2.8

- Improvement: Add an option to use email for account link when using SAML federation
- Fix: Editor layout is sometimes broken
- Fix: Normalize table data for Spreadsheet like GUI (Handsontable) when import
- Support: Improve development environment
- Support: Upgrade libs

## v3.2.7

- Feature: Import CSV/TSV/HTML table on Spreadsheet like GUI (Handsontable)
- Fix: Pasting table data copied from Excel includes unnecessary line breaks
- Fix: Page break Preset 1 for Presentation mode is broken
- Fix: Login Form when LDAP login failed caused 500 Internal Server Error

## v3.2.6

- Feature: Add select alignment buttons of Spreadsheet like GUI (Handsontable)
- Improvement: Shrink the rows that have no diff of revision history page
- Fix: Login form rejects weak password
- Fix: An error occured by uploading attachment file when the page is not exists (Introduced by 2.3.5)
- Support: Upgrade libs

## v3.2.5

- Improvement: Expandable Spreadsheet like GUI (Handsontable)
- Improvement: Move/Resize rows/columns of Spreadsheet like GUI (Handsontable)
- Improvement: Prevent XSS of New Page modal
- Fix: Recent Created tab of user home shows wrong page list (Introduced by 3.2.4)
- Support: Upgrade libs

## v3.2.4

- Feature: Edit table with Spreadsheet like GUI (Handsontable)
- Feature: Paging recent created in users home
- Improvement: Specify certificate for SAML Authentication
- Fix: SAML Authentication didn't work (Introduced by 3.2.2)
- Fix: Failed to create new page with title which includes RegEx special characters
- Fix: Preventing XSS Settings are not applied in default (Introduced by 3.1.12)
- Support: Mongoose migration mechanism
- Support: Upgrade libs

## v3.2.3

- Feature: Kibela like layout
- Improvement: Custom newpage separator for presentation view
- Support: Shrink image size for themes which recently added

## v3.2.2

- Feature: SAML Authentication (SSO)
- Improvement: Add 'wood' theme
- Improvement: Add 'halloween' theme
- Improvement: Add 'island' theme
- Fix: Sending email function doesn't work
- Support Upgrade libs

## v3.2.1

- Feature: Import data from esa.io
- Feature: Import data from Qiita:Team
- Feature: Add the endpoint for health check
- Improvement: Adjust styles when printing
- Fix: Renaming page doesn't work if the page was saved with shortcut
- Support: Refactor directory structure
- Support Upgrade libs

## v3.2.0

- Feature: HackMD integration so that user will be able to simultaneously edit with multiple people
- Feature: Login with Twitter Account (OAuth)
- Fix: The Initial scroll position is wrong when reloading the page

## v3.1.14

- Improvement: Show help for header search box
- Improvement: Add Markdown Cheatsheet to Editor component
- Fix: Couldn't delete page completely from search result page
- Fix: Tabs of trash page are broken

## v3.1.13

- Feature: Global Notification
- Feature: Send Global Notification with E-mail
- Improvement: Add attribute mappings for email to LDAP settings
- Support: Upgrade libs

## v3.1.12

- Feature: Add XSS Settings
- Feature: Notify to Slack when comment
- Improvement: Prevent XSS in various situations
- Improvement: Show forbidden message when the user accesses to ungranted page
- Improvement: Add overlay styles for pasting file to comment form
- Fix: Omit unnecessary css link (Introduced by 3.1.10)
- Fix: Invitation mail do not be sent
- Fix: Edit template button on New Page modal doesn't work

## v3.1.11

- Fix: OAuth doesn't work in production because callback URL field cannot be specified (Introduced by 3.1.9)

## v3.1.10

- Fix: Enter key on react-bootstrap-typeahead doesn't submit (Introduced by 3.1.9)
- Fix: CodeMirror of `/admin/customize` is broken (Introduced by 3.1.9)

## v3.1.9

- Feature: Login with Google Account (OAuth)
- Feature: Login with GitHub Account (OAuth)
- Feature: Attach files in Comment
- Improvement: Write comment with CodeMirror Editor
- Improvement: Post comment with `Ctrl-Enter`
- Improvement: Place the commented page at the beginning of the list
- Improvement: Resolve errors on IE11 (Experimental)
- Support: Migrate to webpack 4
- Support: Upgrade libs

## v3.1.8 (Discontinued)

## v3.1.7

- Fix: Update hidden input 'pageForm[grant]' when save with `Ctrl-S`
- Fix: Show alert message when conflict
- Fix: `BLOCKDIAG_URI` environment variable doesn't work
- Fix: Paste in markdown list doesn't work correctly
- Support: Ensure to inject logger configuration from environment variables
- Support: Upgrade libs

## v3.1.6

- Feature: Support [blockdiag](http://blockdiag.com)
- Feature: Add `BLOCKDIAG_URI` environment variable
- Fix: Select modal for group is not shown
- Support: Upgrade libs

## v3.1.5

- Feature: Write comment with Markdown
- Improvement: Support some placeholders for template page
- Improvement: Omit unnecessary response header
- Improvement: Support LDAP attribute mappings for user's full name
- Improvement: Enable to scroll revision-toc
- Fix: Posting to Slack doesn't work (Introduced by 3.1.0)
- Fix: page.rename api doesn't work
- Fix: HTML escaped characters in markdown are unescaped unexpectedly after page is saved
- Fix: sanitize `#raw-text-original` content with 'entities'
- Fix: Double newline character posted (Introduced by 3.1.4)
- Fix: List and Comment components do not displayed (Introduced by 3.1.4)
- Support: Upgrade libs

## v3.1.4 (Discontinued)

## v3.1.3 (Discontinued)

## v3.1.2

- Feature: Template page
- Improvement: Add 'future' theme
- Improvement: Modify syntax for Crowi compatible template feature
- Improvement: Escape iframe tag in block codes
- Support: Upgrade libs

## v3.1.1

- Improvement: Add 'blue-night' theme
- Improvement: List up pages which restricted for Group ACL
- Fix: PageGroupRelation didn't remove when page is removed completely

## v3.1.0

- Improvement: Group Access Control List - Select group modal
- Improvement: Better input on mobile
- Improvement: Detach code blocks correctly
- Improvement: Auto-format markdown table which includes multibyte text
- Improvement: Show icon when auto-format markdown table is activated
- Improvement: Enable to switch show/hide border for highlight.js
- Improvement: BindDN field allows also ActiveDirectory styles
- Improvement: Show LDAP logs when testing login
- Fix: Comment body doesn't break long terms
- Fix: lsx plugin lists up pages that hit by forward match wrongly (Introduced by 3.0.4)
- Fix: Editor is broken on IE11
- Support: Multilingualize React components with i18next
- Support: Organize dependencies
- Support: Upgrade libs

## v3.0.13

- Improvement: Add Vim/Emacs/Sublime-Text icons for keybindings menu
- Improvement: Add 'mono-blue' theme
- Fix: Unportalize process failed silently
- Fix: Sidebar breaks editor layouts
- Support: Switch the logger from 'pino' to 'bunyan'
- Support: Set the alias for 'debug' to the debug function of 'bunyan'
- Support: Translate `/admin/security`
- Support: Optimize bundles
- Support: Optimize .eslintrc.js

## v3.0.12

- Feature: Support Vim/Emacs/Sublime-Text keybindings
- Improvement: Add some CodeMirror themes (Eclipse, Dracula)
- Improvement: Dynamic loading for CodeMirror theme files from CDN
- Improvement: Prevent XSS when move/redirect/duplicate

## v3.0.11

- Fix: login.html is broken in iOS
- Fix: Removing attachment is crashed
- Fix: File-attaching error after new page creation
- Support: Optimize development build
- Support: Upgrade libs

## v3.0.10

- Improvement: Add 'nature' theme
- Fix: Page list and Timeline layout for layout-growi
- Fix: Adjust theme colors (Introduced by 3.0.9)

## v3.0.9

- Fix: Registering new LDAP User is failed (Introduced by 3.0.6)
- Support: Organize scss for overriding bootstrap variables
- Support: Upgrade libs

## v3.0.8

- Improvement: h1#revision-path occupies most of the screen when the page path is long
- Improvement: Ensure not to save concealed email field to localStorage
- Fix: Cannot input "c" and "e" on iOS

## v3.0.7

- Improvement: Enable to download an attached file with original name
- Improvement: Use MongoDB for session store instead of Redis
- Improvement: Update dropzone overlay icons and styles
- Fix: Dropzone overlay elements doesn't show (Introduced by 3.0.0)
- Fix: Broken page path of timeline (Introduced by 3.0.4)

## v3.0.6

- Improvement: Automatically bind external accounts newly logged in to local accounts when username match
- Improvement: Simplify configuration for Slack Web API
- Support: Use 'slack-node' instead of '@slack/client'
- Support: Upgrade libs

## v3.0.5

- Improvement: Update lsx icons and styles
- Fix: lsx plugins doesn't show page names

## v3.0.4

- Improvement: The option that switch whether add h1 section when create new page
- Improvement: Encode page path that includes special character
- Fix: Page-saving error after new page creation

## v3.0.3

- Fix: Login page is broken in iOS
- Fix: Hide presentation tab if portal page
- Fix: A few checkboxes doesn't work
- Fix: Activating invited user form url is wrong
- Support: Use postcss-loader and autoprefixer

## v3.0.2

- Feature: Group Access Control List
- Feature: Add site theme selector
- Feature: Add a control to switch whether email shown or hidden by user
- Feature: Custom title tag content
- Fix: bosai version
- Support: Rename to GROWI
- Support: Add dark theme
- Support: Refreshing bootstrap theme and icons
- Support: Use Browsersync instead of easy-livereload
- Support: Upgrade libs

## v3.0.1 (Discontinued)

## v3.0.0 (Discontinued)

## v2.4.4

- Feature: Autoformat Markdown Table
- Feature: highlight.js Theme Selector
- Fix: The bug of updating numbering list by codemirror
- Fix: Template LangProcessor doesn't work (Introduced by 2.4.0)
- Support: Apply ESLint
- Support: Upgrade libs

## v2.4.3

- Improvement: i18n in `/admin`
- Improvement: Add `SESSION_NAME` environment variable
- Fix: All Elements are cleared when the Check All button in DeletionMode
- Support: Upgrade libs

## v2.4.2

- Improvement: Ensure to set absolute url from root when attaching files when `FILE_UPLOAD=local`
- Fix: Inline code blocks that includes doller sign are broken
- Fix: Comment count is not updated when a comment of the page is deleted
- Improvement: i18n in `/admin` (WIP)
- Support: Upgrade libs

## v2.4.1

- Feature: Custom Header HTML
- Improvement: Add highlight.js languages
- Fix: Couldn't connect to PLANTUML_URI (Introduced by 2.4.0)
- Fix: Couldn't render UML which includes CJK (Introduced by 2.4.0)
- Support: Upgrade libs

## v2.4.0

- Feature: Support Footnotes
- Feature: Support Task lists
- Feature: Support Table with CSV
- Feature: Enable to render UML diagrams with public plantuml.com server
- Feature: Enable to switch whether rendering MathJax in realtime or not
- Improvement: Replace markdown parser with markdown-it
- Improvement: Generate anchor of headers with header strings
- Improvement: Enhanced Scroll Sync on Markdown Editor/Preview
- Improvement: Update `#revision-body` tab contents after saving with `Ctrl-S`
- Fix: 500 Internal Server Error occures when basic-auth configuration is set

## v2.3.9

- Fix: `Ctrl-/` doesn't work on Chrome
- Fix: Close Shortcuts help with `Ctrl-/`, ESC key
- Fix: Jump to last line wrongly when `.revision-head-edit-button` clicked
- Support: Upgrade libs

## v2.3.8

- Feature: Suggest page path when creating pages
- Improvement: Prevent keyboard shortcuts when modal is opened
- Improvement: PageHistory UI
- Improvement: Ensure to scroll when edit button of section clicked
- Improvement: Enabled to toggle the style for active line
- Support: Upgrade libs

## v2.3.7

- Fix: Open popups when `Ctrl+C` pressed (Introduced by 2.3.5)

## v2.3.6

- Feature: Theme Selector for Editor
- Improvement: Remove unportalize button from crowi-plus layout
- Fix: CSS for admin pages
- Support: Shrink the size of libraries to include

## v2.3.5

- Feature: Enhanced Editor by CodeMirror
- Feature: Emoji AutoComplete
- Feature: Add keyboard shortcuts
- Improvement: Attaching file with Dropzone.js
- Improvement: Show shortcuts help with `Ctrl-/`
- Fix: DOMs that has `.alert-info` class don't be displayed
- Support: Switch and upgrade libs

## v2.3.4 (Discontinued)

## v2.3.3

- Fix: The XSS Library escapes inline code blocks
- Fix: NPE occurs on Elasticsearch when initial access
- Fix: Couldn't invite users(failed to create)

## v2.3.2

- Improvement: Add LDAP group search options

## v2.3.1

- Fix: Blockquote doesn't work
- Fix: Couldn't create user with first LDAP logging in

## v2.3.0

- Feature: LDAP Authentication
- Improvement: Prevent XSS
- Fix: node versions couldn't be shown
- Support: Upgrade libs

## v2.2.4

- Fix: googleapis v23.0.0 lost the function `oauth2Client.setCredentials`
- Fix: HeaderSearchBox didn't append 'q=' param when searching

## v2.2.3

- Fix: The server responds anything when using passport
- Fix: Update `lastLoginAt` when login is success
- Support: Replace moment with date-fns
- Support: Upgrade react-bootstrap-typeahead
- Improvement: Replace emojify.js with emojione

## v2.2.2 (Discontinued)

## v2.2.1

- Feature: Duplicate page
- Improve: Ensure that admin users can remove users waiting for approval
- Fix: Modal doesn't work with React v16
- Support: Upgrade React to 16
- Support: Upgrade outdated libs

## v2.2.0

- Support: Merge official Crowi v1.6.3

## v2.1.2

- Improvement: Ensure to prevent suspending own account
- Fix: Ensure to be able to use `.` for username when invited
- Fix: monospace font for `code` tag

## v2.1.1

- Fix: The problem that React Modal doesn't work
- Support: Lock some packages(react, react-dom, mongoose)

## v2.1.0

- Feature: Adopt Passport the authentication middleware
- Feature: Selective batch deletion in search result page
- Improvement: Ensure to be able to login with both of username or email
- Fix: The problem that couldn't update user data in /me
- Support: Upgrade outdated libs

## v2.0.9

- Fix: Server is down when a guest user accesses to someone's private pages
- Support: Merge official Crowi (master branch)
- Support: Upgrade outdated libs

## v2.0.8

- Fix: The problem that path including round bracket makes something bad
- Fix: Recursively option processes also unexpedted pages
- Fix: en_US translation

## v2.0.7

- Improvement: Add recursively option for Delete/Move/Putback operation
- Improvement: Comment layout and sort order (crowi-plus Enhanced Layout)

## v2.0.6

- Fix: check whether `$APP_DIR/public/uploads` exists before creating symlink

## v2.0.5

- Improvement: Adjust styles for CodeMirror
- Fix: File upload does not work when using crowi-plus-docker-compose and `FILE_UPLOAD=local` is set

## v2.0.2 - 2.0.4 (Discontinued)

## v2.0.1

- Feature: Custom Script
- Improvement: Adjust layout and styles for admin pages
- Improvement: Record and show last updated date in user list page
- Fix: Ignore Ctrl+(Shift+)Tab when editing (cherry-pick from the official)

## v2.0.0

- Feature: Enabled to integrate with Slack using Incoming Webhooks
- Support: Upgrade all outdated libs

## v1.2.16

- Improvement: Condition for creating portal
- Fix: Couldn't create new page after installation cleanly

## v1.2.15

- Improvement: Optimize cache settings for express server
- Improvement: Add a logo link to the affix header
- Fix: Child pages under `/trash` are not shown when applying crowi-plus Simplified Behavior

## v1.2.14

- Fix: Tabs(`a[data-toggle=tab][href=#...]`) push browser history twice
- Fix: `a[href=#edit-form]` still save history even when disabling pushing states option

## v1.2.13

- Improvement: Enabled to switch whether to push states with History API when tabs changes
- Fix: Layout of the Not Found page

## v1.2.12 (Discontinued)

## v1.2.11

- Improvement: Enabled to open editing form from affix header
- Improvement: Enabled to open editing form from each section headers

## v1.2.10

- Fix: Revise `server:prod:container` script for backward compatibility

## v1.2.9

- Improvement: Enabled to save with <kbd>⌘+S</kbd> on Mac
- Improvement: Adopt the fastest logger 'pino'
- Fix: The problem that can't upload profile image

## v1.2.8

- Fix: The problem that redirect doesn't work when using 'crowi-plus Simplified Behavior'

## v1.2.7 (Discontinued)

## v1.2.6

- Fix: The problem that page_list widget doesn't show the picture of revision.author
- Fix: Change implementation of Bootstrap3 toggle switch for admin pages

## v1.2.5

- Feature: crowi-plus Simplified Behavior
- Improvement: Ensure to be able to disable Timeline feature

## v1.2.4

- Fix: Internal Server Error has occurred when a guest user visited the page someone added "liked"

## v1.2.3

- Improvement: Ensure to be able to use Presentation Mode even when not logged in
- Improvement: Presentation Mode on IE11 (Experimental)
- Fix: Broken Presentation Mode

## v1.2.2

- Support: Merge official Crowi (master branch)

## v1.2.1

- Fix: buildIndex error occured when access to installer

## v1.2.0

- Support: Merge official Crowi v1.6.2

## v1.1.12

- Feature: Remove Comment Button

## v1.1.11

- Fix: Omit Comment form from page_list (crowi-plus Enhanced Layout)
- Fix: .search-box is broken on sm/xs screen

## v1.1.10

- Fix: .search-box is broken on sm/xs screen
- Support: Browsable with IE11 (Experimental)

## v1.1.9

- Improvement: Ensure to generate indices of Elasticsearch when installed
- Fix: Specify the version of Bonsai Elasticsearch on Heroku

## v1.1.8

- Fix: Depth of dropdown-menu when `.on-edit`
- Fix: Error occured on saveing with `Ctrl-S`
- Fix: Guest users browsing

## v1.1.7

- Feature: Add option to allow guest users to browse
- Fix: crowi-plus Enhanced Layout

## v1.1.6

- Fix: crowi-plus Enhanced Layout

## v1.1.5

- Fix: crowi-plus Enhanced Layout
- Support: Merge official Crowi v1.6.1 master branch [573144b]

## v1.1.4

- Feature: Ensure to select layout type from Admin Page
- Feature: Add crowi-plus Enhanced Layout

## v1.1.3

- Improvement: Use POSIX-style paths (bollowed crowi/crowi#219 by @Tomasom)

## v1.1.2

- Imprv: Brushup fonts and styles
- Fix: Ensure to specity revision id when saving with `Ctrl-S`

## v1.1.1

- Feature: Save with `Ctrl-S`
- Imprv: Brushup fonts and styles

## v1.1.0

- Support: Merge official Crowi v1.6.1

## v1.0.9

- Feature: Delete user
- Feature: Upload other than images

## v1.0.8

- Feature: Ensure to delete page completely
- Feature: Ensure to delete redirect page
- Fix: https access to Gravatar (this time for sure)

## v1.0.7

- Feature: Keyboard navigation for search box
- Improvement: Intelligent Search

## v1.0.6

- Feature: Copy button that copies page path to clipboard
- Fix: https access to Gravatar
- Fix: server watching crash with `Error: read ECONNRESET` on Google Chrome

## v1.0.5

- Feature: Ensure to use Gravatar for profile image

## v1.0.4

- Improvement: Detach code blocks before preProcess
- Support: Ensure to deploy to Heroku with INSTALL_PLUGINS env
- Support: Ensure to load plugins easily when development

## v1.0.3

- Improvement: Adjust styles

## v1.0.2

- Improvement: For lsx

## v1.0.1

- Feature: Custom CSS
- Support: Notify build failure to Slask

## v1.0.0

- Feature: Plugin mechanism
- Feature: Switchable LineBreaks ON/OFF from admin page
- Improvement: Exclude Environment-dependency
- Improvement: Enhanced linker
- Support: Add Dockerfile
- Support: Abolish gulp
- Support: LiveReload
- Support: Update libs
