const OspoCrawler = require('../../lib/ospoCrawler');
const Q = require('q');
const qlimit = require('qlimit');

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
      });
    });
  });

  it('Should connect and upsert many times', () => {
    const document = { abc: 1 };
    const docs = [];
    for (let i=0; i<50; i++) {
      docs.push(document);
    }
    let counter = 0;
    return loggingStore.connect().then(() => {
      return Q.all(docs.map(qlimit(10)(doc => {
        console.log(++counter);
        return loggingStore.upsert(doc);
      })));
    });
  });
});

function logAndResolve(name) {
  console.log(`Called baseStore.${name}()`);
  return Q();
}
