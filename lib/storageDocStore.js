// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const async = require('async');
const azure = require('azure-storage');
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
    const metadata = {
      version: document._metadata.version,
      etag: document._metadata.etag,
      type: document._metadata.type,
      url: document._metadata.url,
      urn: document._metadata.links.self.href,
      fetchedAt: document._metadata.fetchedAt,
      processedAt: document._metadata.processedAt
    };
    this._collapseExtraMetadata(document._metadata, metadata);
    const options = { metadata: metadata, contentSettings: { contentType: 'application/json' } };
    this.service.createBlockBlobFromText(this.name, blobName, text, options, (error, result, response) => {
      if (error) {
        return deferred.reject(error);
      }
      memoryCache.put(document._metadata.url, { etag: document._metadata.etag, document: document }, this.options.ttl);
      deferred.resolve(blobName);
    });
    return deferred.promise;
  }

  _collapseExtraMetadata(source, target) {
    if (source.extra) {
      Object.getOwnPropertyNames(source.extra).forEach(property => {
        target[`extra_${property}`] = source.extra[property];
      });
    }
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

  listDocuments(pattern) {
    const blobPattern = this._getBlobPathFromUrn(null, pattern);
    var entries = [];
    var continuationToken = null;
    const deferred = Q.defer();
    async.doWhilst(
      callback => {
        var started = new Date().getTime();
        this.service.listBlobsSegmentedWithPrefix(this.name, blobPattern, continuationToken, { include: azure.BlobUtilities.BlobListingDetails.METADATA, location: azure.StorageUtilities.LocationMode.PRIMARY_THEN_SECONDARY }, function (err, result, response) {
          // metricsClient.trackDependency(url.parse(blobService.host.primaryHost).hostname, 'listBlobsSegmented', (new Date().getTime() - started), !err, "Http", { 'Container name': 'download', 'Continuation token present': result == null ? false : (result.continuationToken != null), 'Blob count': result == null ? 0 : result.entries.length });

          if (err) {
            continuationToken = null;
            // metricsClient.trackError(err);
            callback(err);
          }
          entries = entries.concat(result.entries.map(entry => entry.metadata));
          callback(null);
        });
      },
      function () {
        return continuationToken !== null && entries.length < 10000;
      },
      function (err) {
        if (err) {
          return deferred.reject(err);
        }
        deferred.resolve(entries);
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

  _getBlobPathFromUrn(type, urn) {
    if (!urn) {
      return '';
    }
    if (!urn.startsWith('urn:')) {
      return urn;
    }
    const pathed = urn.startsWith('urn:') ? urn.slice(4) : urn;
    return pathed.replace(/:/g, '/').toLowerCase();
  }

  _getBlobNameFromUrn(type, urn) {
    if (!urn.startsWith('urn:')) {
      return urn;
    }
    return `${this._getBlobPathFromUrn(type, urn)}.json`;
  }
}

module.exports = AzureStorageDocStore;