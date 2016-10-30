const assert = require('chai').assert;
const chai = require('chai');
const config = require('painless-config');
const expect = require('chai').expect;
const extend = require('extend');
const GitHubRequest = require('../lib/githubRequest.js');
const Q = require('q');
const querystring = require('querystring');
const request = require('requestretry');
const url = require('url');

const urlHost = 'https://test.com';

describe('Request option merging', () => {
  it('should merge and override properties', () => {
    const result = new GitHubRequest({
      retryDelay: 10,
      testProperty: 'test value'
    });
    expect(result.options.retryDelay).to.equal(10);
    expect(result.options.testProperty).to.equal('test value');
  });
  it('should merge and override headers', () => {
    const result = new GitHubRequest({
      headers: {
        'User-Agent': 'test agent',
        authorization: 'test auth'
      }
    });
    expect(result.options.headers['User-Agent']).to.equal('test agent');
    expect(result.options.headers['authorization']).to.equal('test auth');
  });
});

describe('Request retry and success', () => {
  it('should be able to get a single page resource', () => {
    const request = createRequest();
    request.get(`${urlHost}/singlePageResource`).then(result => {
      expect(result.id).to.equal('cool object');
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(1);
    });
  });
  it('should be able to get a multi page resource', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/twoPageResource`).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);
      expect(request.activity[0].attempts).to.equal(1);
      expect(request.activity[1].attempts).to.equal(1);
    }, err => {
      assert.fail();
    });
  });
  it('should retry 500 errors and eventually fail', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/serverError`).then(result => {
      // TODO what should be the right return value from a 500?
      // The body of the response or the response itself?
      expect(result).to.equal('bummer');
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(request.options.maxAttempts);
      expect(activity.delays[0].retry).to.equal(request.options.retryDelay);
    }, err => {
      assert.fail();
    });
  });
  it('should retry 500 errors and eventually succeed', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/retry500succeed`).then(result => {
      expect(result.id).to.equal(1);
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(2);
      expect(activity.delays[0].retry).to.equal(request.options.retryDelay);
    }, err => {
      assert.fail();
    });
  });
  it('should retry network errors and eventually fail', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/networkError`).then(result => {
      assert.fail();
    }, err => {
      expect(err).to.equal('bummer');
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(5);
      expect(activity.delays[0].retry).to.equal(request.options.retryDelay);
    });
  });
  it('should retry network errors and eventually succeed', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/retryNetworkErrorSucceed`).then(result => {
      expect(result.id).to.equal(1);
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(3);
      expect(activity.delays.length).to.equal(2);
      expect(activity.delays[0].retry).to.equal(request.options.retryDelay);
      expect(activity.delays[1].retry).to.equal(request.options.retryDelay);
    }, err => {
      assert.fail();
    });
  });
  it('should recover after network errors', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/retryNetworkErrorSucceed`).then(result => {
      expect(result.id).to.equal(1);
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(3);
      expect(activity.delays[0].retry).to.equal(request.options.retryDelay);
      expect(activity.delays[1].retry).to.equal(request.options.retryDelay);
    }, err => {
      assert.fail();
    });
  });
  it('should recover after 403 forbidden', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/forbidden`).then(result => {
      expect(result.id).to.equal(1);
      const activity = request.activity[0];
      expect(activity.attempts).to.equal(2);
      expect(activity.delays.length).to.equal(1);
      expect(activity.delays[0].forbidden).to.equal(request.options.forbiddenDelay);
    }, err => {
      assert.fail();
    });
  });
  it('should recover after error and deliver all pages', () => {
    const request = createRequest();
    return request.getAll(`${urlHost}/pagedWithErrors`).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);

      expect(request.activity.length).to.equal(2);
      const activity0 = request.activity[0];
      expect(activity0.attempts).to.equal(1);
      expect(activity0.delays).to.be.undefined;

      const activity1 = request.activity[1];
      expect(activity1.attempts).to.equal(2);
      expect(activity1.delays.length).to.equal(1);
      expect(activity1.delays[0].retry).to.equal(request.options.retryDelay);
    }, err => {
      assert.fail();
    });
  });
});

function createRequest() {
  // initialize the hook each time to ensure a fresh copy of the response table
  initializeRequestHook();
  return new GitHubRequest({
    headers: {
      authorization: `token ${config.get("GITHUB_CRAWLER_TOKEN")}`
    },
    retryDelay: 10,
    forbiddenDelay: 15
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
    },
    forbidden: {
      type: 'sequenced',
      responses: [
        createSingleResponse('forbidden 1', 403),
        createSingleResponse({ id: 1 }),
        createSingleResponse({ id: 2 })
      ]
    },
    pagedWithErrors: {
      type: 'sequenced',
      responses: [
        // createMultiPageResponse(target, body, previous, next, last, code = 200, error = null, remaining = 4000) {
        createMultiPageResponse('pagedWithErrors', [{ page: 1 }], null, 2),
        createMultiPageResponse('pagedWithErrors', [{ page: 2 }], 1, null, 2, null, 'bummer'),
        createMultiPageResponse('pagedWithErrors', [{ page: 2 }], 1, null)
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

function createSingleResponse(body, code = 200, remaining = 4000) {
  return {
    // error: null,
    response: {
      status: code,
      headers: {
        'x-ratelimit-remaining': remaining
      },
      body: body
    }
  }
}

function createMultiPageResponse(target, body, previous, next, last, code = 200, error = null, remaining = 4000) {
  return {
    error: error,
    response: {
      headers: {
        'x-ratelimit-remaining': remaining,
        link: createLinkHeader(target, previous, next, last)
      },
      status: code,
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

