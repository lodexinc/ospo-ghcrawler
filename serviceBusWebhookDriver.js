const config = require('painless-config');
const CrawlQueue = require('./crawlqueue');
const MongoDocStore = require('./mongodocstore');
const requestor = require('ghrequestor');
const receiver = require('ghcrawler').webhookReceiver;
const finder = require('ghcrawler').eventFinder;
const webhookQueue = require('ghcrawler').serviceBusQueue;

const connectionKey = config.get('GHCRAWLER_EVENT_BUS');
const connectionSpec = `Endpoint=sb://ghcrawlerprod.servicebus.windows.net/;SharedAccessKeyName=ghcrawlerdev;SharedAccessKey=${connectionKey}`;
const listener = new webhookQueue(connectionSpec);

const requestorInstance = new requestor({
  headers: {
    authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
  }
});

const store = new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'));
store.connect(() => {
  const eventFinder = new finder(requestorInstance, store);

  const eventSink = new CrawlQueue();
  receiver.watch(listener, eventFinder, eventSink);
});