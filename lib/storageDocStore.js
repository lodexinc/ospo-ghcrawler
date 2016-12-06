const memoryCache = require('memory-cache');
const Q = require('q');
const URL = require('url');

class AzureStorageDocStore {
  constructor(blobService, name, options) {
    this.service = blobService;
    this.name = name;
    this.options = options;
    this._getBlobNameFromKey = this.options.blobKey === 'url' ? this._getBlobNameFromUrl : this._getBlobNameFromUrn;
  }

  connect() {
    return this._createContainer(this.name);
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

  upsert(document) {
    const deferred = Q.defer();
    const blobName = this._getBlobNameFromDocument(document);
    const text = JSON.stringify(document);
    const options = { metadata: { etag: document._metadata.etag }, contentType: 'application/json' };
    this.service.createBlockBlobFromText(this.name, blobName, text, options, (error, result, response) => {
      if (error) {
        return deferred.reject(error);
      }
      memoryCache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, this.options.ttl);
      deferred.resolve(blobName);
    });
    return deferred.promise;
  }

  get(type, key) {
    const cached = memoryCache.get(key);
    if (cached) {
      return Q(cached.document);
    }

    const deferred = Q.defer();
    const blobName = this._getBlobNameFromKey(type, key);
    this.service.getBlobToText(this.name, blobName, (error, text, blob, response) => {
      if (error) {
        return deferred.reject(error);
      }
      const result = JSON.parse(text);
      memoryCache.put(key, { etag: result._metadata.etag, document: result }, this.options.ttl);
      deferred.resolve(result);
    });
    return deferred.promise;
  }

  etag(type, key) {
    const cached = memoryCache.get(key);
    if (cached) {
      return Q(cached.etag);
    }

    const deferred = Q.defer();
    const blobName = this._getBlobNameFromKey(type, key);
    this.service.getBlobMetadata(this.name, blobName, (error, blob, response) => {
      deferred.resolve(error ? null : blob.metadata.etag);
    });
    return deferred.promise;
  }

  close() {
    return Q();
  }

  _getBlobNameFromDocument(document) {
    const type = document._metadata.type;
    if (this.options.blobKey === 'url') {
      return this._getBlobNameFromUrl(type, document._metadata.url);
    }
    return this._getBlobNameFromUrn(type, document._metadata.links.self.href);
  }

  _getBlobNameFromUrl(type, url) {
    if (!(url.startsWith('http:') || url.startsWith('https:'))) {
      return url;
    }
    const parsed = URL.parse(url, true);
    return `${type}${parsed.path.toLowerCase()}.json`;
  }

  _getBlobNameFromUrn(type, urn) {
    if (!urn.startsWith('urn:')) {
      return urn;
    }
    let pathed = urn.startsWith('urn:') ? urn.slice(4) : urn;
    pathed = pathed.replace(/:/g, '/').toLowerCase();
    return `${pathed}.json`;
  }
}

module.exports = AzureStorageDocStore;