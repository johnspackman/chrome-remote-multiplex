# chrome-remote-multiplex
Proxy Server application for Chrome DevTools Clients to simultaneously connect to a single Remote Debugger 
(ie Chrome Headless) instance.

Google Chrome Headless (or any other Devtools Protocol implementation) only allows one client to control
it at any particular time; this means that if you have an application which uses https://github.com/cyrus-and/chrome-remote-interface
to operate the web page, you cannot debug that web page while it is being controlled by your application.

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





