const moment = require('moment');
const Q = require('q');

class LoggingStore {
  constructor(baseStore, blobService, name, options) {
    this.baseStore = baseStore;
    this.service = blobService;
    this.name = name;
    this.options = options;
  }

  connect() {
    return this.baseStore.connect().then(() => {
      return this._createContainer(this.name);
    });
  }

  upsert(document) {
    return this.baseStore.upsert(document).then(() => {
      const text = JSON.stringify(document) + '\n';
      return this._appendBlobFromText(text);
    });
  }

  get(type, key) {
    return this.baseStore.get(type, key);
  }

  etag(type, key) {
    return this.baseStore.etag(type, key);
  }

  close() {
    return this.baseStore.close();
  }

  _createContainer(name) {
    const deferred = Q.defer();
    this.service.createContainerIfNotExists(name, (error, result, response) => {
      if (error) {
        return deferred.reject(error);
      }
      deferred.resolve(this.service);
    });
    return deferred.promise;
  }

  _appendBlobFromText(text) {
    const deferred = Q.defer();
    const blobName = this._getBlobName();
    this.service.appendFromText(this.name, blobName, text, (appendError) => {
      if (appendError) {
        if (appendError.statusCode === 404) { // Not Found
          this.service.createAppendBlobFromText(this.name, blobName, text, (createError) => {
            if (createError) {
              return deferred.reject(createError);
            }
            deferred.resolve();
          });
        } else {
          deferred.reject(appendError);
        }
      } else {
        deferred.resolve();
      }
    });
    return deferred.promise;
  }

  _getBlobName() {
    return `${this.name}_${moment.utc().format('YYYY_MM_DD_HH')}.json`;
  }
}

module.exports = LoggingStore;
