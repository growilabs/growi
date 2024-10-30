
GROWI Official docker image
========================

[![Actions Status](https://github.com/weseek/growi/workflows/Release/badge.svg)](https://github.com/weseek/growi/actions) [![docker-pulls](https://img.shields.io/docker/pulls/weseek/growi.svg)](https://hub.docker.com/r/weseek/growi/) [![](https://images.microbadger.com/badges/image/weseek/growi.svg)](https://microbadger.com/images/weseek/growi)

![GROWI-x-docker](https://github.com/user-attachments/assets/1a82236d-5a85-4a2e-842a-971b4c1625e6)


Supported tags and respective Dockerfile links
------------------------------------------------

* [`7.0.22`, `7.0`, `7`, `latest` (Dockerfile)](https://github.com/weseek/growi/blob/v7.0.22/apps/app/docker/Dockerfile)
* [`6.3.2`, `6.3`, `6` (Dockerfile)](https://github.com/weseek/growi/blob/v6.3.2/apps/app/docker/Dockerfile)
* [`6.2.4`, `6.2` (Dockerfile)](https://github.com/weseek/growi/blob/v6.2.4/apps/app/docker/Dockerfile)
* [`6.1.15`, `6.1` (Dockerfile)](https://github.com/weseek/growi/blob/v6.1.15/apps/app/docker/Dockerfile)


What is GROWI?
-------------

GROWI is a team collaboration software and it forked from [crowi](https://github.com/weseek/crowi/crowi)

see: [weseek/growi](https://github.com/weseek/growi)


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
    weseek/growi
```

and go to `http://localhost:3000/` .

If you use ElasticSearch, type this:

```bash
docker run -d \
    -e MONGO_URI=mongodb://MONGODB_HOST:MONGODB_PORT/growi \
    -e ELASTICSEARCH_URI=http://ELASTICSEARCH_HOST:ELASTICSEARCH_PORT/growi \
    weseek/growi
```


### docker-compose

Using docker-compose is the fastest and the most convenient way to boot GROWI.

see: [weseek/growi-docker-compose](https://github.com/weseek/growi-docker-compose)


Configuration
-----------

See [GROWI Docs: Admin Guide](https://docs.growi.org/en/admin-guide/) ([en](https://docs.growi.org/en/admin-guide/)/[ja](https://docs.growi.org/ja/admin-guide/)).

### Environment Variables

- [GROWI Docs: Environment Variables](https://docs.growi.org/en/admin-guide/admin-cookbook/env-vars.html)


Issues
------

If you have any issues or questions about this image, please contact us through  [GitHub issue](https://github.com/weseek/growi-docker/issues).

