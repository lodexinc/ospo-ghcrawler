const moment = require('moment');
const Q = require('q');

class LoggingStore {
  constructor(baseStore, blobService, name, options) {
    this.baseStore = baseStore;
    this.service = blobService;
    this.name = name;
    this.options = options;
    this.blobSequenceNumber = 1;
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
    const createContainerIfNotExists = Q.nbind(this.service.createContainerIfNotExists, this.service);
    return createContainerIfNotExists(name);
  }

  _appendBlobFromText(text) {
    const appendBlockFromText = Q.nbind(this.service.appendBlockFromText, this.service);
    const createAppendBlobFromText = Q.nbind(this.service.createAppendBlobFromText, this.service);
    const currentBlobSequenceNumber = this.blobSequenceNumber;
    return appendBlockFromText(this.name, this._getBlobName(), text)
      .catch(error => {
        if (error.statusCode === 404) { // NotFound
          return createAppendBlobFromText(this.name, this._getBlobName(), text);
        } else if (error.statusCode === 409) { // BlockCountExceedsLimit (after 50,000 writes)
          if (currentBlobSequenceNumber === this.blobSequenceNumber) {
            this.blobSequenceNumber++;
            return createAppendBlobFromText(this.name, this._getBlobName(), text);
          }
          const deferred = Q.defer();
          let numberOfFailures = 0;
          const interval = setInterval(() => { // Wait until blob creation has been completed.
            return appendBlockFromText(this.name, this._getBlobName(), text)
              .then(() => {
                clearInterval(interval);
                deferred.resolve();
              })
              .catch(appendError => {
                numberOfFailures++;
                if (numberOfFailures > 30) {
                  clearInterval(interval);
                  deferred.reject(appendError);
                }
              });
          }, 1000);
          return deferred.promise;
        } else {
          throw error;
        }
      });
  }

  _getBlobName() {
    return `${this.name}_${moment.utc().format('YYYY_MM_DD_HH')}_${this.blobSequenceNumber}.json`;
  }
}

module.exports = LoggingStore;
