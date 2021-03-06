(function () {
  'use strict';

  // Constants
  const MAX_ATTEMPTS = 3,
    ERR_CODES = [
      'EADDRINFO',
      'ETIMEDOUT',
      'ECONNRESET',
      'ESOCKETTIMEDOUT',
      'ENOTFOUND',
      'EADDRNOTAVAIL',
      'ECONNREFUSED'
    ],
    REQUEST_DEFAULTS = {
      pool: {
        maxSockets: Infinity
      },
      strictSSL: false,
      agent: false,
      followRedirect: false,
      jar: false
    };

  // Imports
  const _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    Readable = require('stream').Readable,
    request = require('request').defaults(REQUEST_DEFAULTS);

  // Locals
  const Log = require('./logger');

  class RequestManager {
    constructor (options, configManager) {
      this.options = options;
      this.configManager = configManager;
      return this;
    }

    doRequest (options, attemptsLeft, retryDelay) {
      const self = this;

      let req = null,
        stream = null,
        responseBody = null;

      if (attemptsLeft === MAX_ATTEMPTS) {
        options = Object.assign({}, self.options, options);
      }

      return new Promise(function (resolve, reject) {
        let signature = options.method + ' :: ' + options.uri;

        if (attemptsLeft < 0) {
          let errorMessage = 'The request to ' + options.uri + ' could not be processed!',
            e = new Error(errorMessage);
          Log.error(errorMessage);
          return reject(e);
        }

        options.headers = options.headers || {};

        var url = require('url').parse(options.baseUrl);
        options.headers.Origin = url.protocol + '//' + url.hostname;

        req = request(options, function (error, response, body) {
          if (attemptsLeft < MAX_ATTEMPTS) {
            Log.error('Trying to ' + signature + ' for the ' + (MAX_ATTEMPTS - attemptsLeft) + ' time out of ' + MAX_ATTEMPTS + ' tries left.');
          }
          if (!error) {
            responseBody = body;

            if (options.method === 'PUT') {
              // see after req() body condition with === 'PUT'
            } else {
              resolve(body);
            }
          }
        }).on('response', function(response) {
          if (response.statusCode === 404) {
            let errorMessage = 'Status code: ' + response.statusCode;
            switch (options.method) {
              case 'GET': {
                errorMessage = 'Path ' + options.uri + ' was not found.';
                break;
              }
              case 'DELETE': {
                errorMessage = 'File ' + options.uri + ' was not found, maybe already deleted.';
                break;
              }
            }
            let e = new Error(errorMessage);
            e.code = response.statusCode;
            Log.error(errorMessage);
            reject(e);
          } else if (response.statusCode >= 400) {
            Log.error(response.statusMessage + ' ' + response.statusCode + ". Could not " + signature + " :: skipping.");
            resolve();
          } else {
            Log.debug('Succesfully actioned ' + options.uri);
          }
        }).on('error', function (error) {
          let e = new Error('Error occurred...' + error.code);
          e.code = error.code;
          if (_.contains(ERR_CODES, error.code)) {
            Log.error('Got ' + error.code + ' scheduling a retry after ' + retryDelay + 'ms');
            (function () {
              return new Promise(function (retryResolve, retryReject) {
                setTimeout(function () {
                  retryResolve();
                }, retryDelay);
              });
            })().then(function () {
              return self.doRequest(options, --attemptsLeft, retryDelay);
            }).then(function (body) {
              resolve(body);
            }, function (err) {
              reject(err);
            });
            // terminate current stream (if any)
            if (stream) {
              stream.close();
            }
            // abort current request
            req.abort();
          } else {
            reject(e);
          }
        });

        if (options.method === 'PUT') {
          try {
            if (options.contentString) {
              // create string stream
              stream = new Readable;
              stream.push(options.contentString);
              stream.push(null);
            } else {
              // create file stream (default)
              stream = fs.createReadStream((options.fromTmpDir ? (self.configManager.getTempDir() + "/") : "") + options.uri);
            }
            stream.pipe(req);
            stream.on('end', function () {
              resolve(responseBody);
            });
          } catch (e) {
            let errComment = (options.contentString) ? 'options.contentString' : options.uri;
            Log.error('There was an error reading the stream from ' + errComment + ' :: ' + e.code);
            reject(e);
          }
        }
      }).then(function (body) {
        return Promise.resolve(body);
      }, function (error) {
        return Promise.reject(error);
      });
    }
  }

  module.exports = RequestManager;
}());
