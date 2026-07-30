
GROWI Vault Manager Official docker image
==============================================

[![Node CI for Vault Manager](https://github.com/growilabs/growi/actions/workflows/ci-vault.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/ci-vault.yml) [![docker-pulls](https://img.shields.io/docker/pulls/growilabs/vault-manager.svg)](https://hub.docker.com/r/growilabs/vault-manager/)


Supported tags and respective Dockerfile links
------------------------------------------------

* [`1.1.0`, `1.1`, `1`, `latest` (Dockerfile)](https://github.com/growilabs/growi/blob/vault-manager/v1.1.0/apps/growi-vault-manager/docker/Dockerfile)
* [`1.0.0`, `1.0` (Dockerfile)](https://github.com/growilabs/growi/blob/vault-manager/v1.0.0/apps/growi-vault-manager/docker/Dockerfile)


What is GROWI Vault?
-------------

GROWI Vault turns a [GROWI](https://github.com/growilabs/growi) wiki into a git
repository. Users `git clone` it and get their pages as a tree of Markdown
files, so the wiki can be searched with `grep`, opened in an editor, and handed
to AI agents that work on files. `git pull` brings the working copy up to date.

Each clone contains exactly the pages that user is allowed to read — pages they
have no access to are not merely hidden, they leave no trace in the tree or in
the refs. The vault is read-only: `git push` is rejected, and attachments,
comments, likes and tags are not exported.

This image is the engine behind that feature. It is **not a standalone
application** and it is not what users clone from: it runs beside the GROWI app
container, maintains the bare git repository, and serves `git upload-pack` for
clone traffic that the GROWI app proxies to it. All GROWI domain knowledge
(access control, token authentication, group resolution) stays in the app — this
container only knows about namespaces and the git protocol.

see: [GROWI Docs: GROWI Vault](https://docs.growi.org/en/guide/features/vault.html)


Requirements
-------------

* GROWI >= 8.0.0 (`growilabs/growi:8`), started with the Vault feature enabled
* MongoDB (>= 6.0) running as a **replica set**
    * The vault is kept up to date through a MongoDB change stream, which a standalone server does not provide. A single-node replica set is enough.
* A persistent filesystem for the bare repository, shared with the GROWI app container
    * This container starts as root only long enough to create and chown that directory, then drops to the `node` user (uid/gid 1000) — the same uid the GROWI app runs as — so both containers can use one volume.


Usage
-----

### docker-compose

Using docker-compose is the fastest and the most convenient way to boot GROWI
Vault, because the app, MongoDB and this container have to be wired together.

see: [growilabs/growi-docker-compose — examples/growi-vault](https://github.com/growilabs/growi-docker-compose/tree/master/examples/growi-vault)

### docker run

Start this container against a MongoDB replica set:

```bash
docker run -d \
    -e MONGO_URI=mongodb://MONGODB_HOST:MONGODB_PORT/growi?replicaSet=rs0 \
    -e VAULT_MANAGER_INTERNAL_SECRET=CHANGE_THIS \
    -e VAULT_REPO_PATH=/data/vault-repo.git \
    -v growi_data:/data \
    growilabs/vault-manager
```

and point the GROWI app at it, with the same secret:

```bash
docker run -d \
    -e MONGO_URI=mongodb://MONGODB_HOST:MONGODB_PORT/growi?replicaSet=rs0 \
    -e VAULT_ENABLED=true \
    -e VAULT_MANAGER_ENDPOINT=http://VAULT_MANAGER_HOST:3001 \
    -e VAULT_MANAGER_INTERNAL_SECRET=CHANGE_THIS \
    -v growi_data:/data \
    growilabs/growi:8
```

The vault starts out empty. Run the initial import once from the admin screen at
`/admin/vault`; after that every page change is picked up automatically. Users
then clone from the **GROWI app**, not from this container:

```bash
git clone https://your-growi.example.com/vault.git
```

see: [GROWI Docs: Setting up GROWI Vault](https://docs.growi.org/en/admin-guide/management-cookbook/setup-vault.html)


Configuration
-----------

### Environment Variables

Read by this container:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | yes | | Connection string of the same MongoDB the GROWI app uses. Must select a replica set |
| `VAULT_MANAGER_INTERNAL_SECRET` | yes | | Shared secret that authenticates the GROWI app against this container. Must be identical on both sides |
| `VAULT_REPO_PATH` | yes | `/data/vault-repo.git` | Path of the bare git repository. The default is what the entrypoint prepares, but the value must still be passed explicitly — the process refuses to start without it |
| `PORT` | no | `3001` | Port this container listens on |

Read by the GROWI app container, to reach this one:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_ENABLED` | yes | `false` | Enables the feature. Fixed at deploy time; it cannot be toggled from the admin UI |
| `VAULT_MANAGER_ENDPOINT` | yes | | URL of this container, e.g. `http://vault-manager:3001` |
| `VAULT_MANAGER_INTERNAL_SECRET` | yes | | Same value as above |

The tuning variables for bootstrap retries, drift detection, reconcile and
garbage collection are listed under "GROWI Vault options" in
[GROWI Docs: Environment Variables](https://docs.growi.org/en/admin-guide/admin-cookbook/env-vars.html).

Keep `VAULT_MANAGER_INTERNAL_SECRET` out of version control and out of your
logs, and use a value that cannot be guessed.

### Health check

`GET /health` returns `200 {"status":"ok"}` once MongoDB is connected and the
bare repository is accessible, and `503` with the failing check otherwise. It
requires no credentials, so it can be used as a Kubernetes liveness probe.


Issues
------

If you have any issues or questions about this image, please contact us through [GitHub issue](https://github.com/growilabs/growi/issues).
