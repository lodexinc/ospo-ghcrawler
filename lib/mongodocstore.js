const Mongo = require('mongodb');
const Q = require('q');
const cache = require('memory-cache');

const ttl = 60000;

class MongoDocStore {
  constructor(url) {
    this.url = url;
    this.client = Mongo.MongoClient;
  }

  // TODO likely need to test for connectedness.  Had a c
  connect() {
    return this.client.connect(this.url).then(db => {
      this.db = db;
    });
  }

  upsert(document) {
    const selfHref = document._metadata.links.self.href;
    const collection = this.db.collection(document._metadata.type);
    // TODO Figure out how to do a conditional update based on the etag or a distributed lock around processing of a url
    return collection.updateOne({ '_metadata.links.self.href': selfHref }, document, { upsert: true }).then(result => {
      cache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, ttl);
      return result;
    });
  }

  get(type, url) {
    const cached = cache.get(url);
    if (cached) {
      return Q(cached.document);
    }
    return this.db.collection(type).findOne({ '_metadata.url': url }).then(value => {
      if (value) {
        cache.put(url, { etag: value._metadata.etag, document: value }, ttl);
        return value;
      }
      return null;
    });
  }

  etag(type, url) {
    const cached = cache.get(url);
    if (cached) {
      return Q(cached.etag);
    }
    return this.db.collection(type).findOne({ '_metadata.url': url }).then(value => {
      if (value) {
        cache.put(url, { etag: value._metadata.etag, document: value }, ttl);
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