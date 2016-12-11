const expect = require('chai').expect;
const Q = require('q');
const sinon = require('sinon');
const LoggingStore = require('../../lib/loggingStore');

let baseStore;

describe('Logging Store', () => {
  beforeEach(() => {
    baseStore = {
      connect: sinon.spy(() => Q()),
      upsert: sinon.spy(() => Q()),
      get: sinon.spy(() => Q()),
      etag: sinon.spy(() => Q()),
      close: sinon.spy(() => Q())
    };
  });

  afterEach(() => {
    baseStore.connect.reset();
    baseStore.upsert.reset();
    baseStore.get.reset();
    baseStore.etag.reset();
    baseStore.close.reset();
  });

  it('Should connect, get, etag and close', () => {
    let blobService = {
      createContainerIfNotExists: sinon.spy((name, cb) => { cb(null); })
    };
    let loggingStore = new LoggingStore(baseStore, blobService, 'test');
    return Q.all([
      loggingStore.connect(),
      loggingStore.get('test', 'test'),
      loggingStore.etag('test', 'test'),
      loggingStore.close()
    ]).then(() => {
      expect(blobService.createContainerIfNotExists.callCount).to.be.equal(1);
      expect(baseStore.connect.callCount).to.be.equal(1);
      expect(baseStore.upsert.callCount).to.be.equal(0);
      expect(baseStore.get.callCount).to.be.equal(1);
      expect(baseStore.etag.callCount).to.be.equal(1);
      expect(baseStore.close.callCount).to.be.equal(1);
    });
  });

  it('Should upsert ten times', () => {
    let blobService = {
      createAppendBlobFromText: sinon.spy((name, blobName, text, cb) => { cb(); }),
      appendBlockFromText: sinon.spy((name, blobName, text, cb) => { cb(); })
    };
    loggingStore = new LoggingStore(baseStore, blobService, 'test');
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(loggingStore.upsert({ test: true }));
    }
    return Q.all(promises).then(() => {
      expect(blobService.createAppendBlobFromText.callCount).to.be.equal(0);
      expect(blobService.appendBlockFromText.callCount).to.be.equal(10);
      expect(baseStore.upsert.callCount).to.be.equal(10);
      expect(loggingStore.blobSequenceNumber).to.be.equal(1);
      expect(loggingStore.name).to.be.equal('test');
    });
  });

  it('Should create blob if not exists', () => {
    let blobService = {
      createAppendBlobFromText: sinon.spy((name, blobName, text, cb) => { cb(); }),
      appendBlockFromText: sinon.spy((name, blobName, text, cb) => { cb({ statusCode: 404 }); })
    };
    loggingStore = new LoggingStore(baseStore, blobService, 'test');
    return loggingStore.upsert({ test: true }).then(() => {
      expect(blobService.createAppendBlobFromText.callCount).to.be.equal(1);
      expect(blobService.appendBlockFromText.callCount).to.be.equal(1);
      expect(baseStore.upsert.callCount).to.be.equal(1);
      expect(loggingStore.blobSequenceNumber).to.be.equal(1);
    });
  });

  it('Should increment blob sequence number', () => {
    let blobService = {
      createAppendBlobFromText: sinon.spy((name, blobName, text, cb) => { cb(); }),
      appendBlockFromText: sinon.spy((name, blobName, text, cb) => { cb({ statusCode: 409 }); })
    };
    loggingStore = new LoggingStore(baseStore, blobService, 'test');
    return loggingStore.upsert({ test: true }).then(() => {
      expect(blobService.createAppendBlobFromText.callCount).to.be.equal(1);
      expect(blobService.appendBlockFromText.callCount).to.be.equal(1);
      expect(baseStore.upsert.callCount).to.be.equal(1);
      expect(loggingStore.blobSequenceNumber).to.be.equal(2);
    });
  });
});