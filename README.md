# OSPO GHCrawler
[GHCrawler](https://github.com/Microsoft/ghcrawler) is a service that systematically walks GitHub APIs and harvests data about a specified set of repos and orgs.  The function here is the *getting started* infrastructure for running that system. The crawler can be configured to use a variety of different queuing (e.g., AMQP 1.0 and AMQP 0.9 compatible queues like Azure ServiceBus and Rabbit MQ, respectively) and storage technologies (e.g., Azure Blob and MongoDB). You can create your own infrastructure plugins to use different technologies.  

# Running in-memory
The easiest way try our the crawler is to run it in memory. You can get up and running in a couple minutes.  This approach does not scale and is not persistent but it's dead simple.

# Running Crawler In A Box (CIABatta)
For small to medium production systems you can run in Docker with Mongo and Rabbit using the Crawler-in-a-box (CIABatta) approach. This comes with a handy shell script for queuing up orgs and repos for harvesting as well as a dashboard for observing and controlling the crawler service.

This is an evolving solution and the steps for running will be simplified published, ready-to-use images on Docker Hub. For now, follow these steps

1. Clone the [Microsoft/ospo-ghcrawler](https://github.com/Microsoft/ospo-ghcrawler.git) and [Microsoft/crawler-dashboard](https://github.com/Microsoft/crawler-dashboard.git) repos.
1. Set environment variable CRAWLER_GITHUB_TOKENS to the tokens and traits you want to use. For example, ```export CRAWLER_GITHUB_TOKENS="<token1>#public;<token2>#admin"```.
1. In a command prompt go to ospo-ghcrawler/docker and run “docker-compose up”.
1. Once the containers are up and running, start the servie crawling by going to Crawler Dashboard (```http://localhost:4000```). On the righthand side, change the ```crawler/count``` to 1 and click ```Update``` button.  You should see some crawler related messages in the container output.
1. Queue a GitHub organization to be crawled with ```docker exec docker_crawler_1 bake contoso-d``` or a specific repository with ```docker exec docker_crawler_1 bake contoso-d/angle```.
1. Go to Metabase (http://localhost:5000)

Exposed endpoints:

* Crawler Dashboard (4000)
* Crawler (3000)
* MongoDB (27017 and 28017)
* Redis (6379)
* RabbitMQ (5672 and 15672)
* Metabase (5000)

Updating the default Metabase configuration:

1. Ensure you're starting from a completely clean container (docker-compose down && docker-compose up)
1. Crawl a small org to populate Mongo so you have schema/sample data to work with
1. Open metabase and configure the questions, dashboard, etc.
  1. REMEMBER: Any changes you make will be persisted
1. Copy the Metabase database to the docker/metabase folder in the repository:
  ```docker cp docker_metabase_1:/var/opt/metabase/dockercrawler.db.mv.db .```

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



TODO:

1. Pre-configure Metabase
1. Data persistence
1. Create separate docker-compose for general usage vs development
  * Development should use local source code and enable Node debugging
  * Both should allow end to end crawling with a single command (e.g. crawl orgName githubToken)
1. Publish images for Crawler Dashboard and Crawler to Docker Hub
