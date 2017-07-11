# chrome-remote-multiplex
Proxy Server application which allows *multiple* Chrome DevTools Clients to simultaneously connect to a *single* Remote Debugger 
(ie Chrome Headless) instance.

Google Chrome Headless (or any other Devtools Protocol implementation) only allows one client to control
it at any particular time; this means that if you have an application which uses 
[chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)
to operate the web page, you cannot debug that web page while it is being controlled by your application.

By using [chrome-remote-multiplex](https://github.com/johnspackman/chrome-remote-multiplex) you can work 
around this restriction, by connecting your app and your debugger(s) to chrome-remote-multiplex and allowing 
it to handle the single connection to Chrome Headless. 
 

## Getting started
```
google-chrome-canary --headless --remote-debugging-port=9222 --disable-gpu https://chromium.org

npm install -g chrome-remote-multiplex
chrome-remote-multiplex
```

And then open a browser and go to `http://localhost:9223`.

You can change the ports that chrome-remote-multiplex uses via the command line, this command line has exactly the same effect as above:

```
chrome-remote-multiplex --connect-to=localhost:9222 server-port=9223
```


## Embedding in your application
You can embed the multiplex proxy server in your own application:

```
var MultiplexServer = require("chrome-remote-multiplex").MultiplexServer;
var ChromeRemoteInterface = require('chrome-remote-interface');

var server = new MultiplexServer({
  logging: "debug"
});

server.listen()
  .then(() => {
    // Use chrome-remote-interface to connect back to the server we've just created
    return ChromeRemoteInterface({ port: server.options.listenPort });
  });
```

There is a full example in [example/embed.js](https://github.com/johnspackman/chrome-remote-multiplex/blob/master/example/embed.js)


## Contributing
Please feel free to raise issues, pull requests, and questions.





