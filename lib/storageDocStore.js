const azure = require('azure-storage');
const memoryCache = require('memory-cache');
const Q = require('q');
const URL = require('url');

const ttl = 60000;

class AzureStorageDocStore {
  constructor(account, key, name) {
    this.account = account;
    this.key = key;
    this.name = name;
  }

  connect() {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.service = azure.createBlobService(this.account, this.key).withFilter(retryOperations);

    const deferred = Q.defer();
    this.service.createContainerIfNotExists(this.name, (error, result, response) => {
      if (error) {
        return deferred.reject(error);
      }
      deferred.resolve(this.service);
    });
    return deferred.promise;
  }

  upsert(document) {
    const deferred = Q.defer();
    const blobName = this._getBlobName(document._metadata.type, document._metadata.url);
    const text = JSON.stringify(document);
    this.service.createBlockBlobFromText(this.name, blobName, text, (error, result, response) => {
      if (error) {
        return deferred.reject(error);
      }
      this.service.setBlobMetadata(this.name, blobName, { etag: document._metadata.etag }, (error, result, response) => {
        if (error) {
          return deferred.reject(error);
        }
        memoryCache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, ttl);
        deferred.resolve(result);
      });
    });
    return deferred.promise;
  }

  get(type, url) {
    const cached = memoryCache.get(url);
    if (cached) {
      return Q(cached.document);
    }

    const deferred = Q.defer();
    const blobName = this._getBlobName(type, url);
    this.service.getBlobToText(this.name, blobName, (error, text, blob, response) => {
      if (error) {
        return deferred.reject(error);
      }
      const result = JSON.parse(text);
      memoryCache.put(url, { etag: result._metadata.etag, document: result }, ttl);
      deferred.resolve(result);
    });
    return deferred.promise;
  }

  etag(type, url) {
    const cached = memoryCache.get(url);
    if (cached) {
      return Q(cached.etag);
    }

    const deferred = Q.defer();
    const blobName = this._getBlobName(type, url);
    this.service.getBlobMetadata(this.name, blobName, (error, blob, response) => {
      deferred.resolve(error ? null : blob.metadata.etag);
    });
    return deferred.promise;
  }

  close() {
  }

  _getBlobName(type, url) {
    const parsed = URL.parse(url, true);
    let blobName = `${type}${parsed.path.toLowerCase()}`;
    if (parsed.query.page) {
      blobName = `${blobName}/page/${parsed.query.page}`;
    }
    return blobName;
  }
}

module.exports = AzureStorageDocStore;