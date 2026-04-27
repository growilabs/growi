
GROWI Official docker image
========================

[![Actions Status](https://github.com/growilabs/growi/workflows/Release/badge.svg)](https://github.com/growilabs/growi/actions) [![docker-pulls](https://img.shields.io/docker/pulls/growilabs/growi.svg)](https://hub.docker.com/r/growilabs/growi/) 

![GROWI-x-docker](https://github.com/user-attachments/assets/1a82236d-5a85-4a2e-842a-971b4c1625e6)


Supported tags and respective Dockerfile links
------------------------------------------------

* [`7.5.2`, `7.4`, `7`, `latest` (Dockerfile)](https://github.com/growilabs/growi/blob/v7.5.2/apps/app/docker/Dockerfile)
* [`7.3.0`, `7.3` (Dockerfile)](https://github.com/growilabs/growi/blob/v7.3.0/apps/app/docker/Dockerfile)
* [`7.2.0`, `7.2` (Dockerfile)](https://github.com/growilabs/growi/blob/v7.2.0/apps/app/docker/Dockerfile)


What is GROWI?
-------------

GROWI is a team collaboration software and it forked from [crowi](https://github.com/crowi/crowi)

see: [growilabs/growi](https://github.com/growilabs/growi)


Requirements
-------------

* MongoDB (>= 6.0)

### Optional Dependencies

* ElasticSearch (>= 7.17)
    * Japanese (kuromoji) Analysis plugin
    * ICU Analysis Plugin


Usage
-----

```bash
docker run -d \
    -e MONGO_URI=mongodb://MONGODB_HOST:MONGODB_PORT/growi \
    growilabs/growi
```

and go to `http://localhost:3000/` .

If you use ElasticSearch, type this:

```bash
docker run -d \
    -e MONGO_URI=mongodb://MONGODB_HOST:MONGODB_PORT/growi \
    -e ELASTICSEARCH_URI=http://ELASTICSEARCH_HOST:ELASTICSEARCH_PORT/growi \
    growilabs/growi
```


### docker-compose

Using docker-compose is the fastest and the most convenient way to boot GROWI.

see: [growilabs/growi-docker-compose](https://github.com/growilabs/growi-docker-compose)


Configuration
-----------

See [GROWI Docs: Admin Guide](https://docs.growi.org/en/admin-guide/) ([en](https://docs.growi.org/en/admin-guide/)/[ja](https://docs.growi.org/ja/admin-guide/)).

### Environment Variables

- [GROWI Docs: Environment Variables](https://docs.growi.org/en/admin-guide/admin-cookbook/env-vars.html)

#### V8 Memory Management

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `V8_MAX_HEAP_SIZE` | int (MB) | (unset) | Explicitly specify the `--max-heap-size` value for Node.js |
| `V8_OPTIMIZE_FOR_SIZE` | `"true"` / (unset) | (unset) | Enable the `--optimize-for-size` V8 flag to reduce memory usage |
| `V8_LITE_MODE` | `"true"` / (unset) | (unset) | Enable the `--lite-mode` V8 flag to reduce memory usage at the cost of performance |

**Heap size fallback behavior**: When `V8_MAX_HEAP_SIZE` is not set, the entrypoint automatically detects the container's memory limit via cgroup (v2/v1) and sets the heap size to 60% of the limit. If no cgroup limit is detected, V8's default heap behavior is used.


Issues
------

If you have any issues or questions about this image, please contact us through  [GitHub issue](https://github.com/growilabs/growi-docker/issues).

