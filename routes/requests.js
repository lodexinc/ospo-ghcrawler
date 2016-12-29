// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const appInsights = require('../lib/mockInsights');
const auth = require('../middleware/auth');
const express = require('express');
const Request = require('ghcrawler').request;
const TraversalPolicy = require('ghcrawler').traversalPolicy;
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

router.post('/', wrap(function* (request, response, next) {
  // router.post('/', auth.validate, wrap(function* (request, response, next) {
  const body = request.body;
  const policy = TraversalPolicy.getPolicy(body.policy);
  body.policy = policy || body.policy;
  const crawlRequest = Request.adopt(body);
  yield crawlerService.crawler.queue(crawlRequest);
  response.sendStatus(201);
}));

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;