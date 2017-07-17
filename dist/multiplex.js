'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*************************************************************************

   chrome-remote-multiplex

   https://github.com/johnspackman/chrome-remote-multiplex

   Copyright:
     2017 Zenesis Limited 

   License:
     MIT: https://opensource.org/licenses/MIT

   Authors:
     * John Spackman <john.spackman@zenesis.com> (johnspackman)

************************************************************************ */

var Protocol = require('chrome-remote-interface').Protocol;
var EventEmitter = require('events');
var WebSocket = require('ws');
var Express = require('express');
var Http = require('http');
var Url = require('url');
var Dot = require('dot');

var PACKAGE = require("../package.json");

var Logger = function () {
  function Logger() {
    _classCallCheck(this, Logger);

    this.mode = "info";
  }

  _createClass(Logger, [{
    key: 'log',
    value: function log() {
      var _console;

      (_console = console).log.apply(_console, arguments);
    }
  }, {
    key: 'info',
    value: function info() {
      this.log.apply(this, arguments);
    }
  }, {
    key: 'error',
    value: function error() {
      this.log.apply(this, arguments);
    }
  }, {
    key: 'debug',
    value: function debug() {
      if (this.mode === "debug") this.log.apply(this, arguments);
    }
  }]);

  return Logger;
}();

var LOG = new Logger();

/**
 * Used by ProxyDomain-derived classes to create an API method called apiName; the API
 * can have methods `send` and `reply` which are bound to `self`; a promise is created
 * in `api.replied` which is satisfied after the `reply` method has been called
 *  
 * @param self
 * @param apiName
 * @param api
 * @returns
 */
function addApi(self, apiName, api) {
  for (var name in api) {
    var fn = api[name];
    if (typeof fn === "function") api[name] = api[name].bind(self);
  }

  var tmp = null;
  api.replied = new Promise(function (resolve, reject) {
    tmp = { resolve: resolve, reject: reject };
  });
  api.replied.resolve = tmp.resolve;
  api.replied.reject = tmp.reject;

  self[apiName] = api;
}

/**
 * ProxyDomain is the base class for creating a proxy of one of the protocol domains;
 * by default, all requests for domains are just bounced to the server and back, with
 * events being broadcast to all clients.  The ProxyDomain class provides a mechanism
 * for the multiplexer to intercept that communication (eg Runtime domain has to collate
 * responses) 
 */

var ProxyDomain = function (_EventEmitter) {
  _inherits(ProxyDomain, _EventEmitter);

  function ProxyDomain(remoteDebuggerProxy) {
    _classCallCheck(this, ProxyDomain);

    var _this = _possibleConstructorReturn(this, (ProxyDomain.__proto__ || Object.getPrototypeOf(ProxyDomain)).call(this));

    _this.remoteDebuggerProxy = remoteDebuggerProxy;
    return _this;
  }

  _createClass(ProxyDomain, [{
    key: 'onEvent',
    value: function onEvent(data) {}
  }]);

  return ProxyDomain;
}(EventEmitter);

/**
 * ProxyDomain implementation for most domains; it collects enable/disable into a single
 * enable/disable with a reference count
 */


var DefaultProxyDomain = function (_ProxyDomain) {
  _inherits(DefaultProxyDomain, _ProxyDomain);

  function DefaultProxyDomain(remoteDebuggerProxy) {
    _classCallCheck(this, DefaultProxyDomain);

    var _this2 = _possibleConstructorReturn(this, (DefaultProxyDomain.__proto__ || Object.getPrototypeOf(DefaultProxyDomain)).call(this, remoteDebuggerProxy));

    _this2._enabled = 0;

    addApi(_this2, "enable", {
      send: function send(devtoolsClient, data, sendImpl) {
        var t = this;
        this._enabled++;
        if (t._enabled === 1) {
          sendImpl(data);
        } else {
          t.enable.replied.then(function () {
            return devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false);
          });
        }

        return false;
      },
      reply: function reply(devtoolsClient, data) {
        var t = this;
        return devtoolsClient.sendMessageToClient(data).then(function () {
          t.enable.replied.resolve(data);
        });
      }
    });

    addApi(_this2, "disable", {
      send: function send(devtoolsClient, data, sendImpl) {
        this._enabled--;
        if (this._enabled === 0) {
          sendImpl(data);
        } else {
          t.disable.replied.then(function (data) {
            return devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false);
          });
        }

        return false;
      }
    });
    return _this2;
  }

  return DefaultProxyDomain;
}(ProxyDomain);

/**
 * Implementation of ProxyDomain for the Runtime domain.  Execution contexts have
 * to be tracked because the remote debug server will only publish them to us once,
 * so we have to store them and publish them to each client that attaches to us.
 */


var RuntimeProxyDomain = function (_ProxyDomain2) {
  _inherits(RuntimeProxyDomain, _ProxyDomain2);

  function RuntimeProxyDomain(remoteDebuggerProxy) {
    _classCallCheck(this, RuntimeProxyDomain);

    var _this3 = _possibleConstructorReturn(this, (RuntimeProxyDomain.__proto__ || Object.getPrototypeOf(RuntimeProxyDomain)).call(this, remoteDebuggerProxy));

    _this3._enabled = 0;
    _this3._executionContexts = {};

    addApi(_this3, "enable", {
      send: function send(devtoolsClient, data, sendImpl) {
        var t = this;
        this._enabled++;
        if (t._enabled === 1) {
          sendImpl(data);
        } else {
          t.enable.replied.then(function () {
            var promises = [];
            promises.push(devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false));
            for (var id in t._executionContexts) {
              promises.push(devtoolsClient.sendMessageToClient(t._executionContexts[id], true));
            }return Promise.all(promises);
          });
        }

        return false;
      },
      reply: function reply(devtoolsClient, data) {
        var t = this;
        return devtoolsClient.sendMessageToClient(data).then(function () {
          t.enable.replied.resolve(data);
        });
      },


      replied: null
    });

    addApi(_this3, "disable", {
      send: function send(devtoolsClient, data, sendImpl) {
        this._enabled--;
        if (this._enabled === 0) {
          sendImpl(data);
        }

        return false;
      }
    });

    return _this3;
  }

  _createClass(RuntimeProxyDomain, [{
    key: 'onEvent',
    value: function onEvent(data) {
      var t = this;

      if (data.method === "Runtime.executionContextCreated") {
        t._executionContexts[data.params.context.id] = data;
      } else if (data.method === "Runtime.executionContextDestroyed") {
        delete t._executionContexts[data.params.contextId];
      } else if (data.method === "Runtime.executionContextsCleared") {
        t._executionContexts = {};
      }
    }
  }]);

  return RuntimeProxyDomain;
}(ProxyDomain);

/**
 * Represents a single connection from a Devtools client
 */


var DevtoolsClient = function (_EventEmitter2) {
  _inherits(DevtoolsClient, _EventEmitter2);

  function DevtoolsClient(remoteDebuggerProxy, ws) {
    _classCallCheck(this, DevtoolsClient);

    var _this4 = _possibleConstructorReturn(this, (DevtoolsClient.__proto__ || Object.getPrototypeOf(DevtoolsClient)).call(this));

    var t = _this4;
    _this4.remoteDebuggerProxy = remoteDebuggerProxy;
    _this4.ws = ws;
    ws.on("close", function () {
      return remoteDebuggerProxy.detach(_this4);
    });
    ws.on('message', function (data) {
      var message = JSON.parse(data);
      t.onMessageFromClient(message);
    });
    return _this4;
  }

  _createClass(DevtoolsClient, [{
    key: 'close',
    value: function close() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
  }, {
    key: 'onMessageFromClient',
    value: function onMessageFromClient(data) {
      var t = this;
      return t.remoteDebuggerProxy.sendMessageToServer(this, data);
    }
  }, {
    key: 'sendMessageToClient',
    value: function sendMessageToClient(data, broadcast) {
      var t = this;

      return promisify(function (cb) {
        LOG.debug("REPLY: " + JSON.stringify(data));
        t.ws.send(JSON.stringify(data), cb);
      });
    }
  }]);

  return DevtoolsClient;
}(EventEmitter);

/**
 * Represents the single connection to the remote devtools debugger (ie Headless Chrome),
 * and tracks the multiple DevtoolsClient instances which attach to it
 */


var RemoteDebuggerProxy = function (_EventEmitter3) {
  _inherits(RemoteDebuggerProxy, _EventEmitter3);

  function RemoteDebuggerProxy(multiplexServer, target) {
    _classCallCheck(this, RemoteDebuggerProxy);

    var _this5 = _possibleConstructorReturn(this, (RemoteDebuggerProxy.__proto__ || Object.getPrototypeOf(RemoteDebuggerProxy)).call(this));

    _this5.multiplexServer = multiplexServer;
    _this5.target = target;
    _this5.devtoolsClients = [];
    _this5._idMap = {};
    _this5._nextCommandId = 1;
    _this5._domainProxies = {
      Runtime: new RuntimeProxyDomain(_this5)
    };
    return _this5;
  }

  /**
   * Connects to the remote debugger instance (ie Chrome Headless)
   */


  _createClass(RemoteDebuggerProxy, [{
    key: 'connect',
    value: function connect() {
      var _this6 = this;

      var t = this;
      Protocol(t.options).then(function (data) {
        data.descriptor.domains.forEach(function (domain) {
          if (t._domainProxies[domain.domain] !== undefined) return;
          var cmdEnable = null;
          var cmdDisable = null;
          domain.commands.forEach(function (command) {
            if (command.name === "enable") cmdEnable = command;else if (command.name === "disable") cmdDisable = command;
          });
          if (cmdEnable || cmdDisable) {
            LOG.debug("Creating default domain for " + domain.domain);
            t._domainProxies[domain.domain] = new DefaultProxyDomain(_this6);
          }
        });
      });
      return new Promise(function (resolve, reject) {
        var url = t.target.originalWebSocketDebuggerUrl;
        url = url.replace(/localhost\:/g, t.multiplexServer.options.remoteClientHostname + ":");
        var ws = t.ws = new WebSocket(url);
        ws.on('open', resolve);
        ws.on('close', function (code) {
          t.emit('disconnect');
        });
        ws.on('error', reject);
        ws.on('message', function (data) {
          var message = JSON.parse(data);
          t.onMessageFromServer(message);
        });
      });
    }

    /**
     * Closes the connection to the server and clients
     */

  }, {
    key: 'close',
    value: function close() {
      if (this.ws) {
        var ws = this.ws;
        this.ws = null;
        ws.close();
        this.devtoolsClients.forEach(function (client) {
          return client.close();
        });
        this.emit("close");
      }
    }

    /**
     * Returns true if there are no devtools clients 
     */

  }, {
    key: 'isUnused',
    value: function isUnused() {
      return this.devtoolsClients.length == 0;
    }

    /**
     * Detaches a DevTools client
     */

  }, {
    key: 'detach',
    value: function detach(devtoolsClient) {
      var _this7 = this;

      for (var i = 0; i < this.devtoolsClients.length; i++) {
        if (this.devtoolsClients[i] === devtoolsClient) {
          this.devtoolsClients.splice(i, 1);
          break;
        }
      }this.target.numberOfClients = this.devtoolsClients.length;
      if (!!this.ws && this.autoClose && this.devtoolsClients.length == 0) this.closeTarget().then(function () {
        return _this7.close();
      });
    }

    /**
     * Attaches a DevTools client
     */

  }, {
    key: 'attach',
    value: function attach(devtoolsClient) {
      this.devtoolsClients.push(devtoolsClient);
      this.target.numberOfClients = this.devtoolsClients.length;
    }

    /**
     * Shutsdown the target
     */

  }, {
    key: 'closeTarget',
    value: function closeTarget() {
      var t = this;
      return httpGet({
        hostname: t.multiplexServer.options.remoteClientHostname,
        port: t.multiplexServer.options.remoteClientPort,
        path: "/json/close/" + t.target.id,
        method: 'GET'
      });
    }

    /**
     * Upgrade request from express
     */

  }, {
    key: 'upgrade',
    value: function upgrade(request, socket, head) {
      var t = this;
      var wss = new WebSocket.Server({ noServer: true });

      wss.handleUpgrade(request, socket, head, function (ws) {
        var devtoolsClient = new DevtoolsClient(t, ws);
        t.attach(devtoolsClient);
        wss.emit('connection', ws);
      });
    }

    /**
     * Handles a message from the remote debugger
     */

  }, {
    key: 'onMessageFromServer',
    value: function onMessageFromServer(data) {
      var t = this;

      LOG.debug('SERVER: %s...', JSON.stringify(data));

      // Map API IDs back to client'ss original ID
      if (data.id) {
        var map = t._idMap[data.id];
        if (map) {
          data.id = map.originalId;

          // Offer to domain specific proxies

          var _splitName = splitName(map.data.method),
              _splitName2 = _slicedToArray(_splitName, 2),
              domainName = _splitName2[0],
              methodName = _splitName2[1];

          var domainProxy = this._domainProxies[domainName];
          var api = domainProxy && domainProxy[methodName];
          if (api && typeof api.reply === "function") {
            var result = api.reply(map.devtoolsClient, data);
            if (result !== undefined) return result;
          }

          // Just bounce it straight on
          return map.devtoolsClient.sendMessageToClient(data);
        } else {
          LOG.error("Server message for id " + data.id + " not matched");
          return;
        }
      }

      // Handle events - offer to domain specific proxy

      var _splitName3 = splitName(data.method),
          _splitName4 = _slicedToArray(_splitName3, 2),
          domainName = _splitName4[0],
          methodName = _splitName4[1];

      var domainProxy = this._domainProxies[domainName];
      if (domainProxy) {
        var result = domainProxy.onEvent(data);
        if (result !== undefined) return result;
      }

      // Pass event on
      this.devtoolsClients.forEach(function (devtoolsClient) {
        devtoolsClient.sendMessageToClient(data, true);
      });
    }

    /**
     * Allows a DevToolsClient to send a message to the server; handles mapping the
     * client's own ID to a global one for the server 
     */

  }, {
    key: 'sendMessageToServer',
    value: function sendMessageToServer(devtoolsClient, data) {
      var t = this;

      LOG.debug('CLIENT: %s...', JSON.stringify(data));

      // Offer the domain proxy the opportunity to handle the method call
      if (data.method) {
        var _splitName5 = splitName(data.method),
            _splitName6 = _slicedToArray(_splitName5, 2),
            domainName = _splitName6[0],
            methodName = _splitName6[1];

        var domainProxy = this._domainProxies[domainName];
        var api = domainProxy && domainProxy[methodName];
        if (api && typeof api.send === "function") {
          var result = api.send(devtoolsClient, data, doSend);
          if (result !== undefined) return result;
        }
      }

      // Just send it
      return doSend(data);

      function doSend(data) {
        if (data.id !== undefined) {
          var newId = t._nextCommandId++;
          t._idMap[newId] = {
            newId: newId,
            originalId: data.id,
            data: data,
            devtoolsClient: devtoolsClient
          };
          data.id = newId;
        }

        return promisify(function (cb) {
          t.ws.send(JSON.stringify(data), cb);
        });
      }
    }
  }]);

  return RemoteDebuggerProxy;
}(EventEmitter);

/**
 * This is the main server instance that clients connect to; it contains the ExpressJS server,
 * communicates with the remote debug server, and establishes RemoteDebuggerProxy instances
 * for each remote target 
 * 
 */

var DEFAULT_DEVTOOLS_URL = "https://chrome-devtools-frontend.appspot.com/serve_file/@4b9102f9588fb6cf639a6165fd4777658d5ade0d/inspector.html?";

var MultiplexServer = function (_EventEmitter4) {
  _inherits(MultiplexServer, _EventEmitter4);

  function MultiplexServer(options) {
    _classCallCheck(this, MultiplexServer);

    var _this8 = _possibleConstructorReturn(this, (MultiplexServer.__proto__ || Object.getPrototypeOf(MultiplexServer)).call(this));

    options = options || {};
    if (options.logging === "debug") LOG.mode = "debug";
    var remoteClient = options.remoteClient;
    if (remoteClient !== undefined) {
      var m = remoteClient.match(/^([^:]+)(:([0-9]+))?$/);
      if (m) {
        options.remoteClientHostname = m[1];
        options.remoteClientPort = m[3];
      } else {
        throw new Error("Cannot interpret remoteClient - found " + remoteClient + ", expected something like 'localhost:9222'");
      }
    }
    _this8.options = {
      listenPort: options.listenPort || 9223,
      remoteClientHostname: options.remoteClientHostname || "localhost",
      remoteClientPort: options.remoteClientPort || 9222
    };
    _this8.options.remoteClient = _this8.options.remoteClientHostname + ":" + _this8.options.remoteClientPort;
    return _this8;
  }

  _createClass(MultiplexServer, [{
    key: 'listen',
    value: function listen() {
      var _this9 = this;

      var t = this;

      var app = Express();

      function reportHttpError(req, err) {
        LOG.error("Error in " + req.method + " " + req.originalUrl + ": " + err);
      }

      /*
       * Web page that provides links to debug
       */
      (function () {
        // https://chrome-devtools-frontend.appspot.com/serve_file/@4b9102f9588fb6cf639a6165fd4777658d5ade0d/inspector.html?ws=localhost:9223/devtools/page/1e371c5b-25ef-4ee9-9ef6-3ca11d9d59ee&remoteFrontend=true

        var template = Dot.template('<html><body>\n  <h1>Headless proxy</h1>\n  <ul>\n    {{~ it.multiplex.targets :target }}\n          <li>\n            <a href="{{= it.url(target) }}">\n              {{= it.title(target) }}\n            </a>\n          </li>\n    {{~}}\n  </ul>\n</body></html>');

        app.get('/', function (req, res) {
          t.refreshTargets().then(function () {
            res.send(template({
              multiplex: t,
              DEFAULT_DEVTOOLS_URL: DEFAULT_DEVTOOLS_URL,
              url: function url(target) {
                return DEFAULT_DEVTOOLS_URL + target.webSocketDebuggerUrl.replace(/^ws:\/\//, "ws=/") + "&remoteFrontend=true";
              },
              title: function title(target) {
                var str = target.title;
                if (target.autoClose) str += " (set to auto-close)";
                return str;
              }
            }));
          }).catch(reportHttpError.bind(this, req));
        });
      })();

      function getContentType(response) {
        var contentType = response.headers["content-type"];
        if (contentType) {
          var pos = contentType.indexOf(';');
          contentType = contentType.substring(0, pos);
        }
        return contentType;
      }

      // Gets JSON from the remote server
      function getJson(path) {
        return httpGet({
          hostname: t.options.remoteClientHostname,
          port: t.options.remoteClientPort,
          path: path,
          method: 'GET'
        }).then(function (obj) {
          var contentType = getContentType(obj.response);
          if (contentType !== "application/json") LOG.warn("Expecting JSON from " + path + " but found wrong content type: " + contentType);

          try {
            return JSON.parse(obj.data);
          } catch (ex) {
            LOG.warn("Cannot parse JSON returned from " + path);
            return null;
          }
        });
      }

      // Gets JSON from the remote server and copies it to the client
      function copyToClient(req, res) {
        return httpGet({
          hostname: t.options.remoteClientHostname,
          port: t.options.remoteClientPort,
          path: req.originalUrl,
          method: 'GET'
        }).then(function (obj) {
          var contentType = getContentType(obj.response);
          if (contentType) res.set("Content-Type", contentType);
          res.send(obj.data);
        });
      }

      // REST API: list targets
      app.get(["/json", "/json/list"], function (req, res) {
        t.refreshTargets().then(function () {
          res.set("Content-Type", "application/json");
          res.send(JSON.stringify(t.targets, null, 2));
        }).catch(reportHttpError.bind(_this9, req));
      });

      // REST API: create a new target
      app.get('/json/new', function (req, res) {
        return getJson("/json/new").then(function (target) {
          if (target) target = t._addTarget(target);
          res.set("Content-Type", "application/json");
          res.send(JSON.stringify(target, null, 2));
        });
      });

      // REST API: close a target
      app.get('/json/close/*', function (req, res) {
        return httpGet({
          hostname: t.options.remoteClientHostname,
          port: t.options.remoteClientPort,
          path: req.originalUrl,
          method: 'GET'
        }).then(function (obj) {
          var id = req.originalUrl.match(/\/json\/close\/(.*)$/)[1];
          var proxy = t.proxies[id];
          if (proxy) proxy.close();

          var contentType = getContentType(obj.response);
          if (contentType) res.set("Content-Type", contentType);
          res.send(obj.data);
        });
      });

      // REST API: auto-close a target
      app.get('/json/auto-close/*', function (req, res) {
        t.refreshTargets().then(function () {
          var id = req.originalUrl.match(/\/json\/auto-close\/(.*)$/)[1];
          var proxy = t._proxies[id];
          if (proxy) {
            if (proxy.isUnused()) {
              proxy.closeTarget().close();
              LOG.info("Closing target " + id + " due to /json/auto-close");
              res.send("Target is closing");
            } else {
              proxy.autoClose = true;
              t.targetsById[id].autoClose = true;
              LOG.info("Marking target " + id + " to auto close");
              res.send("Target set to auto close");
            }
          } else {
            var target = t.targetsById[id];
            if (target) {
              target.autoClose = true;
              LOG.info("Marking target " + id + " to auto close after first use");
              res.send("Target will close after first use");
            } else res.status(500).send("Unrecognised target id " + id);
          }
        });
      });

      // REST API: get version numbers
      app.get('/json/version', function (req, res) {
        return getJson(req.originalUrl).then(function (json) {
          json["Chrome-Remote-Multiplex-Version"] = PACKAGE.version;
          res.set("Content-Type", "application/json");
          res.send(JSON.stringify(json, null, 2));
        });
      });

      app.get('/json/protocol', copyToClient);
      app.get('/json/activate', copyToClient);

      var webServer = Http.createServer(app);
      var proxies = this._proxies = {};

      // Upgrade the connection from ExpressJS
      webServer.on('connection', function (socket) {
        LOG.debug("WEB: connection");
      });
      webServer.on('request', function (req, res) {
        LOG.debug("WEB: request");
      });
      webServer.on('upgrade', function (request, socket, head) {
        LOG.debug("WEB: upgrade");
        var pathname = Url.parse(request.url).pathname;
        var m = pathname.match(/\/([^\/]+)$/);
        var uuid = m && m[1] || null;

        if (!uuid) {
          LOG.error("Cannot find UUID in " + pathname);
          socket.destroy();
          return;
        }

        t.refreshTargets().then(function () {
          var target = t.targetsById[uuid];
          if (!target) {
            LOG.error("Cannot find target for " + uuid);
            socket.destroy();
            return;
          }

          var proxy = proxies[uuid];
          if (!proxy) {
            if (!target.webSocketDebuggerUrl || target.type !== "page") {
              LOG.error("Target " + uuid + " not eligable for connection");
              socket.destroy();
              return;
            }
            proxy = proxies[uuid] = new RemoteDebuggerProxy(t, target);
            proxy.connect().then(function () {
              return proxy.upgrade(request, socket, head);
            });
            proxy.on('close', function () {
              delete t.targetsById[uuid];
              for (var i = 0; i < t.targets.length; i++) {
                if (t.targets[i].id === uuid) {
                  t.targets.splice(i, 1);
                  break;
                }
              }
            });
            if (target.autoClose) proxy.autoClose = true;
          } else {
            return proxy.upgrade(request, socket, head);
          }
        });
      });

      return new Promise(function (resolve, reject) {
        LOG.debug("Starting Express server");
        webServer.listen(t.options.listenPort, resolve);
      });
    }

    /**
     * Shuts down
     */

  }, {
    key: 'close',
    value: function close() {
      this.express.close();
      this.express = null;
    }

    /**
     * Rediscovers all targets at the remote server that can be connected to
     */

  }, {
    key: 'refreshTargets',
    value: function refreshTargets() {
      var t = this;
      return httpGet({
        hostname: t.options.remoteClientHostname,
        port: t.options.remoteClientPort,
        path: '/json',
        method: 'GET'
      }).then(function (obj) {
        var json = null;
        if (!obj.data) {
          LOG.debug("No data received from " + t.options.remoteClient);
          return;
        }
        try {
          json = JSON.parse(obj.data);
        } catch (ex) {
          LOG.error("Error while parsing JSON from " + t.options.remoteClient + ": " + ex);
          return;
        }
        var oldTargets = t.targets;
        var oldTargetsById = t.targetsById || {};
        t.targets = json;
        t.targetsById = {};
        for (var i = 0; i < t.targets.length; i++) {
          var target = t.targets[i];
          t.targets[i] = t._addTarget(target, oldTargetsById[target.id]);
        }
      });
    }

    /**
     * Adds a target
     */

  }, {
    key: '_addTarget',
    value: function _addTarget(src, target) {
      var RESERVED_KEYWORDS = ["description", "id", "title", "type", "url", "devtoolsFrontendUrl", "webSocketDebuggerUrl", "originalDevtoolsFrontendUrl", "originalWebSocketDebuggerUrl"];

      var t = this;
      if (!target) target = {};

      for (var name in src) {
        target[name] = src[name];
      }if (target.devtoolsFrontendUrl) target.originalDevtoolsFrontendUrl = target.devtoolsFrontendUrl;
      target.devtoolsFrontendUrl = "/devtools/inspector.html?ws=localhost:" + t.options.listenPort + "/devtools/page/" + target.id;
      if (target.webSocketDebuggerUrl) target.originalWebSocketDebuggerUrl = target.webSocketDebuggerUrl;
      target.webSocketDebuggerUrl = "ws://localhost:" + t.options.listenPort + "/devtools/page/" + target.id;
      target.title += " (proxied)";

      if (target.numberOfClients === undefined) target.numberOfClients = 0;

      return t.targetsById[target.id] = target;
    }
  }]);

  return MultiplexServer;
}(EventEmitter);

/**
 * Does a simple HTTP GET
 * @return Promise - payload is the response context
 */


exports.default = MultiplexServer;
function httpGet(options) {
  return new Promise(function (resolve, reject) {
    var req = Http.request(options, function (response) {
      var str = '';

      response.on('data', function (chunk) {
        str += chunk;
      });

      response.on('end', function () {
        resolve({ data: str, response: response });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Simple promisify
 */
function promisify(fn) {
  return new Promise(function (resolve, reject) {
    fn(function (err, value) {
      if (err) reject(err);else resolve(value);
    });
  });
}

/**
 * Splits a string into domain and method 
 */
function splitName(method) {
  var pos = method.indexOf('.');
  if (pos < 0) return [null, method];
  var domainName = method.substring(0, pos);
  var methodName = method.substring(pos + 1);
  return [domainName, methodName];
}
//# sourceMappingURL=multiplex.js.map
