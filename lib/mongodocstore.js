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

  close() {
    this.db.close();
  }
}

module.exports = MongoDocStore;