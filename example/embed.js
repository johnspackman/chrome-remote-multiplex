
var ChromeRemoteInterface = require('chrome-remote-interface');
//var MultiplexServer = require("chrome-remote-multiplex").MultiplexServer;
var MultiplexServer = require("..").MultiplexServer;

var server = new MultiplexServer({
  logging: "debug"
});
var remoteClient = null;
server.listen()
  .then(() => {
    console.log("Connecting client to headless chrome ...");
    return ChromeRemoteInterface({ port: server.options.listenPort })
      .then((_remoteClient) => {
        remoteClient = _remoteClient;
        remoteClient.Network.requestWillBeSent(params => {
          console.log("REQUEST: " + params.request.url);
        });
        
        remoteClient.Runtime.consoleAPICalled((entry) => {
          var str = "";
          entry.args.forEach(function(ro) {
            str += " " + ro.value;
          });
          console.log("CONSOLE API: " + entry.type + " " + str);
          return remoteClient.Runtime.discardConsoleEntries();
        });
        
        // enable events then start!
        return Promise.all([ remoteClient.Network.enable(), remoteClient.Page.enable(), remoteClient.Runtime.enable() ]);
      });
  })
  .then(function() {
    console.log("Visiting URL ...");
    return remoteClient.Page.navigate({ url: "http://www.google.co.uk" });
  })
  .then(() => {
    return new Promise((resolve, reject) => setTimeout(resolve, 1500));
  })
  .catch((err) => console.log("Error while talking to Chrome: " + err));

