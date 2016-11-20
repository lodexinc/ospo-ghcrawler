const appInsights = require('../lib/mockInsights');
const auth = require('../middleware/auth');
const express = require('express');
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

router.patch('/', auth.validate, wrap(function* (req, res, next) {
  const options = request.body.reduce((result, change) => {
    if (change.op === 'replace') {
      result[change.path.slice(1)] = change.value;
    }
    return result;
  }, {});

  const newOptions = Object.assign({}, crawlerService.getOptions(), options);
  yield crawlerService.reconfigure(options);
  response.send(200);
}));

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;