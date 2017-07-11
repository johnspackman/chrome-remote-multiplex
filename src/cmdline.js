#!/usr/bin/env node

import MultiplexServer from "./multiplex";

var PACKAGE = require("../package.json");

var argv = require("yargs")
  .usage("$0 [args]")
  .options({
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
  })
  .help()
  .argv;

var server = new MultiplexServer({
  remoteClient: argv.connectTo,
  listenPort: argv.serverPort,
  logging: argv.debug ? "debug" : "info"
});
server.listen()
  .then(() => {
    console.log(
        PACKAGE.name + " v" + PACKAGE.version + "\n" +
        "Report issues at " + PACKAGE.bugs.url + "\n\n" +
        "Connected to remote headless Chrome at http://" + server.options.remoteClient + 
        "\nTo start debugging, browse to http://localhost:" + server.options.listenPort);
    return new Promise(() => {});
  })
  .catch((err) => console.log("Error while talking to remote headless Chrome: " + err));

