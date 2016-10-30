const Mongo = require('mongodb');

class MongoDocStore {
  constructor(url) {
    this.url = url;
    this.client = Mongo.MongoClient;
  }

  connect(callback) {
    this.client.connect(this.url, (err, db) => {
      this.db = db;
      return callback(err, db);
    });
  }

  upsert(document, callback) {
    const selfHref = document._metadata.links.self.href;
    this.db.collection(document._metadata.type).updateOne({ '_metadata.links.self': selfHref }, document, { upsert: true }, callback);
  }

  close() {
    this.db.close();
  }
}

module.exports = MongoDocStore;