const Q = require('q');

class InmemoryDocStore {
  constructor(logOut) {
    this.collections = {};
    this.logOut = !!logOut;
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
    if (this.logOut) {
      console.log(collection[selfHref]);
    }
    return Q(document);
  }

  get(type, url) {
    // TODO interesting question as to what a mongo store would do if the doc does not exist.
    const collection = this.collections[type];
    if (!collection) {
      return Q.reject();
    }
    return collection[url] ? Q(collection[url]) : Q.reject();
  }

  etag(type, url) {
    // TODO interesting question as to what a mongo store would do if the doc does not exist.
    const collection = this.collections[type];
    if (!collection) {
      return Q(null);
    }
    let result = collection[url];
    result = result ? result._metadata.etag : null;
    return Q(result);
  }

  close() {
    content = {};
  }
}

module.exports = InmemoryDocStore;