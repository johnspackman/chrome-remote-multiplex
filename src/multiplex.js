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


const Protocol = require('chrome-remote-interface').Protocol;
const EventEmitter = require('events');
const WebSocket = require('ws');
const Express = require('express');
const Http = require('http');
const Url = require('url');
const Dot = require('dot'); 


class Logger {
  constructor() {
    this.mode = "info";
  }
  
  log(...args) {
    console.log(...args);
  }
  
  error(...args) {
    this.log(...args);
  }

  debug(...args) {
    if (this.mode === "debug")
      this.log(...args);
  }
}

const LOG = new Logger();


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
    if (typeof fn === "function")
      api[name] = api[name].bind(self);
  }
  
  var tmp = null;
  api.replied = new Promise((resolve, reject) => {
    tmp = { resolve, reject };
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
class ProxyDomain extends EventEmitter {
  
  constructor(remoteDebuggerProxy) {
    super();
    this.remoteDebuggerProxy = remoteDebuggerProxy;
  }
  
  onEvent(data) {
  }
}


/**
 * ProxyDomain implementation for most domains; it collects enable/disable into a single
 * enable/disable with a reference count
 */
class DefaultProxyDomain extends ProxyDomain {
  constructor(remoteDebuggerProxy) {
    super(remoteDebuggerProxy);
    this._enabled = 0;
  
    addApi(this, "enable", {
      send(devtoolsClient, data, sendImpl) {
        var t = this;
        this._enabled++;
        if (t._enabled === 1) {
          sendImpl(data);
        } else {
          t.enable.replied.then(() => {
            return devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false);
          });
        }
        
        return false;
      },
      
      reply(devtoolsClient, data) {
        var t = this;
        return devtoolsClient.sendMessageToClient(data).then(() => { 
          t.enable.replied.resolve(data);
        });
      }
    });
    
    addApi(this, "disable", {
      send(devtoolsClient, data, sendImpl) {
        this._enabled--;
        if (this._enabled === 0) {
          sendImpl(data);
        } else {
          t.disable.replied.then((data) => {
            return devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false);
          });
        }
        
        return false;
      }
    });
  }
}


/**
 * Implementation of ProxyDomain for the Runtime domain.  Execution contexts have
 * to be tracked because the remote debug server will only publish them to us once,
 * so we have to store them and publish them to each client that attaches to us.
 */
class RuntimeProxyDomain extends ProxyDomain {
  constructor(remoteDebuggerProxy) {
    super(remoteDebuggerProxy);
    this._enabled = 0;
    this._executionContexts = {};
    
    addApi(this, "enable", {
      send(devtoolsClient, data, sendImpl) {
        var t = this;
        this._enabled++;
        if (t._enabled === 1) {
          sendImpl(data);
        } else {
          t.enable.replied.then(() => {
            var promises = [];
            promises.push(devtoolsClient.sendMessageToClient({ id: data.id, result: {} }, false));
            for (var id in t._executionContexts)
              promises.push(devtoolsClient.sendMessageToClient(t._executionContexts[id], true));
            
            return Promise.all(promises);
          });
        }
        
        return false;
      },
      
      reply(devtoolsClient, data) {
        var t = this;
        return devtoolsClient.sendMessageToClient(data).then(() => { 
          t.enable.replied.resolve(data);
        });
      },
      
      replied: null
    });
    
    addApi(this, "disable", {
      send(devtoolsClient, data, sendImpl) {
        this._enabled--;
        if (this._enabled === 0) {
          sendImpl(data);
        }
        
        return false;
      }
    });
    
  }

  
  onEvent(data) {
    var t = this;
    
    if (data.method === "Runtime.executionContextCreated") {
      t._executionContexts[data.params.context.id] = data;
    } else if (data.method === "Runtime.executionContextDestroyed") {
      delete t._executionContexts[data.params.contextId];
    } else if (data.method === "Runtime.executionContextsCleared") {
      t._executionContexts = {};
    }
  }
}


/**
 * Represents a single connection from a Devtools client
 */
class DevtoolsClient extends EventEmitter {
  constructor(remoteDebuggerProxy, ws) {
    super();
    const t = this;
    this.remoteDebuggerProxy = remoteDebuggerProxy;
    this.ws = ws;
    ws.on("close", () => remoteDebuggerProxy.detach(this));
    ws.on('message', function (data) {
      const message = JSON.parse(data);
      t.onMessageFromClient(message);
    });
  }
  
  onMessageFromClient(data) {
    const t = this;
    return t.remoteDebuggerProxy.sendMessageToServer(this, data);
  }
  
  sendMessageToClient(data, broadcast) {
    const t = this;
    
    return promisify((cb) => {
      LOG.debug("REPLY: " + JSON.stringify(data));
      t.ws.send(JSON.stringify(data), cb);
    });
  }
}


/**
 * Represents the single connection to the remote devtools debugger (ie Headless Chrome),
 * and tracks the multiple DevtoolsClient instances which attach to it
 */
class RemoteDebuggerProxy extends EventEmitter {
  constructor(multiplexServer, target) {
    super();
    this.multiplexServer = multiplexServer;
    this.target = target;
    this.devtoolsClients = [];
    this._idMap = {};
    this._nextCommandId = 1;
    this._domainProxies = {
        Runtime: new RuntimeProxyDomain(this)
    };
  }

  /**
   * Connects to the remote debugger instance (ie Chrome Headless)
   */
  connect() {
    const t = this;
    Protocol(t.options).then((data) => {
      data.descriptor.domains.forEach((domain) => {
        if (t._domainProxies[domain.domain] !== undefined)
          return;
        var cmdEnable = null;
        var cmdDisable = null;
        domain.commands.forEach((command) => {
          if (command.name === "enable")
            cmdEnable = command;
          else if (command.name === "disable")
            cmdDisable = command;
        });
        if (cmdEnable || cmdDisable) {
          LOG.debug("Creating default domain for " + domain.domain);
          t._domainProxies[domain.domain] = new DefaultProxyDomain(this);
        }
      });
    });
    return new Promise((resolve, reject) => {
      var url = t.target.originalWebSocketDebuggerUrl;
      url = url.replace(/localhost\:/g, t.multiplexServer.options.remoteClientHostname + ":");
      var ws = t.ws = new WebSocket(url);
      ws.on('open', resolve);
      ws.on('close', function (code) {
        t.emit('disconnect');
      });
      ws.on('error', reject);
      ws.on('message', function (data) {
        const message = JSON.parse(data);
        t.onMessageFromServer(message);
      });
    });
  }
  
  /**
   * Detaches a DevTools client
   */
  detach(devtoolsClient) {
    for (var i = 0; i < this.devtoolsClients.length; i++)
      if (this.devtoolsClients[i] === devtoolsClient) {
        this.devtoolsClients.splice(i, 1);
        return;
      }
  }
  
  /**
   * Attaches a DevTools client
   */
  attach(devtoolsClient) {
    this.devtoolsClients.push(devtoolsClient);
  }
  
  /**
   * Upgrade request from express
   */
  upgrade(request, socket, head) {
    const t = this;
    const wss = new WebSocket.Server({ noServer: true });

    wss.handleUpgrade(request, socket, head, (ws) => {
      var devtoolsClient = new DevtoolsClient(t, ws);
      t.attach(devtoolsClient);
      wss.emit('connection', ws);
    });
  }
  
  /**
   * Handles a message from the remote debugger
   */
  onMessageFromServer(data) {
    const t = this;
    
    LOG.debug('SERVER: %s...', JSON.stringify(data));
    
    // Map API IDs back to client'ss original ID
    if (data.id) {
      var map = t._idMap[data.id];
      if (map) {
        data.id = map.originalId;
        
        // Offer to domain specific proxies
        var [ domainName, methodName ] = splitName(map.data.method);
        var domainProxy = this._domainProxies[domainName];
        var api = domainProxy && domainProxy[methodName];
        if (api && typeof api.reply === "function") {
          var result = api.reply(map.devtoolsClient, data);
          if (result !== undefined)
            return result;
        }
        
        // Just bounce it straight on
        return map.devtoolsClient.sendMessageToClient(data);
      } else {
        LOG.error("Server message for id " + data.id + " not matched");
        return;
      }
    }
    
    // Handle events - offer to domain specific proxy
    var [ domainName, methodName ] = splitName(data.method);
    var domainProxy = this._domainProxies[domainName];
    if (domainProxy) {
      var result = domainProxy.onEvent(data);
      if (result !== undefined)
        return result;
    }
    
    // Pass event on
    this.devtoolsClients.forEach(function(devtoolsClient) {
      devtoolsClient.sendMessageToClient(data, true);
    });
  }
  
  /**
   * Allows a DevToolsClient to send a message to the server; handles mapping the
   * client's own ID to a global one for the server 
   */
  sendMessageToServer(devtoolsClient, data) {
    const t = this;
    
    LOG.debug('CLIENT: %s...', JSON.stringify(data));
    
    // Offer the domain proxy the opportunity to handle the method call
    if (data.method) {
      var [ domainName, methodName ] = splitName(data.method);
      var domainProxy = this._domainProxies[domainName];
      var api = domainProxy && domainProxy[methodName];
      if (api && typeof api.send === "function") {
        var result = api.send(devtoolsClient, data, doSend);
        if (result !== undefined)
          return result;
      }
    }
    
    // Just send it
    return doSend(data);
    
    function doSend(data) {
      if (data.id !== undefined) {
        var newId = t._nextCommandId++;
        t._idMap[newId] = {
            newId,
            originalId: data.id,
            data: data,
            devtoolsClient
        };
        data.id = newId;
      }
      
      return promisify((cb) => {
        t.ws.send(JSON.stringify(data), cb);
      });
    }
  }
}


/**
 * This is the main server instance that clients connect to; it contains the ExpressJS server,
 * communicates with the remote debug server, and establishes RemoteDebuggerProxy instances
 * for each remote target 
 * 
 */

const DEFAULT_DEVTOOLS_URL = "https://chrome-devtools-frontend.appspot.com/serve_file/@4b9102f9588fb6cf639a6165fd4777658d5ade0d/inspector.html?";

export default class MultiplexServer extends EventEmitter {
  constructor(options) {
    super();
    options = options||{};
    if (options.logging === "debug")
      LOG.mode = "debug";
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
    this.options = {
      listenPort: options.listenPort || 9223,
      remoteClientHostname: options.remoteClientHostname||"localhost",
      remoteClientPort: options.remoteClientPort||9222
    };
    this.options.remoteClient = this.options.remoteClientHostname + ":" + this.options.remoteClientPort;
  }

  listen() {
    const t = this;
    
    const app = Express();

    function reportHttpError(req, err) {
      LOG.error("Error in " + req.method + " " + req.originalUrl + ": " + err);
    }
    
    /*
     * Web page that provides links to debug
     */
    (function() {
// https://chrome-devtools-frontend.appspot.com/serve_file/@4b9102f9588fb6cf639a6165fd4777658d5ade0d/inspector.html?ws=localhost:9223/devtools/page/1e371c5b-25ef-4ee9-9ef6-3ca11d9d59ee&remoteFrontend=true
      
      var template = Dot.template(
`<html><body>
  <h1>Headless proxy</h1>
  <ul>
    {{~ it.multiplex.targets :target }}
          <li>
            <a href="{{= it.url(target) }}">
              {{= target.title }}
            </a>
          </li>
    {{~}}
  </ul>
</body></html>`);
    
      app.get('/', function (req, res) {
        t.refreshTargets()
          .then(function() {
            res.send(template({
              multiplex: t,
              DEFAULT_DEVTOOLS_URL: DEFAULT_DEVTOOLS_URL,
              url: function(target) { 
                return DEFAULT_DEVTOOLS_URL + target.webSocketDebuggerUrl.replace(/^ws:\/\//, "ws=/") + "&remoteFrontend=true";
              }
            }));
          })
          .catch(reportHttpError.bind(this, req));
      });
    })();

    /*
     * JSON data showing the targets which can be connected to
     */
    function getTargetList(req, res) {
      t.refreshTargets()
        .then(function() {
          res.set('Content-Type', 'text/json');
          res.send(JSON.stringify(t.targets, null, 2));
        })
        .catch(reportHttpError.bind(this, req));
    }
    app.get('/json', getTargetList);
    app.get('/json/list', getTargetList);

    const webServer = Http.createServer(app);
    const proxies = this._proxies = {};

    // Upgrade the connection from ExpressJS
    webServer.on('connection', (socket) => {
      LOG.debug("WEB: connection");
    });
    webServer.on('request', (req, res) => {
      LOG.debug("WEB: request");
    });
    webServer.on('upgrade', (request, socket, head) => {
      LOG.debug("WEB: upgrade");
      const pathname = Url.parse(request.url).pathname;
      var m = pathname.match(/\/([^\/]+)$/);
      var uuid = (m && m[1])||null;
      
      if (!uuid) {
        LOG.error("Cannot find UUID in " + pathname);
        socket.destroy();
        return;
      }
      
      t.refreshTargets().then(function() {
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
          proxy.connect().then(function() {
            return proxy.upgrade(request, socket, head);
          })
        } else {
          return proxy.upgrade(request, socket, head);
        }
      });
    });
    
    return new Promise((resolve, reject) => {
      LOG.debug("Starting Express server");
      webServer.listen(t.options.listenPort, resolve);
    })
  }
  
  /**
   * Shuts down
   */
  close() {
    this.express.close();
    this.express = null;
  }
  
  /**
   * Rediscovers all targets at the remote server that can be connected to
   */
  refreshTargets() {
    var t = this;
    return httpGet({
      hostname: t.options.remoteClientHostname,
      port: t.options.remoteClientPort,
      path: '/json',
      method: 'GET'
    }).then(function(data) {
      var json = null;
      if (!data) {
        LOG.debug("No data received from " + t.options.remoteClient);
        return;
      }
      try {
        json = JSON.parse(data);
      } catch(ex) {
        LOG.error("Error while parsing JSON from " + t.options.remoteClient + ": " + ex);
        return;
      }
      t.targets = json;
      t.targetsById = {};
      var regex = new RegExp("localhost:" + t.options.remoteClientPort);
      json.forEach(function(target) {
        if (target.devtoolsFrontendUrl)
          target.originalDevtoolsFrontendUrl = target.devtoolsFrontendUrl;
        target.devtoolsFrontendUrl = "/devtools/inspector.html?ws=localhost:" + t.options.listenPort + "/devtools/page/" + target.id;
        if (target.webSocketDebuggerUrl)
          target.originalWebSocketDebuggerUrl = target.webSocketDebuggerUrl;
        target.webSocketDebuggerUrl = "ws://localhost:" + t.options.listenPort + "/devtools/page/" + target.id;
        target.title += " (proxied)";
        
        t.targetsById[target.id] = target;
      });
    });
  }
}

/**
 * Does a simple HTTP GET
 * @return Promise - payload is the response context
 */
function httpGet(options) {
  return new Promise((resolve, reject) => {
    var req = Http.request(options, function(response) {
      var str = '';

      response.on('data', function (chunk) {
        str += chunk;
      });

      response.on('end', function () {
        resolve(str);
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
  return new Promise((resolve, reject) => {
    fn(function(err, value) {
      if (err)
        reject(err);
      else
        resolve(value);
    });
  });
}

/**
 * Splits a string into domain and method 
 */
function splitName(method) {
  var pos = method.indexOf('.');
  if (pos < 0)
    return [ null, method ];
  var domainName = method.substring(0, pos);
  var methodName = method.substring(pos + 1);
  return [ domainName, methodName ];
}

