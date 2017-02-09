# OSPO GHCrawler
Implementations and configuration of an API crawler that works over GitHub API.  The crawler can be configured
to use a variety of different queuing (e.g., AMQP 1.0 and AMQP 0.9 compatible queues like Azure ServiceBus and Rabbit MQ, respectively)
and storage technologies (e.g., Azure Blob and MongoDB). Each team will want to configure their system to suit their
infrastructure.

## Working with the code

#### Build
`npm install`

#### Unit test
`npm test`

#### Integration test
`npm run integration`

#### Run
`node ./bin/www.js`

## Configuring and controlling the crawler

#### Reconfigure crawling
`curl -i -H "X-token: test1" -H "Content-Type: application/json" -X PATCH -d '[{ "op": "replace", "path": "/crawler/count", "value": 1 }, { "op": "replace", "path": "/crawler/orgList", "value": ["contoso-d"] }, { "op": "replace", "path": "/queuing/credit", "value": 10 }]' http://localhost:3000/config`

#### Add to Queue
`curl -i -H "X-token: test1" -H "Content-Type: application/json" -X POST -d '{"type": "org", "url": "https://api.github.com/orgs/contoso-d", "policy": "reprocessAndDiscover"}' http://localhost:3000/requests`

## Configuration
```
{
  "NODE_ENV": "localhost",
  "CRAWLER_MODE": "Standard",
  "CRAWLER_OPTIONS_PROVIDER": ["defaults" | "memory" | "redis"],
  "CRAWLER_INSIGHTS_KEY": "[SECRET]",
  "CRAWLER_ORGS_FILE": "../orgs",
  "CRAWLER_GITHUB_TOKENS": "[SECRET]",
  "CRAWLER_REDIS_URL": "peoplesvc-dev.redis.cache.windows.net",
  "CRAWLER_REDIS_ACCESS_KEY": "[SECRET]",
  "CRAWLER_REDIS_PORT": 6380,
  "CRAWLER_QUEUE_PROVIDER": "amqp10",
  "CRAWLER_AMQP10_URL": "amqps://RootManageSharedAccessKey:[SECRET]@ghcrawlerdev.servicebus.windows.net",
  "CRAWLER_QUEUE_PREFIX": "ghcrawlerdev",
  "CRAWLER_STORE_PROVIDER": "azure",
  "CRAWLER_STORAGE_NAME": "ghcrawlerdev",
  "CRAWLER_STORAGE_ACCOUNT": "ghcrawlerdev",
  "CRAWLER_STORAGE_KEY": "[SECRET]",
  "CRAWLER_DOCLOG_STORAGE_ACCOUNT": "ghcrawlerdev",
  "CRAWLER_DOCLOG_STORAGE_KEY": "[SECRET]"
}
```

## Running Crawler In A Box (CIAB-atta)

This is a temporary solution until we publish ready to use images on Docker Hub.

1. Clone Microsoft/ospo-ghcrawler and Microsoft/crawler-dashboard
1. Set environment variable CRAWLER_GITHUB_TOKENS to the tokens and traits you want to use
1. In a command prompt go to the ospo-ghcrawler repository and run “docker-compose up”
1. Workaround: Wait until all the startup messages stop and open a new command prompt in the same directory and run “docker-compose restart crawler”
  1. This will restart the crawler container allowing it to connect to RabbitMQ successfully
1. Go to Crawler Dashboard (http://localhost:4000) and change the crawler count to 1
1. Go to RabbitMQ Management (http://localhost:15672) and publish the following to the crawlerdocker-normal queue:

  ```
  {
    "type": "org",
    "url": "https://api.github.com/orgs/contoso-d",
    "policy": "default"
  }
  ```

1. Go to Metabase (http://localhost:5000) and connect to the Mongo dataset:

    ```
    Name: Anything
    Host: mongo
    Port: 27017
    Database name: ghcrawler
    ```

Exposed endpoints:

* Crawler Dashboard (4000)
* Crawler (3000)
* MongoDB (27017 and 28017)
* Redis (6379)
* RabbitMQ (5672 and 15672)
* Metabase (5000)

TODO:

1. Fix bug with RabbitMQ not connecting on startup
1. Pre-configure Metabase
1. Data persistence
1. Create separate docker-compose for general usage vs development
  * Development should use local source code and enable Node debugging
  * Both should allow end to end crawling with a single command (e.g. crawl orgName githubToken)
1. Publish images for Crawler Dashboard and Crawler to Docker Hub