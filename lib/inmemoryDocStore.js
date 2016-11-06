const Q = require('q');

class InmemoryDocStore {
  constructor() {
    this.collections = {};
  }

  connect() {
    return Q(null);
  }

  upsert(document) {
    const selfHref = document._metadata.links.self.href;
    const type = document._metadata.type;
    let collection = this.collections[type];
    if (!collection) {
      collection = {};
      this.collections[type] = collection;
    }
    collection[selfHref] = document;
    return Q(document);
  }

  etag(type, url, callback) {
    const collection = this.collections[type];
    if (!collection) {
      return callback ? callback(null, false) : Q(null);
    }
    let result = collection[url];
    result = result ? result.etag : null;
    return callback ? callback(null, result) : Q(result);
  }

  close() {
    content = {};
  }
}

module.exports = InmemoryDocStore;