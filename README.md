# OSPO GHCrawler
[GHCrawler](https://github.com/Microsoft/ghcrawler) is a service that systematically walks GitHub APIs and harvests data about a specified set of repos and orgs.  The function here is the *getting started* infrastructure for running that system. The crawler can be configured to use a variety of different queuing (e.g., AMQP 1.0 and AMQP 0.9 compatible queues like Azure ServiceBus and Rabbit MQ, respectively) and storage technologies (e.g., Azure Blob and MongoDB). You can create your own infrastructure plugins to use different technologies.

# Running in-memory
The easiest way try our the crawler is to run it in memory. You can get up and running in a couple minutes.  This approach does not scale and is not persistent but it's dead simple.

1. Clone the [Microsoft/ospo-ghcrawler](https://github.com/Microsoft/ospo-ghcrawler.git) repo.
1. Run ```npm install``` in the clone repo directory to install the prerequisites.
1. Run the crawler using ```node bin/www.js```.

Once the service is up and running, you should see some crawler related messages in the console output every few seconds. You can control the crawler using the ```cc``` command line tool described below. Note that since you are running in memory, if you kill the crawler process, all work will be lost. This mode is great for playing around with the crawler or testing.

# Running Crawler-In-A-Box (CIABatta)
If you want to persist the data gathered and create some insight dashboards in small to medium production system, you can run the crawler in Docker with Mongo, Rabbit, and Redis using the Crawler-in-a-box (CIABatta) approach. This setup also includes Metabase for building browser-based insgihts and gives you a browser-based control-panel for observing and controlling the crawler service.

***NOTE*** This is an evolving solution and the steps for running will be simplified published, ready-to-use images on Docker Hub. For now, follow these steps

1. Clone the [Microsoft/ospo-ghcrawler](https://github.com/Microsoft/ospo-ghcrawler.git) and [Microsoft/crawler-dashboard](https://github.com/Microsoft/crawler-dashboard.git) repos.
1. In a command prompt go to ```ospo-ghcrawler/docker``` and run ```docker-compose up```.

Once the containers are up and running, you should see some crawler related messages in the container's console output every few seconds. You can control the crawler either using the ```cc``` command line tool or a brower-based dashboard both of which are described below. To get insights with Metabase head over to http://localhost:5000 and query the data being collected.

You can also hookup directly to the crawler infrastructure. By default the containers expose a number of endpoints at different ports on localhost. Note that if you have trouble starting the containers due to port conflicts, either shutdown your services using these ports or edit the docker/docker-compose.yml file to change the ports.

* Crawler Dashboard (4000) -- Open http://localhost:4000 in your browser to see what's happening and control some behaivors and configurations
* Crawler (3000) -- Direct access to the REST API for the crawler
* MongoDB (27017 and 28017) -- Direct access to the Mongo DB
* Redis (6379) -- Observe what's happening in Redis. Not much else for you to do here
* RabbitMQ (5672 and 15672) -- Hit http://localhost:15672 with a browser to see and maange the RabbitMQ queues
* Metabase (5000) -- Hit http://localhost:5000 to get live insights in your browser

# Deploying native
For ultimate flexibility, the crawler and associated bits can be run directly on VMs or as an app service. This structure typically uses cloud-based infrastructure for queuing, storage and redis. For example, this project comes with adapters for Azure Service Bus queuing and Azure Blob storage. The APIs on these adpaters is very slim so it is easy to for you to implement (and contribute) more.

***Setting up this operating mode is a bit more involved and is not yet documented.***

# Controlling the crawler
Given a running crawler service (see above), you can control it using either a simple command line app or a browser-based dashboard.

## ```cc``` command line

The ```cc``` utility is in the ```bin``` directory of this repo. It can be run interactively or as a single command processor. The general format of using the command line is

  ```node cc [options] [command]```

where the available options are:

```-i``` -- Run in interactive mode

```-s <url>``` -- Control the crawler service running at the given url.  Defaults to http://localhost:3000.  You can also set the CRAWLER_SERVICE_URL environment variable.

and the available commands are:

 ```start [count]``` -- Start the crawler processing with count concurrent operations.  If count is not specified, 1 is the default.  On a reasonably fast network a count of 10 to 15 should be sufficient. This also depends on how many tokens you are using.

 ```stop``` -- Stop crawler processing. The crawler service is left running but it stops pulling requests off the queue.

 ```queue <requests...>``` -- Queues the given requests for processing. The requests parameter is a list of GitHub "org" and/or "org/repo" names.

```orgs <org orgs...>``` -- Set the crawler's to traverse only the GitHub orgs named in the given list.

```config``` -- Dumps the crawler service's configuration to the console.

```tokens <spec...>``` -- Set the GitHub tokens to be used by the crawler when calling GitHub APIs. The spec value is a list of token specs. Each spec has the form <token>#<trait>,<trait>... where the token is the GitHub OAuth or Personal Access token and the comma-separated list of traits identify what permissions the token has. The available traits are: ```public```, ```admin```, ```private```. You can list as many tokens and traits as you like. Note that you can also configure the GitHub tokens the CRAWLER_GITHUB_TOKENS environment variable instead **before starting the crawler**. For example, ```export CRAWLER_GITHUB_TOKENS="<token1>#public <token2>#admin"```.

A typical sequence shown in the snippet below configures the crawler with a set of tokens, configures the org filter set and then queues and starts the processing of the org.

```
> node bin/cc
http://localhost:3000> tokens 43984b2344ca575d0f0e097efd97#public 972bbdfe098098fa9ce082309#admin
http://localhost:3000> orgs contoso-d
http://localhost:3000> queue contoso-d
http://localhost:3000> start 5
http://localhost:3000> exit
>
```

## Browser dashboard

Some configurations (e.g., Docker) include a browser-based dashboard. This gives you live feedback on what the crawler is doing as well as better control over the crawler's queues and configuration. Note the dashboard has only partial function when used with the memory-based crawler service as it uses Redis to talk to the crawlers for certain operations.

### Running the dashboard
If you are using Docker setup, the dashboard will startup for free and be listening on http://localhost:4000. If you want to deploy or run the dashboard explicitly, clone the [Microsoft/crawler-dashboard](https://github.com/Microsoft/crawler-dashboard.git) repo and follow the instructions in [the README found there](https://github.com/Microsoft/crawler-dashboard/blob/develop/README.md).

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

## Updating the default Metabase for Docker configuratoins:
The Metabase configured by default has some canned queries and a dashboard. If you want to clear that out and start fresh, do the following:

1. Ensure you're starting from a completely clean container (docker-compose down && docker-compose up).
1. Crawl a small org to populate Mongo so you have schema/sample data to work with.
1. Open the Metabase URL and configure the questions, dashboard, etc. you want
  1. REMEMBER: Any changes you make will be persisted
1. Copy the Metabase database by changing to the docker/metabase folder in the ospo-ghcrawler repository and running:
  ```docker cp docker_metabase_1:/var/opt/metabase/dockercrawler.db.mv.db .```

Production Docker deployment using Kubernetes or the like has been discussed but not yet planned. If you have a desire to do this, please open an issue or better yet a PR and lets see what can be done.

# Working with the code

### Build
`npm install`

### Unit test
`npm test`

### Integration test
`npm run integration`

### Run
`node ./bin/www.js`



# stale content
1. Start the service crawling by going to Crawler Dashboard at [http://localhost:4000](http://localhost:4000). On the righthand side, change the ```crawler/count``` to 1 and click ```Update``` button.


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
