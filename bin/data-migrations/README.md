# Migration of page body

> **Warning**
> **Migration in this way is applied only to the latest revision. Past revisions are not applied.**

## Usage
```
git clone https://github.com/growilabs/growi
cd growi/bin/data-migrations

NETWORK=growi_devcontainer_default
MONGO_URI=mongodb://growi-devcontainer_mongo-1/growi

docker run --rm \
  --network $NETWORK \
  -v "$(pwd)"/src:/opt \
  -w /opt \
  -e MIGRATION_MODULE=v60x \
  mongo:8.0 \
  /bin/mongosh $MONGO_URI index.js
```

> **Note**
> This script uses MongoDB 8.0 Docker image, but mongosh has backward compatibility and can connect to any MongoDB server version 4.2 or greater. See [MongoDB Shell documentation](https://www.mongodb.com/docs/mongodb-shell/install/) for details.

## Variables
| Variable              | Description                                                                    | Default |
| --------------------- | ------------------------------------------------------------------------------ | ------- |
| NETWORK     | Network in docker compose of MongoDB server                                                         | -       |
| MONGO_URI| URI that can connect to MongoDB                                                     | -       |

## Environment variables
### Required

| Variable              | Description                                                                    | Default |
| --------------------- | ------------------------------------------------------------------------------ | ------- |
| MIGRATION_MODULE     | Specify migration module                                                       | -       |

The value of `MIGRATION_MODULE` is one of the following.
- `v60x/drawio`: Migration for Draw.io notation only([
reference](https://docs.growi.org/ja/admin-guide/upgrading/60x.html#%E4%BB%95%E6%A7%98%E5%A4%89%E6%9B%B4-draw-io-diagrams-net-%E8%A8%98%E6%B3%95))
- `v60x/plantuml`: Migration for PlantUML notation only([
reference](https://docs.growi.org/ja/admin-guide/upgrading/60x.html#%E4%BB%95%E6%A7%98%E5%A4%89%E6%9B%B4-plantuml-%E8%A8%98%E6%B3%95))
- `v60x/tsv`: Migration for table notation by TSV only([
reference](https://docs.growi.org/ja/admin-guide/upgrading/60x.html#%E4%BB%95%E6%A7%98%E5%A4%89%E6%9B%B4-csv-tsv-%E3%81%AB%E3%82%88%E3%82%8B%E3%83%86%E3%83%BC%E3%83%95%E3%82%99%E3%83%AB%E6%8F%8F%E7%94%BB%E8%A8%98%E6%B3%95))
- `v60x/csv`: Migration for table notation by CSV only([
reference](https://docs.growi.org/ja/admin-guide/upgrading/60x.html#%E4%BB%95%E6%A7%98%E5%A4%89%E6%9B%B4-csv-tsv-%E3%81%AB%E3%82%88%E3%82%8B%E3%83%86%E3%83%BC%E3%83%95%E3%82%99%E3%83%AB%E6%8F%8F%E7%94%BB%E8%A8%98%E6%B3%95))
- `v60x/bracketlink`: Migration for only page links within GROWI([
reference](https://docs.growi.org/ja/admin-guide/upgrading/60x.html#%E6%9C%AA%E5%AE%9F%E8%A3%85-%E5%BB%83%E6%AD%A2%E6%A4%9C%E8%A8%8E%E4%B8%AD-growi-%E7%8B%AC%E8%87%AA%E8%A8%98%E6%B3%95%E3%81%AE%E3%83%98%E3%82%9A%E3%83%BC%E3%82%B7%E3%82%99%E3%83%AA%E3%83%B3%E3%82%AF))
- `v60x` or `v60x/index`: Migration for all notations in v6.0.x series
- `v61x/mdcont`: Migration for mdcont notation only([reference](https://docs.growi.org/ja/admin-guide/upgrading/61x.html#%E4%BB%95%E6%A7%98%E5%A4%89%E6%9B%B4-%E3%82%A2%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%AA%E3%83%B3%E3%82%AF%E3%81%AB%E8%87%AA%E5%8B%95%E4%BB%98%E4%B8%8E%E3%81%95%E3%82%8C%E3%82%8B-mdcont-%E3%83%95%E3%82%9A%E3%83%AC%E3%83%95%E3%82%A3%E3%82%AF%E3%82%B9%E3%81%AE%E5%BB%83%E6%AD%A2))
- `v61x` or `v61x/index`: Migration for all notations in v6.1.x series
- `v70x/bootstrap5`: Migration for Bootstrap4 to Bootstrap5 
- `v70x` or `v70x/index`: Migration for all notations in v7.0.x series
- `custom`: You can define your own processors and apply them to `revision` (see "Advanced" below for details)

### Optional

| Variable              | Description                                                                    | Default |
| --------------------- | ------------------------------------------------------------------------------ | ------- |
| BATCH_SIZE     | Number of revisions to be processed at one time（revision）                                                         | 100       |
| BATCH_INTERVAL| Interval after batch processing（ms）                                                     | 3000       |

※The `BATCH_INTERVAL` is for server load control. If you don't mind the load of the MongoDB, there is no problem to reduce it.

## Advanced

By creating a function in `growi/bin/data-migrations/src/migrations/custom.js` that replaces a specific regular expression, you can replace all specific strings in the latest revisions for all pages.

The following function replaces the string `foo` with the string `bar`.

``` javascript
module.exports = [
  (body) => {
  var fooRegExp = /foo/g; // foo regex
  return body.replace(fooRegExp, 'bar'); // replace to bar
  },
];
```

By passing `custom` in the environment variable `MIGRATION_MODULE` and executing it, you can apply the `custom.js` to all the latest `revisions`.
```
git clone https://github.com/growilabs/growi
cd growi/bin/data-migrations

NETWORK=growi_devcontainer_default \
MONGO_URI=mongodb://growi-devcontainer_mongo-1/growi
docker run --rm \
  --network $NETWORK \
  -v "$(pwd)"/src:/opt \
  -w /opt \
  -e MIGRATION_MODULE=custom \
  mongo:8.0 \
  /bin/mongosh $MONGO_URI index.js
```