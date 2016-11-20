const appInsights = require('../lib/mockInsights');
const auth = require('../middleware/auth');
const express = require('express');
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

router.post('/', auth.validate, wrap(function* (request, response, next) {
  const body = request.body;
  yield crawlerService.crawler.queue(body);
  response.send(201);
}));

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;