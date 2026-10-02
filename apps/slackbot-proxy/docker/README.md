
GROWI Slackbot Proxy Server Official docker image
==============================================

[![Node CI for slackbot-proxy](https://github.com/growilabs/growi/actions/workflows/ci-slackbot-proxy.yml/badge.svg)](https://github.com/growilabs/growi/actions/workflows/ci-slackbot-proxy.yml) [![docker-pulls](https://img.shields.io/docker/pulls/weseek/growi-slackbot-proxy.svg)](https://hub.docker.com/r/weseek/growi-slackbot-proxy/)


Supported tags and respective Dockerfile links
------------------------------------------------

* [`1.0.0`, `latest` (Dockerfile)](https://github.com/growilabs/growi/blob/master/apps/slackbot-proxy/docker/Dockerfile)


What is GROWI Slackbot Proxy Server?
----------------------------------

The proxy server produced by GROWI Development Team, provides the backend for Slack App (Bot) to integrate GROWI Apps and Slack workspaces.

see: (TBD)


Requirements
-------------

* MySQL (>= 8.0)

### Optional Dependencies

* 


Usage
-----

Create `.env.production.local`

```
```

```bash
docker run -d \
    -e TYPEORM_CONNECTION=mysql \
    -e TYPEORM_HOST=mysqlserver \
    -e TYPEORM_DATABASE=growi-slackbot-proxy \
    -e TYPEORM_USERNAME=growi-slackbot-proxy \
    -e TYPEORM_PASSWORD=CHANGE-IT \
    -e SLACK_CLIENT_ID=000000000000.0000000000000 \
    -e SLACK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    -e SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    weseek/growi-slackbot-proxy
```

and go to `http://localhost:8080/` .

### docker-compose

(TBD)

Configuration
-----------

(TBD)

### Environment Variables

(TBD)
