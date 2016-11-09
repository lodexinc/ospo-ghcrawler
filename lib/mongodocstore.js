const Mongo = require('mongodb');
const Q = require('q');
const cache = require('memory-cache');

const ttl = 60000;

class MongoDocStore {
  constructor(url) {
    this.url = url;
    this.client = Mongo.MongoClient;
  }

  connect() {
    return Q.denodeify(this.client.connect.bind(this.client))(this.url).then(db => {
      this.db = db;
    });
  }

  upsert(document) {
    const selfHref = document._metadata.links.self.href;
    const collection = this.db.collection(document._metadata.type);
    return Q.denodeify(collection.updateOne.bind(collection))({ '_metadata.links.self.href': selfHref }, document, { upsert: true }).then(result => {
      cache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, ttl);
      return result;
    });
  }

  get(type, url, callback) {
    const cached = cache.get(url);
    if (cached) {
      return Q(cached.document);
    }
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else {
        if (value) {
          cache.put(url, { etag: value._metadata.etag, document: value }, ttl);
          deferred.resolve(value);
        } else {
          deferred.resolve(null);
        }
      }
    });
    this.db.collection(type).findOne({ '_metadata.url': url }, realCallback);
    return callback ? null : deferred.promise;
  }

  etag(type, url, callback) {
    const cached = cache.get(url);
    if (cached) {
      return Q(cached.etag);
    }
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else {
        if (value) {
          cache.put(url, { etag: value._metadata.etag, document: value }, ttl);
          deferred.resolve(value._metadata.etag);
        } else {
          deferred.resolve(null);
        }
      }
    });
    this.db.collection(type).findOne({ '_metadata.url': url }, realCallback);
    return callback ? null : deferred.promise;
  }

  close() {
    this.db.close();
  }
}

module.exports = MongoDocStore;