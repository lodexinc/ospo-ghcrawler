// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const auth = require('../middleware/auth');
const express = require('express');
const expressJoi = require('express-joi');
const Request = require('ghcrawler').request;
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

router.get('/', auth.validate, wrap(function* (request, response) {
  const requests = yield crawlerService.listDeadletters();
  response.json(requests);
}));

// router.delete('/:queue', auth.validate, expressJoi.joiValidate(requestsSchema), wrap(function* (request, response) {
//   const requests = yield crawlerService.getRequests(request.params.queue, parseInt(request.query.count, 10), true);
//   if (!requests) {
//     return response.sendStatus(404);
//   }
//   response.json(requests);
// }));

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;