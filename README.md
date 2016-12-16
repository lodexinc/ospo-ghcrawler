# OSPO GHCrawler
Open Source Programs Office GitHub Crawler

## Build
`npm install`

## Test
#### Unit
`npm test`
#### Integration
`npm run integration`

## Run
#### Start Application
`node ./bin/www.js`
#### Start or Reconfigure Crawling
`curl -i -H "X-token: test1" -H "Content-Type: application/json" -X PATCH -d '[{ "op": "replace", "path": "/crawler/count", "value": 1 }, { "op": "replace", "path": "/crawler/orgList", "value": ["contoso-d"] }, { "op": "replace", "path": "/queuing/credit", "value": 10 }]' http://localhost:3000/config`

#### Add to Queue
`curl -i -H "X-token: test1" -H "Content-Type: application/json" -X POST -d '{"type": "org", "url": "https://api.github.com/orgs/contoso-d", "policy": "reprocessAndDiscover"}' http://localhost:3000/requests`

## Configuration
```
{
  "NODE_ENV": "localhost",
  "GHCRAWLER_MODE": "Standard",
  "GHCRAWLER_INSIGHTS_KEY": "[SECRET]",
  "GHCRAWLER_ORGS_FILE": "../orgs",
  "GHCRAWLER_GITHUB_TOKENS": "[SECRET]",
  "GHCRAWLER_REDIS_URL": "peoplesvc-dev.redis.cache.windows.net",
  "GHCRAWLER_REDIS_ACCESS_KEY": "[SECRET]",
  "GHCRAWLER_REDIS_PORT": 6380,
  "GHCRAWLER_QUEUE_PROVIDER": "amqp10",
  "GHCRAWLER_AMQP10_URL": "amqps://RootManageSharedAccessKey:[SECRET]@ghcrawlerdev.servicebus.windows.net",
  "GHCRAWLER_SERVICEBUS_TOPIC": "ghcrawlerdev",
  "GHCRAWLER_STORE_PROVIDER": "azure",
  "GHCRAWLER_STORAGE_NAME": "ghcrawlerdev",
  "GHCRAWLER_STORAGE_ACCOUNT": "ghcrawlerdev",
  "GHCRAWLER_STORAGE_KEY": "[SECRET]",
  "GHCRAWLER_DOCLOG_STORAGE_ACCOUNT": "ghcrawlerdev",
  "GHCRAWLER_DOCLOG_STORAGE_KEY": "[SECRET]"
}
```
