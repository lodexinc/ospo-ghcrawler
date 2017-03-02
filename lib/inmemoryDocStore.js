// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

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

  listDocuments(pattern) {
    const result = [];
    for (let collection in collections) {
      for (let document in collection.for) {
        const entry = Object.assign({}, document._metadata);
        this._collapseExtraMetadata(document._metadata, entry);
        result.push(entry);
      }
    }
  }

  _collapseExtraMetadata(source, target) {
    if (source.extra) {
      Object.getOwnPropertyNames(source.extra).forEach(property => {
        target[`extra_${property}`] = source.extra[property];
      });
    }
  }

  close() {
    content = {};
  }
}

module.exports = InmemoryDocStore;