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
    let collection = collections[type];
    if (!collection) {
      collection = {};
      collections[type] = collection;
    }
    collection[selfHref] = document;
    return Q(document);
  }

  etag(type, url, callback) {
    const collection = collections[type];
    if (!collection) {
      return Q(null);
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