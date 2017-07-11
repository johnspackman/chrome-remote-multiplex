#!/usr/bin/env node
"use strict";

var _multiplex = require("./multiplex");

var _multiplex2 = _interopRequireDefault(_multiplex);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var argv = require("yargs").usage("$0 [args]").options({
  "connect-to": {
    default: "localhost:9222",
    describe: "Host and port to connect to, running Chrome Headless",
    type: "string"
  },
  "server-port": {
    default: 9223,
    describe: "The port for this proxy server to listen on",
    type: "number"
  },
  "debug": {
    default: false,
    describe: "Include debug output",
    type: "bool"
  }
}).help().argv;

var server = new _multiplex2.default({
  remoteClient: argv.connectTo,
  listenPort: argv.serverPort,
  logging: argv.debug ? "debug" : "info"
});
server.listen().then(function () {
  console.log("Connected to remote headless Chrome at http://" + server.options.remoteClient + "\nTo start debugging, browse to http://localhost:" + server.options.listenPort);
  return new Promise(function () {});
}).catch(function (err) {
  return console.log("Error while talking to remote headless Chrome: " + err);
});
//# sourceMappingURL=cmdline.js.map
