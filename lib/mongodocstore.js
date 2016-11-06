const Mongo = require('mongodb');
const Q = require('q');

class MongoDocStore {
  constructor(url) {
    this.url = url;
    this.client = Mongo.MongoClient;
  }

  connect() {
    return Q.denodeify(this.client.connect.bind(this.client)(this.url).then(db => {
      this.db = db;
    }));
  }

  upsert(document) {
    const selfHref = document._metadata.links.self.href;
    const collection = this.db.collection(document._metadata.type);
    return Q.denodeify(collection.updateOne.bind(collection))({ '_metadata.links.self': selfHref }, document, { upsert: true });
  }

  etag(type, url, callback) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else
        deferred.resolve(value ? value._metadata.etag : null);
    });
    this.db.collection('event').findOne({ '_metadata.links.self': url }, realCallback);
    return callback ? null : deferred.promise;
  }

  close() {
    this.db.close();
  }
}

module.exports = MongoDocStore;