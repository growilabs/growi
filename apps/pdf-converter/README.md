[日本語 🇯🇵](./README_JP.md)

# About this app
GROWI provides a feature that bulk exports pages in PDF format, which can be executed from the page menu.
This app (PDF-Converter) is necessary to convert markdown pages to PDF during that process.

# Development
## Spec (only in Japanese)
[/資料/内部仕様/Page Bulk Export/PDF エクスポート](https://dev.growi.org/66ee8495830566b31e02c953)

## Developing inside a devcontainer
1. Open VSCode
1. Create `.devcontainer/compose.extend.yml` with the same contents as `.devcontainer/compose.extend.template.yml`
1. Open command palette (Windows: Ctrl + Shift + P, Mac: Cmd + Shift + P)
1. Choose `Dev Containers: Open folder in Container...`
1. Choose the root growi directory you have cloned from https://github.com/growilabs/growi
    - **Not the PDF-Converter directory (growi/apps/pdf-converter)**
1. Choose `GROWI-PDF-Converter` as the container to open
1. Execute `cd apps/pdf-converter && turbo dev:pdf-converter` to start the pdf-converter app
1. Edit files in apps/pdf-converter for development

## Requesting PDF-Converter from GROWI (both running in a devcontainer)
1. Open VSCode and open GROWI devcontainer
    - Choose `GROWI-Dev` for the container to open
1. Add `BULK_EXPORT_PDF_CONVERTER_URI=http://pdf-converter:3010` to `apps/app/.env.development.local`
1. Open a new VSCode window and open PDF-Converter devcontainer
    - Follow [Developing inside a devcontainer](#developing-inside-a-devcontainer)
1. Start both apps
1. Request PDF bulk export from the page menu in the GROWI app
    - It might take a few minutes, depending on GROWI's configurations

### Note
When creating both containers from scratch or rebuilding them, **make sure to select and create GROWI-Dev first**.
This is necessary because GROWI-Dev uses devcontainer features for enabling node, and [features is only enabled for the first container created](https://github.com/devcontainers/spec/issues/546).

## PDF-Converter client library
[pdf-converter-client](../../packages/pdf-converter-client) is a client library for requesting PDF-Converter, and is used by GROWI internally. It's code is auto-generated from the PDF-Converter code.

When you update the PDF-Converter API, you should also always update the client library.

You can update the client library by one of the following ways:
- Execute `cd ${growi_root_path}/packages/pdf-converter-client && pnpm gen:client-code`
- Start GROWI app
    - Inside GROWI devcontainer (not PDF-Converter devcontainer), execute `cd ${growi_root_path}/apps/app && turbo dev`

# Releasing the docker image

The image is released through changesets, the same flow `@growi/core` and `@growi/pluginkit` use — there is no release branch and no RC version marker.

1. In the PR that changes `apps/pdf-converter/**`, run `npx changeset` and give `@growi/pdf-converter` a `patch` / `minor` / `major` bump.
2. Merging that PR makes changesets open or update a **Release Subpackages** PR against `master`, which bumps `package.json` and writes `CHANGELOG.md`.
3. Merging the Release Subpackages PR publishes the image. `.github/workflows/release-pdf-converter.yml` watches pushes to `master` that touch `apps/pdf-converter/package.json`, publishes when the version is a stable one with no `pdf-converter/v<version>` tag yet, and creates that tag afterwards.

Because the gate is "stable version, not tagged yet", a push that edits `package.json` without releasing does nothing, and the same version can never be published twice.
