# chrome-remote-multiplex
Proxy Server application which allows *multiple* Chrome DevTools Clients to simultaneously connect to a *single* Remote Debugger 
(ie Chrome Headless) instance.


**NOTE** This project appears to be obsolete now that Chrome supports multiple clients natively - please see 
https://developers.google.com/web/updates/2017/10/devtools-release-notes#multi-client for details


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


## Managing Lifecycle - automatically closing Chrome Tabs
When instrumenting Chrome Headless, you will often create and close instances - for example, [chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)
has this example use of the command line to create a instance (i.e. a tab or window) and then close it again:

```
$ chrome-remote-interface new 'http://example.com'
{
    "description": "",
    "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:9222/devtools/page/b049bb56-de7d-424c-a331-6ae44cf7ae01",
    "id": "b049bb56-de7d-424c-a331-6ae44cf7ae01",
    "thumbnailUrl": "/thumb/b049bb56-de7d-424c-a331-6ae44cf7ae01",
    "title": "",
    "type": "page",
    "url": "http://example.com/",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/b049bb56-de7d-424c-a331-6ae44cf7ae01"
}
$ chrome-remote-interface close 'b049bb56-de7d-424c-a331-6ae44cf7ae01'
```

Or as http requests, try this in your browser:
- `localhost:9222/json/new` -- output the new instance information
- `localhost:9222/json/close/{id}` -- where `{id}` is taken from the output of `/json/new` 

If your application is running in a server environment, you obviously need to make sure that you keep track of all of the
instances that you create via the `new` command and make sure that you `close` them when they're no longer needed.

While this is straightforward to do in ideal circumstances, in a complex server application it can become tricky to manage
those instances, especially if you want to recover gracefully from application crashes or occasionally want to sneak in 
with a separate connection and keep the the instance open while you debug it.

[chrome-remote-multiplex](https://github.com/johnspackman/chrome-remote-multiplex) adds an automatic close function that
tracks connections and when the last one has disconnected from an instance, the instance itself is closed down.  This means
that even if your application crashes, the tab is cleaned up properly because the operating system will close the socket which
will disconnect from the MultiplexServer and then cause the tab to be removed also - this is garbage collection for your browser tabs.

To make a tab automatically close, use the new `/json/auto-close/{id}` API, for example:

```
$ chrome-remote-interface -p 9223 new 'http://www.google.co.uk'
  # Let's say the output from the above command has an "id" of "b049bb56-de7d-424c-a331-6ae44cf7ae01"

$ # use the REST API to make the new tab auto-close 
$ wget -O- http://localhost:9223/json/auto-close/b049bb56-de7d-424c-a331-6ae44cf7ae01
```

Now browse to `http://localhost:9223` and click on the link to start debugging your new tab; when you close that debugger and
go back to the `http://localhost:9223` you will see that the tab you just finished debugging has gone.

Note that if the instance has never been connected to, then it will only be closed once you have connected a DevTools client(s) to it
and the last client has disconnected; if you have previously connected and closed a DevTools client, the instance will close immmediately.


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





