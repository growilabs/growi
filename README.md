- [日本語 🇯🇵](./README_JP.md)

<p align="center">
  <a href="https://growi.org">
    <img src="https://github.com/user-attachments/assets/0acf1409-cea7-4f0e-841c-af5bd8be6711" width="360px">
  </a>
</p>
<p align="center">
  <a href="https://github.com/growilabs/growi/releases/latest"><img src="https://img.shields.io/github/release/growilabs/growi.svg" alt="Latest version"></a>
  <a href="https://communityinviter.com/apps/wsgrowi/invite/"><img src="https://img.shields.io/badge/Slack-Join%20Us-4A154B?style=flat&logo=slack&logoColor=white" alt="Slack - Join US"></a>
</p>

<p align="center">
  <a href="https://docs.growi.org">Documentation</a> / <a href="https://demo.growi.org">Demo</a>
</p>

# GROWI

[![docker pulls](https://img.shields.io/docker/pulls/weseek/growi.svg)](https://hub.docker.com/r/weseek/growi/)
[![CodeQL](https://github.com/growilabs/growi/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/codeql-analysis.yml)
[![Node CI for app development](https://github.com/growilabs/growi/actions/workflows/ci-app.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/ci-app.yml)
[![Node CI for app production](https://github.com/growilabs/growi/actions/workflows/ci-app-prod.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/ci-app-prod.yml)

## Demonstration
<video src="https://private-user-images.githubusercontent.com/34241526/333079483-fee540d7-2fa6-46d7-833e-74014c5340e3.mp4?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MTY0NDk2OTEsIm5iZiI6MTcxNjQ0OTM5MSwicGF0aCI6Ii8zNDI0MTUyNi8zMzMwNzk0ODMtZmVlNTQwZDctMmZhNi00NmQ3LTgzM2UtNzQwMTRjNTM0MGUzLm1wND9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNDA1MjMlMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjQwNTIzVDA3Mjk1MVomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTBkYWFkMmYyYmIwMTI2YWE3ZmQzZTFiNWU3ZThkMDc5NDA5N2Q3YWE5ZGM1NDgwNjk0OGNjYjZmOTJkM2IzZGQmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0JmFjdG9yX2lkPTAma2V5X2lkPTAmcmVwb19pZD0wIn0.FAvLseWBzE62yFA7wt26uERamvEVQdIGRVdBwk0uLhE"></video>


## Table Of Contents

- [Features](#features)
- [Quick Start for Production](#quick-start-for-production)
  - [docker-compose](#docker-compose)
  - [Helm (Experimental)](#helm-experimental)
  - [On-premise](#on-premise)
- [Environment Variables](#environment-variables)
- [Documentation](#documentation)
- [License](#license)

# Features

- **Features**
  - Create hierarchical pages with markdown -> [Try GROWI on the demo site](https://docs.growi.org/en/guide/getting-started/try_growi.html)
  - Simultaneously edit with multiple people
  - Support Authentication with LDAP / Active Directory, OAuth
  - SSO(Single Sign On) with SAML
  - Slack/Mattermost, IFTTT Integration
  - [GROWI Docs: Features](https://docs.growi.org/en/guide/features/page_layout.html)
- **Pluggable**
  - You can find plugins from [npm](https://www.npmjs.com/browse/keyword/growi-plugin) or [github](https://github.com/search?q=topic%3Agrowi-plugin)!
- **[Docker Ready][dockerhub]**
- **[Docker Compose Ready][docker-compose]**
  - [GROWI Docs: Multiple sites](https://docs.growi.org/en/admin-guide/admin-cookbook/multi-app.html)
  - [GROWI Docs: HTTPS(with Let's Encrypt) proxy integration](https://docs.growi.org/en/admin-guide/admin-cookbook/lets-encrypt.html)

# Quick Start for Production

### docker-compose

- [GROWI Docs: Launch with docker-compose](https://docs.growi.org/en/admin-guide/getting-started/docker-compose.html) ([en](https://docs.growi.org/en/admin-guide/getting-started/docker-compose.html)/[ja](https://docs.growi.org/ja/admin-guide/getting-started/docker-compose.html))

### Helm (Experimental)

- [GROWI Helm Chart](https://github.com/weseek/helm-charts/tree/master/charts/growi)

### On-premise

**[Migration Guide from Crowi](https://docs.growi.org/en/admin-guide/migration-guide/from-crowi-onpremise.html) ([en](https://docs.growi.org/en/admin-guide/migration-guide/from-crowi-onpremise.html)/[ja](https://docs.growi.org/ja/admin-guide/migration-guide/from-crowi-onpremise.html))** is here.

- [GROWI Docs: Install on Ubuntu Server](https://docs.growi.org/en/admin-guide/getting-started/ubuntu-server.html)
- [GROWI Docs: Install on CentOS](https://docs.growi.org/en/admin-guide/getting-started/centos.html)

## Configuration

See [GROWI Docs: Admin Guide](https://docs.growi.org/en/admin-guide/) ([en](https://docs.growi.org/en/admin-guide/)/[ja](https://docs.growi.org/ja/admin-guide/)).

### Environment Variables

See [GROWI Docs: Environment Variables](https://docs.growi.org/en/admin-guide/admin-cookbook/env-vars.html) ([en](https://docs.growi.org/en/admin-guide/admin-cookbook/env-vars.html)/[ja](https://docs.growi.org/ja/admin-guide/admin-cookbook/env-vars.html)).

# Development

## Dependencies

- Node.js v18.x or v20.x
- npm 6.x
- pnpm 9.x
- [Turborepo](https://turbo.build/repo)
- MongoDB v6.x or v8.x

### Optional Dependencies

- Redis 3.x
- ElasticSearch 7.x or 8.x (needed when using Full-text search)
  - **CAUTION: Following plugins are required**
    - [Japanese (kuromoji) Analysis plugin](https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-kuromoji.html)
    - [ICU Analysis Plugin](https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-icu.html)

## Command details

| command               | desc                                                    |
| --------------------- | ------------------------------------------------------- |
| `npm run app:build`   | Build GROWI app client                                  |
| `npm run app:server`  | Launch GROWI app server                                 |
| `npm run start`       | Invoke `npm run app:build` and `npm run app:server`     |

For more info, see [GROWI Docs: List of npm Scripts](https://docs.growi.org/en/dev/startup-v5/start-development.html#list-of-npm-scripts).

# Documentation

- [GROWI Docs](https://docs.growi.org/)
- [GROWI Developers Wiki (ja)](https://dev.growi.org/)

# Contribution

## Found a Bug?

If you found a bug in the source code, you can help us by
[submitting an issue][issues] to our [GitHub Repository][growi]. Even better, you can
[submit a Pull Request][pulls] with a fix.

## Missing a Feature?

You can _request_ a new feature by [submitting an issue][issues] to our GitHub
Repository. If you would like to _implement_ a new feature, firstly please submit the issue with your proposal to make sure we can confirm it. Please clarify what kind of change you would like to propose.

- For a **Major Feature**, firstly open an issue and outline your proposal so it can be discussed.  
  It also allows us to coordinate better, prevent duplication of work and help you to create the change so it can be successfully accepted into the project.
- **Small Features** can be created and directly [submitted as a Pull Request][pulls].

## Language on GitHub

You can write issues and PRs in English or Japanese.

## Discussion

If you have questions or suggestions, you can [join our Slack team](https://communityinviter.com/apps/wsgrowi/invite/) and talk about anything, anytime.

# License

- The MIT License (MIT)
- See [LICENSE](https://github.com/growilabs/growi/blob/master/LICENSE) and [THIRD-PARTY-NOTICES.md](https://github.com/growilabs/growi/blob/master/THIRD-PARTY-NOTICES.md).

[crowi]: https://github.com/crowi/crowi
[growi]: https://github.com/growilabs/growi
[issues]: https://github.com/growilabs/growi/issues
[pulls]: https://github.com/growilabs/growi/pulls
[dockerhub]: https://hub.docker.com/r/weseek/growi
[docker-compose]: https://github.com/growilabs/growi-docker-compose
