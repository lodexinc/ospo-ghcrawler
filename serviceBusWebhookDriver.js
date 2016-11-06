const config = require('painless-config');
const CrawlQueue = require('./crawlqueue');
const MongoDocStore = require('./mongodocstore');
const requestor = require('ghrequestor');
const receiver = require('ghcrawler').webhookReceiver;
const finder = require('ghcrawler').eventFinder;

// Setup the event trigger mechanism to read off a service bus topic and format
// the events as { type: type, qualifier: qualifier } if they are relevant
const repoEvents = new Set(['issues', 'issue_comment', 'push', 'status']);
const orgEvents = new Set(['membership']);
const formatter = message => {
  const type = message.customProperties.event;
  const event = JSON.parse(message.body);
  let qualifier = null;
  if (repoEvents.has(type)) {
    qualifier = event.repository.full_name;
  } else if (orgEvents.has(type)) {
    qualifier = event.organization.login.toLowercase();
  }
  return qualifier ? { type: type, qualifier: qualifier } : null;
};
const serviceBusUrl = config.get('GHCRAWLER_EVENT_BUS_URL');
const eventTrigger = new ServiceBusCrawlQueue(serviceBusUrl, 'webhookevents', 'ghcrawlerdev', formatter);

// Create the github requestor to use and preconfigure with needed secrets etc.
const requestorInstance = new requestor({
  headers: {
    authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
  }
});

// Connect to the underlying doc store and then fire up the
const store = new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'));
store.connect(() => {
  const eventFinder = new finder(requestorInstance, store);

  const eventSink = new CrawlQueue();
  receiver.watch(eventTrigger, eventFinder, eventSink);
});