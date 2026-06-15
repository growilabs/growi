
GROWI Vault Manager Official docker image
==============================================

[![Node CI for Vault Manager](https://github.com/growilabs/growi/actions/workflows/ci-vault.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/ci-vault.yml) [![docker-pulls](https://img.shields.io/docker/pulls/growilabs/vault-manager.svg)](https://hub.docker.com/r/growilabs/vault-manager/)


Dockerfile link
------------------------------------------------

https://github.com/growilabs/growi/blob/master/apps/growi-vault-manager/docker/Dockerfile


What is GROWI Vault Manager used for?
---------------------------------------

GROWI Vault Manager is the internal execution engine for GROWI Vault. It receives
instructions written by the main GROWI app (`apps/app`) to the `vault_instructions`
MongoDB collection via a change stream, and maintains a per-namespace git bare
repository on a shared filesystem. It composes per-user view refs, serves clones
over `git upload-pack`, and runs periodic squash and gc. It holds no GROWI domain
knowledge (ACL evaluation, PAT authentication, group resolution) — that stays in
the main app.

This image is deployed alongside the main GROWI application and shares the `/data`
volume with it. The container starts as root only long enough to prepare the bare
repository directory, then drops to the `node` user (uid/gid 1000) before running.


How to use
---------------------------------------

See the GROWI documentation and the `growi-docker-compose` repository for
deployment configuration:

- https://docs.growi.org
- https://github.com/weseek/growi-docker-compose
