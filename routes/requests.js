const appInsights = require('../lib/mockInsights');
const auth = require('../middleware/auth');
const express = require('express');
const Request = require('ghcrawler').request;
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

router.post('/', wrap(function* (request, response, next) {
// router.post('/', auth.validate, wrap(function* (request, response, next) {
  const body = request.body;
  const crawlRequest = Request.adopt(body);
  yield crawlerService.crawler.queue(crawlRequest);
  response.send(201);
}));

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;