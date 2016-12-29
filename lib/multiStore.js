// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');

class MultiStore {
  constructor(oldStore, newStore, options) {
    this.oldStore = oldStore;
    this.newStore= newStore;
    this.options = options;
  }

  connect() {
    return Q.all([this.oldStore.connect(), this.newStore.connect()]);
  }

  upsert(document) {
    return this.newStore.upsert(document);
  }

  get(type, url) {
    return this.newStore.get(type, url).catch(error => {
      return this.oldStore.get(type, url);
    });
  }

  etag(type, url) {
    return this.newStore.etag(type, url).catch(error => {
      return this.oldStore.etag(type, url);
    });
  }

  close() {
    return Q.all([this.oldStore.close(), this.newStore.close()]);
  }
}

module.exports = MultiStore;