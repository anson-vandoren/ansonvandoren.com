+++ 
draft = true
date = 2019-12-27T16:46:57-08:00
title = "Captive Web Portal for ESP8266 with MicroPython - Part 4"
description = "Easily authenticate to WiFi with home automation devices"
slug = "" 
tags = ["ESP8266", "MicroPython", "HTTP"]
categories = []
externalLink = ""
series = []
+++

At the end of [Part 3](https://ansonvandoren.com/posts/esp8266-captive-web-portal-part-3/) of this series, I had both a DNS and HTTP server up and running on my Wemos D1 Mini MCU to make a captive portal that will let me set up the D1 Mini to join my home WiFi without needing to hardcode the SSID and password on each new project I make.

All HTTP requests from any client connected to the D1 Mini's WiFi AP are redirected to a web page asking for the home WiFi credentials, but so far nothing happens when you tap the "Connect" button other than being redirected back to the form. In this part, I'll wire up the code to take the submitted SSID and password, and have the MCU try to connect with them.

# Parsing the form submission

I implemented the HTML form action as a GET request instead of POST. This is really the wrong way to do it, but since this is a very small, special-purpose web server, I didn't see any reason to go to the trouble of parsing POST requests as well. So the new WiFi SSID and password will come in as query parameters in a GET request to the `/login` path.

The way I chose to do this is to implement the `/login` route as a function instead of a static file. When that route is requested, the function will try to get the SSID and password from the query parameters and save them. Since we also have the opportunity to modify the headers, I'll send a redirect back to the `/` path for now.

First, let's modify the `get_body()` function so that it knows how to handle a route that's a function instead of a bytestring pointing to a static file.

```python {hl_lines=["15-20"]}
# captive_http.py
...
class HTTPServer(Server):
    ...
    def get_response(self, req):
        """generate a response body and headers, given a route"""

        headers = b"HTTP/1.1 200 OK\r\n"
        route = self.routes.get(req.path, None)

        if type(route) is bytes:
            # expect a filename, so return contents of file
            return open(route, "rb"), headers

        if callable(route):
            # call a function, which may or may not return a response
            response = route(req.params)
            body = response[0] or b""
            headers = response[1] or headers
            return uio.BytesIO(body), headers

        headers = b"HTTP/1.1 404 Not Found\r\n"
        return uio.BytesIO(b""), headers
    ...
```

Next, I'll create a method called `login()` to pull the credentials and save them. I'll also add this to my `routes` dictionary:

```python {hl_lines=[6,7,"10-21"]}
# captive_http.py
...
class HTTPServer(Server):
    def __init__(self, poller, local_ip):
        ...
        self.routes = {b"/": b"./index.html", b"/login": self.login}
        self.saved_credentials = (None, None)
        ...

    def login(self, params):
        ssid = params.get(b"ssid", None)
        password = params.get(b"password", None)
        if all([ssid, password]):
            self.saved_credentials = (ssid, password)
        
        headers = (
            b"HTTP/1.1 307 Temporary Redirect\r\n"
            b"Location: http://{:s}\r\n".format(self.local_ip)
        )
        
        return b"", headers
    ...
```

Now that we have some (hopefully) valid WiFi credentials, we need get the captive portal to try to log in to my home WiFi using those.

# Attempting a WiFi connection

Turning our attention back to the event loop in the `CaptivePortal` class, we need to start checking whether the HTTP server has gotten any login credentials. If it does, we should try to log in to the new WiFi.

I'll add a method that tries to connect to my home WiFi with the provided credentials, if we're not already connected.

```python {hl_lines=["5-16"]}
# captive_portal.py
...
class CaptivePortal:
    ...
    def check_valid_wifi(self):
        if not self.sta_if.isconnected():
            if self.has_creds():
                # have credentials to connect, but not yet connected
                # return value based on whether the connection was successful
                return self.connect_to_wifi()
            # not connected, and no credentials to connect yet
            return False
    
    def has_creds(self):
        self.ssid, self.password = self.http_server.saved_credentials
        return None not in self.http_server.saved_credentials
    ...
```

Then, call this method on each event loop:

```python {hl_lines=["17-18"]}
# captive_portal.py
...
class CaptivePortal:
    ...
    def captive_portal(self):
        ...
        try:
            while True:
                gc.collect()
                # check for socket events and handle them
                for response in self.poller.ipoll(1000):
                    sock, event, *others = response
                    is_handled = self.handle_dns(sock, event, others)
                    if not is_handled:
                        self.handle_http(sock, event, others)
                
                if self.check_valid_wifi():
                    print("Connected to WiFi!")
        except KeyboardInterrupt:
            print("Captive portal stopped")

```

Go ahead and try this out. If you enter your home WiFi SSID and password correctly, you should see these lines somewhere in the MCU output:

```sh {hl_lines=["8-15"]}
Entering REPL. Use Control-X to exit.
>
MicroPython v1.12 on 2019-12-20; ESP module with ESP8266
Type "help()" for more information.
>>>
>>> import main
...
Trying to connect to SSID 'MyHomeWifi' with password notmyrealpassword
#15 ets_task(4020f4d8, 28, 3fffa410, 10)
Connection in progress
Connection in progress
Connection in progress
Connected to MyHomeWifi
Wrote credentials to ./wifi.creds
Connected to WiFi!
Captive portal stopped
Cleaning up
DNS Server stopped
```

# Updating the servers after connection

> **Note:** now that the MCU has successfully connected once, it's saved the credentials to its flash memory and next time you restart the code, it will automatically connect without needing to start up the DNS and HTTP servers. To continue to test the rest of this project, you'll need to delete the `/pyboard/wifi.creds` file to actually get the captive portal to start up.

Now that the MCU is connected to my home WiFi, I need to update the HTTP server with its new IP address on the other network so that redirections continue to work. I can safely shut down the DNS server at this point since I've already redirected to an IP address instead of domain name. Eventually, I'll want to shut down the HTTP server as well, now that the MCU is configured, but I do want to show a "connection successful" page that displays the MCU's new IP address on my home network. 

Let's turn off the DNS server first, since it's no longer doing anything. This is a one-line addition to the captive portal event loop, but we'll also add a line in the same spot to update the HTTP server with its new address and SSID:

```python {hl_lines=["19-20"]}
# captive_portal.py
...
class CaptivePortal:
    ...
    def captive_portal(self):
        ...
        try:
            while True:
                gc.collect()
                # check for socket events and handle them
                for response in self.poller.ipoll(1000):
                    sock, event, *others = response
                    is_handled = self.handle_dns(sock, event, others)
                    if not is_handled:
                        self.handle_http(sock, event, others)

                if self.check_valid_wifi():
                    print("Connected to WiFi!")
                    self.dns_server.stop(self.poller)
                    self.http_server.set_ip(self.local_ip, self.ssid)
        ...
```

For the HTTP server, we need to do a few things in the `set_ip()` function we're about to write:
- Change the existing attribute `local_ip` to the new IP address. This will cause all redirects to point to the new IP address, which is on my home WiFi network instead of the MCU's access point. This way, when I turn off the MCU's access point (which I'll code up soon), I can still see the status page when my phone reconnects to my home network.
- Create a new property called `ssid` that is initially set to `None`, and updated to the new SSID after we connect to it.
- Change the `routes` dictionary so that after we're connected, the root path (`/`) points to a different location, which we'll write as a callable route.

```python {hl_lines=[6,"8-13"]}
# captive_http.py
...
class HTTPServer(Server):
    def __init__(self, poller, local_ip):
        ...
        self.ssid = None

    def set_ip(self, new_ip, new_ssid):
        """update settings after connected to local WiFi"""

        self.local_ip = new_ip.encode()
        self.ssid = new_ssid
        self.routes = {b"/": self.connected}
    ...
```

In the future, I may want a more complicated "connected" page, but for now I just want to display the new SSID the MCU connected to as well as its IP address. To do this, I'm going to make a rudimentary template HTML file, and have the `connected()` function fill in those values before serving it. Let's start with a new HTML page:

```html
<!-- connected.html -->
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connected!</title>
  </head>
  <body>
    <h1>Connected!</h1>
    <p>
      Device is connected to WiFi access point <strong>'%s'</strong> with IP
      address <strong>%s</strong>
    </p>
  </body>
</html>
```

Note the `%s` in two places where I want to fill in the dynamic data: I'll use Python's built-in string formatting methods to convert these into the actual strings I'm looking for after reading in the contents of the HTML file like this:

```python {hl_lines=["5-8"]}
# captive_http.py
...
class HTTPServer(Server):
    ...
    def connected(self, params):
        headers = b"HTTP/1.1 200 OK\r\n"
        body = open("./connected.html", "rb").read() % (self.ssid, self.local_ip)
        return body, headers
    ...
```

Go ahead and test it out. After logging in, you should be redirected to a page showing your home WiFi SSID, and the MCU's new IP address on that network. Additionally, if you look at the address bar in your browser, you should see that it's been updated to the new IP. If you disconnect from the MCU's access point now, and reconnect to your home WiFi, you should see that the page remains available, showing that you are in fact connected.

# Gracefully exiting

We've basically accomplished what we want to now, and have no more need for the captive portal. I do want to keep the HTTP server up at least temporarily, since I may want to add some configuration options the user can select after the MCU is connected to home WiFi. We can, however, shut down the MCU's access point interface. To make sure the transition is complete, I'll add some time delay before shutting it down.

The `check_valid_wifi()` method seems like a good place to put this so that it can coordinate only having one network interface active at a time:

```python {hl_lines=[5,9,"20-35"]}
# captive_portal.py
...
class CaptivePortal:
    ...
    AP_OFF_DELAY = const(10 * 1000)
    
    def __init__(self, essid=None):
        ...
        self.conn_time_start = None
    ...
    def check_valid_wifi(self):
        if not self.sta_if.isconnected():
            if self.has_creds():
                # have credentials to connect, but not yet connected
                # return value based on whether the connection was successful
                return self.connect_to_wifi()
            # not connected, and no credentials to connect yet
            return False

        if not self.ap_if.active():
            # access point is already off; do nothing
            return False

        # already connected to WiFi, so turn off Access Point after a delay
        if self.conn_time_start is None:
            self.conn_time_start = time.ticks_ms()
            remaining = self.AP_OFF_DELAY
        else:
            remaining = self.AP_OFF_DELAY - time.ticks_diff(
                time.ticks_ms(), self.conn_time_start
            )
            if remaining <= 0:
                self.ap_if.active(False)
                print("Turned off access point")
    ...
```

# Odds and ends

This project is just about finished. A few final notes that may help you get this set up on your own:

- Sometimes either the server, or my phone would screw up the socket connection and I'd get `ECONNRESET` errors. Using the built-in function `machine.reset()` on the MCU usually fixed this, but sometimes I'd need to completely close the browser app on my phone and start it again to clear out the connection.
- Occasionally, I'd find that the HTTP server was taking forever to respond to requests. I added the ` @micropython.native` annotation to the `HTTPServer.handle()` function which seemed to improve this.
- You may find that the 10 second delay for shutting off the MCU's access point may not be long enough for the redirect to go through. It's easy enough to bump up until you find what works for you.

I'd love to hear your feedback on this project! If made some cool modifications/additions to the code, integrated it with your project, or found some issues, please let me know in the comments, or on the GitHub repo!

---------------------

Code: [GitHub project repo](https://github.com/anson-vandoren/esp8266-captive-portal)

Found a problem with this post? Submit a PR to fix it here: [GitHub website repo](https://github.com/anson-vandoren/ansonvandoren.com/blob/master/content/posts/esp8266-captive-web-portal-part-4.md)