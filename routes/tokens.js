// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const auth = require('../middleware/auth');
const express = require('express');

let crawlerService = null;
const router = express.Router();

router.post('/', auth.validate, (request, response, next) => {
  const body = request.body;
  crawlerService.fetcher.tokenFactory.setTokens(body);
  response.sendStatus(200);
});

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;