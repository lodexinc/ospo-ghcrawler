const memoryCache = require('memory-cache');
const Mongo = require('mongodb');
const promiseRetry = require('promise-retry');
const Q = require('q');

const ttl = 6000;

class MongoDocStore {
  constructor(url) {
    this.url = url;
    this.client = Mongo.MongoClient;
  }

  connect() {
    return promiseRetry((retry, number) => {
      return this.client.connect(this.url).then(db => {
        this.db = db;
      })
        .catch(retry);
    });
  }

  upsert(document) {
    const selfHref = document._metadata.links.self.href;
    const collection = this.db.collection(document._metadata.type);
    return collection.updateOne({ '_metadata.links.self.href': selfHref }, document, { upsert: true }).then(result => {
      memoryCache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, ttl);
      return result;
    });
  }

  get(type, url) {
    const cached = memoryCache.get(url);
    if (cached) {
      return Q(cached.document);
    }
    return this.db.collection(type).findOne({ '_metadata.url': url }).then(value => {
      if (value) {
        memoryCache.put(url, { etag: value._metadata.etag, document: value }, ttl);
        return value;
      }
      return null;
    });
  }

  etag(type, url) {
    const cached = memoryCache.get(url);
    if (cached) {
      return Q(cached.etag);
    }
    return this.db.collection(type).findOne({ '_metadata.url': url }).then(value => {
      if (value) {
        memoryCache.put(url, { etag: value._metadata.etag, document: value }, ttl);
        return value._metadata.etag;
      }
      return null;
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = MongoDocStore;