
GROWI PDF Converter Official docker image
==============================================

[![Node CI for pdf-converter](https://github.com/weseek/growi/actions/workflows/ci-pdf-converter.yml/badge.svg)](https://github.com/weseek/growi/actions/workflows/ci-pdf-converter.yml) [![docker-pulls](https://img.shields.io/docker/pulls/growilabs/pdf-converter.svg)](https://hub.docker.com/r/growilabs/pdf-converter/)


Supported tags and respective Dockerfile links
------------------------------------------------

* [`1.0.0`, `latest` (Dockerfile)](https://github.com/weseek/growi/blob/master/apps/pdf-converter/docker/Dockerfile)


What is GROWI PDF Converter used for?
---------------------------------------

GROWI provides a feature that bulk exports pages in PDF format.
PDF Converter is necessary to convert markdown pages to PDF during that process.


Usage
-----

```bash
docker run -d growilabs/pdf-converter
```

and go to `http://localhost:3010/` .

### docker-compose

PDF Converter is configured by default in [weseek/growi-docker-compose](https://github.com/weseek/growi-docker-compose). GROWI will be able to request to PDF Converter after `docker-compose up`.
