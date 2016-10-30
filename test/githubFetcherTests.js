const chai = require('chai');
const config = require('painless-config');
const expect = chai.expect;
const extend = require('extend');
const GitHubFetcher = require('../lib/githubFetcher.js');
const Q = require('q');
const querystring = require('querystring');
const request = require('requestretry');
const url = require('url');

const urlHost = 'https://test.com';

describe('Basic fetcher success', () => {
  it('should be able to get a single page resource', () => {
    const fetcher = getFetcher();
    fetcher.get(`${urlHost}/singlePageResource`).then(result => {
      expect(result.id).to.equal('cool object');
    });
  });
  it('should be able to get a multi page resource', () => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/twoPageResource`).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);
    }, err => {
      fail();
    });
  });
  it('should retry 500 errors and eventually fail', () => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/serverError`).then(result => {
      // TODO what should be the right return value from a 500?
      // The body of the response or the response itself?
      expect(result).to.equal('bummer');
    }, err => {
      fail();
    });
  });
  it('should retry 500 errors and eventually succeed', () => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/retry500succeed`).then(result => {
      expect(result.id).to.equal(1);
      expect(fetcher.attempts[0]).to.equal(2);
    }, err => {
      fail();
    });
  });
  it('should retry network errors and eventually fail', () => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/networkError`).then(result => {
      fail();
    }, err => {
      expect(err).to.equal('bummer');
      expect(fetcher.attempts[0]).to.equal(5);
    });
  });
  it('should retry network errors and eventually succeed', () => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/retryNetworkErrorSucceed`).then(result => {
      expect(result.id).to.equal(1);
      expect(fetcher.attempts[0]).to.equal(3);
    }, err => {
      fail();
    });
  });
  it('should retry only 3 times', (done) => {
    const fetcher = getFetcher();
    return fetcher.getAll(`${urlHost}/retryNetworkErrorSucceed`, [], (err, body) => {
      expect(err).is.equal(null);
      expect(body.id).to.equal(1);
      expect(fetcher.attempts[0]).to.equal(3);
      done();
    });
  });
});

function getFetcher() {
  initializeRequestHook();
  return new GitHubFetcher({
    headers: {
      authorization: `token ${config.get("GITHUB_CRAWLER_TOKEN")}`
    },
    retryDelay: 10
  });
}

function createResponseTable() {
  const responseTable = {
    singlePageResource: { type: 'single', response: createSingleResponse({ id: 'cool object' }) },
    twoPageResource: {
      type: 'paged',
      responses: [
        createMultiPageResponse('twoPageResource', [{ page: 1 }], null, 2),
        createMultiPageResponse('twoPageResource', [{ page: 2 }], 1, null)
      ]
    },
    serverError: { type: 'single', response: createSingleResponse('bummer', 500) },
    networkError: { type: 'single', response: createErrorResponse('bummer') },
    retry500succeed: {
      type: 'sequenced',
      responses: [
        createSingleResponse('bummer', 500),
        createSingleResponse({ id: 1 }),
        createSingleResponse({ id: 2 })
      ]
    },
    retryNetworkErrorSucceed: {
      type: 'sequenced',
      responses: [
        createErrorResponse('bummer 1'),
        createErrorResponse('bummer 2'),
        createSingleResponse({ id: 1 }),
        createSingleResponse({ id: 2 })
      ]
    }
  };
  return extend(true, {}, responseTable);
}

// hook the node request object to bypass the actuall network sending and do the thing we want.
function initializeRequestHook() {
  const responses = createResponseTable();
  const hook = (options, callback) => {
    const target = options.url;
    const data = responses[url.parse(target).pathname.replace(/^\//, "")];
    let result = null;
    switch (data.type) {
      case 'single':
        result = data.response;
        break;
      case 'paged':
        query = querystring.parse(url.parse(target).query);
        page = query.page ? query.page : 1;
        result = data.responses[page - 1];
        break;
      case 'sequenced':
        result = data.responses.shift();
    }

    // finish the call in a timeout to simulate the network call context switch
    callback(result.error, result.response, result.response.body);
    // setTimeout(() => {
    //   callback(result.error, result.response, result.response.body);
    // }, 0);
  };
  request.Request.request = hook;
}

function createSingleResponse(body, code = 200) {
  return {
    // error: null,
    response: {
      status: code,
      headers: {
        'x-ratelimit-remaining': 4000
      },
      body: body
    }
  }
}

function createMultiPageResponse(target, body, previous, next, last) {
  return {
    // error: null,
    response: {
      headers: {
        'x-ratelimit-remaining': 4000,
        link: createLinkHeader(target, previous, next, last)
      },
      body: body
    }
  };
}

function createErrorResponse(error) {
  return {
    error: error,
    response: {
      headers: {}
    }
  };
}

function createLinkHeader(target, previous, next, last) {
  separator = target.includes('?') ? '&' : '?';
  const firstLink = null; //`<${urlHost}/${target}${separator}page=1>; rel="first"`;
  const prevLink = previous ? `<${urlHost}/${target}${separator}page=${previous}>; rel="prev"` : null;
  const nextLink = next ? `<${urlHost}/${target}${separator}page=${next}>; rel="next"` : null;
  const lastLink = last ? `<${urlHost}/${target}${separator}page=${last}>; rel="last"` : null;
  return [firstLink, prevLink, nextLink, lastLink].filter(value => { return value !== null }).join(',');
}

