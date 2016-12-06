const OspoCrawler = require('../../lib/ospoCrawler');
const Q = require('q');

let loggingStore;

describe('Logging Store Integration', () => {
  before(() => {
    const baseStore = {
      connect: () => logAndResolve('connect'),
      upsert: () => logAndResolve('upsert'),
      get: () => logAndResolve('get'),
      etag: () => logAndResolve('etag'),
      close: () => logAndResolve('close')
    };
    loggingStore = OspoCrawler.createLoggingStore(baseStore);
  });

  it('Should connect, get, etag and close', () => {
    return Q.all([
      loggingStore.connect(),
      loggingStore.get('test', 'test'),
      loggingStore.etag('test', 'test'),
      loggingStore.close()
    ]);
  });

  it('Should connect and upsert twice', () => {
    return loggingStore.connect().then(() => {
      return loggingStore.upsert({ test: process.hrtime().join('') }).then(() => {
        return loggingStore.upsert({ test: process.hrtime().join('') });
      })
    });
  });
});

function logAndResolve(name) {
  console.log(`Called baseStore.${name}()`);
  return Q();
}
