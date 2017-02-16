# OSPO GHCrawler
[GHCrawler](https://github.com/Microsoft/ghcrawler) is a service that systematically walks GitHub APIs and harvests data about a specified set of repos and orgs.  The function here is the *getting started* infrastructure for running that system. The crawler can be configured to use a variety of different queuing (e.g., AMQP 1.0 and AMQP 0.9 compatible queues like Azure ServiceBus and Rabbit MQ, respectively) and storage technologies (e.g., Azure Blob and MongoDB). You can create your own infrastructure plugins to use different technologies.  

# Running in-memory
The easiest way try our the crawler is to run it in memory. You can get up and running in a couple minutes.  This approach does not scale and is not persistent but it's dead simple.

# Running Crawler In A Box (CIABatta)
For small to medium production systems you can run in Docker with Mongo and Rabbit using the Crawler-in-a-box (CIABatta) approach. This comes with a handy shell script for queuing up orgs and repos for harvesting as well as a dashboard for observing and controlling the crawler service.

This is an evolving solution and the steps for running will be simplified published, ready-to-use images on Docker Hub. For now, follow these steps

1. Clone the [Microsoft/ospo-ghcrawler](https://github.com/Microsoft/ospo-ghcrawler.git) and [Microsoft/crawler-dashboard](https://github.com/Microsoft/crawler-dashboard.git) repos.
1. In a command prompt, go to each repo directory and run ```npm install```.
1. Set environment variable CRAWLER_GITHUB_TOKENS to the tokens and traits you want to use. For example, ```export CRAWLER_GITHUB_TOKENS="<token1>#public;<token2>#admin"```.  Add as many tokens as you like.
1. In a command prompt go to ospo-ghcrawler/docker and run “docker-compose up”.
1. Once the containers are up and running, start the service crawling by going to Crawler Dashboard at [http://localhost:4000](http://localhost:4000). On the righthand side, change the ```crawler/count``` to 1 and click ```Update``` button.  You should see some crawler related messages in the container output.
1. Queue a GitHub organization or repo to be crawled using either ```docker exec docker_crawler_1 bake contcoso-d``` for an org or ```docker exec docker_crawler_1 bake contoso-d/angle``` for a specific repo.
1. Check out the data in Metabase as it data flows in.  Go to Metabase at [http://localhost:5000](http://localhost:5000)

By default the containers  expose a number of endpoints at different ports on localhost. Note that if you have trouble starting the containers due to port conflicts, either shutdown your services using these ports or edit the docker/docker-compose.yml file to change the ports.

* Crawler Dashboard (4000)
* Crawler (3000)
* MongoDB (27017 and 28017)
* Redis (6379)
* RabbitMQ (5672 and 15672)
* Metabase (5000)

## Updating the default Metabase configuration:
The Metabase configured by default has some canned queries and a dashboard. If you want to clear that out and start fresh, do the following:

1. Ensure you're starting from a completely clean container (docker-compose down && docker-compose up).
1. Crawl a small org to populate Mongo so you have schema/sample data to work with.
1. Open the Metabase URL and configure the questions, dashboard, etc. you want
  1. REMEMBER: Any changes you make will be persisted
1. Copy the Metabase database by changing to the docker/metabase folder in the ospo-ghcrawler repository and running:
  ```docker cp docker_metabase_1:/var/opt/metabase/dockercrawler.db.mv.db .```

Production Docker deployment using Kubernetes or the like has been discussed but not yet planned. If you have a desire to do this, please open an issue or better yet a PR and lets see what can be done. 

# Deploying native
The crawler and associated bits can also be run directly on VMs or as an app service. This structure typically uses cloud-based infrastructure for queuing, storage and redis. For example, this project comes with adapters for Azure Service Bus queuing and Azure Blob storage. The APIs on these adpaters is very slim so it is easy to for you to implement (and contribute) more.

Setting up the crawler requires setting a number of environment variables.

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

# Tips

* Clearing queues -- In its normal redis configuration, the crawler uses redis to keep track of what is in the queues. This deduplicates queuing and dramatically reduces the number of requests needing to be processed.  In the crawler dashboard is is possible to recreate the queues.  This is a convenient way to clear them out.  When doing this however, you must also clear the associated keys from redis that cache the queue content.  Typically those keys are of the form ```<environment>:<queue provider>:<path>```.  So for an AMPQ (i.e., RabbitMQ) setup running on the local machine the keys would look like ```localhost:amqp:<path>```. Use whatever redis client you like to clear these keys (possibly thousands).  We use Redis Desktop Manager but any tool that does the job will do.  Adding this redis clearing to the dashboard's recreate function is on the list of things to implement.

* Starting the crawler -- Due to some caching issues, you may need to ```Stop``` the crawler in the dashboard before you can start it using the update button as described above.

# Known issues

It is clearly early days for the crawler so there are a number of things left to do. These will be collected in repo issues. Note that the remaining issue set has yet to be populated.

Broadly speaking there are several types of work:

* Documentation -- The crawler code itself is relatively straightforward but some of the architecture, control and extensibility points are not called out.
* Ease of use -- There are a number of places where running and manaing the crawler is just clumsy and error prone
* Completeness -- There are a few functional gaps in certain scenarios that need to be addressed.
* Docker configuration -- Several items in making the Docker configuration real
* Analysis and insights -- Metabase is supplied in the Docker configuration but relatively little has been done with analyzing the harvested data.


## Runtime

### Docker items
1. Data persistence
1. Create separate docker-compose for general usage vs development
  * Development should use local source code and enable Node debugging
  * Both should allow end to end crawling with a single command (e.g. crawl orgName githubToken)
1. Publish images for Crawler Dashboard and Crawler to Docker Hub
