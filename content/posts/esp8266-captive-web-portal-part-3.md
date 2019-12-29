+++ 
draft = true
date = 2019-12-25T14:47:09-08:00
title = "Captive Web Portal for ESP8266 with MicroPython - Part 3"
description = "Easily authenticate to WiFi with home automation devices"
slug = "" 
tags = ["ESP8266", "MicroPython", "DNS", "home automation"]
categories = []
externalLink = ""
series = []
+++

# Recap

In [Part 2](https://ansonvandoren.com/posts/esp8266-captive-web-portal-part-2/) of this series, I finished implementing the "captive portal" DNS server so that after connecting to my Wemos D1 Mini MCU's WiFi access point, all DNS queries pointed toward the MCU's IP address instead of the actual IP address for the requested domain. I'm implementing this captive portal as a way to be able to configure the MCU to be able to log into my home WiFi without hardcoding the SSID and password, so what I need to do next is set up a HTTP server that will present a form where I can fill out these details.

So far, the `CaptivePortal` class creates the DNS Server and registers its socket with a poller that listens for data on the socket stream. This was fairly straightforward since UDP (which DNS uses) is connectionless, and I didn't need to keep track of whether a connection was fully closed or not. I'll do something similar for the HTTP server, but will need to keep track of which connections are incoming and outgoing, and which are closed. This makes things a little more complicated, but I'll start with my base server superclass, and proceed bit-by-bit from there.

# Basic HTTP server with sockets

Create a new file called `captive_http.py` and add the code below:

```python
# captive_http.py
import usocket as socket

from server import Server

class HTTPServer(Server):
    def __init__(self, poller, local_ip):
        super().__init__(poller, 80, socket.SOCK_STREAM, "HTTP Server")
        if type(local_ip) is bytes:
            self.local_ip = local_ip
        else:
            self.local_ip = local_ip.encode()
        self.request = dict()
        self.conns = dict()

        # queue up to 5 connection requests before refusing
        self.sock.listen(5)
        self.sock.setblocking(False)
    
    def handle(self, sock, event, others):
        if sock is self.sock:
            # client connecting on port 80, so spawn off a new
            # socket to handle this connection
            print("- Accepting new HTTP connection")
            self.accept(sock)
         elif event & select.POLLIN:
            # socket has data to read in
            print("- Reading incoming HTTP data")
            self.read(sock)
       elif event & select.POLLOUT:
            # existing connection has space to send more data
            print("- Sending outgoing HTTP data")
            self.write_to(sock)
```

Here's the basis for how the HTTP server will look. It has a `handle()` method just like the DNS server did, but in this case we need to consider three different cases:

1. The client wants to initiate a new request from the HTTP server. In this case the event will come in over the original socket, on port 80. I'll handle this in the `accept()` method by spawning off a new socket to handle that particular request/response.
2. An existing connection (on a spawned socket) has sent us more data. This is signified by a `POLLIN` event on the spawned socket, calls the `read()` method to read in the data from the socket until we get to the end of the full message.
3. An existing connection (on a spawned socket) is ready for us to send more data to the client. This is signified with a `POLLOUT` event on the spawned socket, and I'll handle it in the `write_to()` method by sending the next set of data for that connection.

One point to keep in mind here is that regardless of the actual size of the incoming or outgoing messages, we'll only be sending segments of 536 bytes at a time; this is the default [maximum segment size](https://en.wikipedia.org/wiki/Maximum_segment_size) for TCP/IP.

- For reading data in from the socket, this is relatively easy: just read all data that's sent until we get to the end. For this server, we only need to handle HTTP GET requests, so we can assume that if we find a blank line in the data (`\r\n\r\n`), it is the end of the message. If we needed to handle POST requests as well, we'd need to read in the `Content-Length` or `Transfer-Encoding: Chunked` headers to determine how to know when the request was finished.
- For writing data out to the socket, we need to break the response up into chunks of 536 bytes each. After sending each chunk, we'll advance a pointer to where the next chunk of data will be, then return and wait for the poller to let us know the socket is available to send more data. Once there's no more data left to write, we close the socket.

## Accepting a new socket connection

Let's start with the easiest case: accepting a new connection. Here, we already know what socket to expect the connection request on, since it's the same socket we created at initialization (referred to as the "server socket"). The `socket.accept()` method will spawn off a new socket (the "client socket") to use for this connection and return the new client socket as well as the destination address it's paired to.

Later on in the project, our server will be connecting to my home WiFi and closing down its own access point. In that case, the MCU's IP address will change, but it may have already sent out a redirect to the client for the new IP address. The client will think it should open a new connection, but our server is still holding onto some data in the previously-opened socket. To avoid an error message telling me the socket is already open in this case, I'm catching the exception here and returning early since I'll be able to reuse the previous socket in that case.

Once I have the newly-spawned socket, I set it to non-blocking and reusable (like the server socket), and then add it to the list of open streams on which poller will listen for events.

At this point, the server socket goes back to listening for new incoming connections, and the newly-created client socket will do the work of reading in the request and writing out a response.

```python
# captive_http.py
...
import uerrno
import uselect as select
...
class HTTPServer(Server):
    ...
    def accept(self, server_sock):
        """accept a new client request socket and register it for polling"""

        try:
            client_sock, addr = server_sock.accept()
        except OSError as e:
            if e.args[0] == uerrno.EAGAIN:
                return

        client_sock.setblocking(False)
        client_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.poller.register(client_sock, select.POLLIN)
```

## Reading from a client socket

Once we're spawned off a client socket for an incoming connection request, and set it up for polling, we should expect a subsequent `POLLIN` event (or several) where the client is sending us data that we need to read in. The way we're building this project, we can assume that any `POLLIN` event that doesn't belong to the DNS socket is going to be a client socket for the HTTP server, so we can just pass them all to our new `read()` method below.

Calling the incoming socket's `read()` method gives us some amount of data, but we don't know upfront whether it's the full message or a partial message. If there's no data, it's a good sign that we already hit the end of the message, and we should just close the socket now.

Otherwise, let's check if we're already partway through an incoming message for this client socket. If we are, add the new data to the existing partial message, otherwise create an empty byte string and append the data.

Here, we're going to cheat a little bit since we only need to handle GET requests, and we can assume that any blank line signifies the end of the message. If the last four bytes of the incoming data is not `\r\n\r\n`, we expect there's more to come, so return early and wait for the next `POLLIN` event.

If we did find a blank line at the end, get the full request and print it out so we can take a look. The client will be expecting a message back, so for now let's just queue up a `404 Not Found` message to get them off our backs until we can code up a way to send real HTML.

```python
# captive_http.py
...
import uio
...
class HTTPServer(Server):
    ...
    def read(self, s):
        """read in client request from socket"""

        data = s.read()
        if not data:
            # no data in the TCP stream, so close the socket
            self.close(s)
            return

        # add new data to the full request
        sid = id(s)
        self.request[sid] = self.request.get(sid, b"") + data

        # check if additional data expected
        if data[-4:] != b"\r\n\r\n":
            # HTTP request is not finished if no blank line at the end
            # wait for next read event on this socket instead
            return

        # get the completed request
        req = self.request.pop(sid)
        
        print("Client raw request:\n", req)
        
        # send a 404 response for now
        headers = b"HTTP/1.1 404 Not Found\r\n"
        body = uio.BytesIO(b"")
        self.prepare_write(s, body, headers)
```

## Sending to a client socket

Now all that's left to complete the HTTP transaction is to write a response back to the client. Remember that we're limited to writing 536 bytes at a time, but our response may be longer than that. In the previous section, after reading in the request, we called `prepare_write()` with the headers and body we wanted to send back to the client. We'll need a way to keep track of how much data we've written out to for each response, and where we should start writing next time the same socket is ready to accept more.

To help keep track of all that, I made a `namedtuple` for the writer connection that contains the full response body we need to send, a buffer that will contain only the next 536 (maximum) bytes we plan to send, a memoryview of the buffer to help with writing in and out of the buffer without needless copying, and a range for starting and ending bytes of the buffer that we want to send next. Notice that I'm not keeping a copy of the headers, since they'll always (in our case) be less than 536 bytes and will always go out with the first message segment.

With all that in place, I'm adding an extra newline to the headers to get a blank line (required between headers and body), and then writing the headers into the buffer (padded to make the buffer size 536 bytes). Then I use the memoryview to read from the body into the buffer, up to a maximum total of 536 bytes in the buffer. The `readinto()` call tells me how many bytes were actually read from body into the buffer, and I use that number to set my starting `write_range`. I save the `WriteConn` information into the `self.conns` dictionary with a key of the socket's ID in memory so I can look it up later if I need to write the remainder of the message.

Lastly, I let the poller know that I'm prepared to write out to the socket, so it can let me know when the socket is available for outgoing data. This means I'll start getting `POLLOUT` events for this socket, which I'll need to handle to actually start writing this data.

```python
# captive_http.py
...
from collections import namedtuple
WriteConn = namedtuple("WriteConn", ["body", "buff", "buffmv", "write_range"])
...
class HTTPServer(Server):
    ...
    def prepare_write(self, s, body, headers):
        # add newline to headers to signify transition to body
        headers += "\r\n"
        # TCP/IP MSS is 536 bytes, so create buffer of this size and
        # initially populate with header data
        buff = bytearray(headers + "\x00" * (536 - len(headers)))
        # use memoryview to read directly into the buffer without copying
        buffmv = memoryview(buff)
        # start reading body data into the memoryview starting after
        # the headers, and writing at most the remaining space of the buffer
        # return the number of bytes written into the memoryview from the body
        bw = body.readinto(buffmv[len(headers) :], 536 - len(headers))
        # save place for next write event
        c = WriteConn(body, buff, buffmv, [0, len(headers) + bw])
        self.conns[id(s)] = c
        # let the poller know we want to know when it's OK to write
        self.poller.modify(s, select.POLLOUT)
```

Now that the poller is set to pass `POLLOUT` events to this client socket, we need to handle those events, which will trigger a call to our new `write_to()` method. First, we need to get the writer connection back, which will have everything we need to determine which bytes need to be written out. Remember that the `write_range` value of this tuple is a list of start and end positions of the buffer that we should write. If the buffer is full, this would normally be `[0, 536]`, and we'd write the entire contents of the buffer. If the buffer is only partially full, the second value in the list would be something less than 536. If we got interrupted while writing last time, the first value may be something higher than 0, and we'e start writing from that position instead.

After writing out to the socket, we check how much was written. If we didn't write any bytes, or we had less than 536 bytes to write, we're done sending this response, and we can close the socket.

Otherwise, we wrote all the bytes in the buffer, so we need to keep the socket open, advance the buffer to the next bytes of the response body so that when the next `POLLOUT` event comes in, we'll be prepared to continue writing, which we do in the `buff_advance()` method.

```python
# captive_http.py
...
class HTTPServer(Server):
    ...
    def write_to(self, sock):
        """write the next message to an open socket"""
        
        # get the data that needs to be written to this socket
        c = self.conns[id(sock)]
        if c:
            # write next 536 bytes (max) into the socket
            bytes_written = sock.write(
                c.buffmv[c.write_range[0] : c.write_range[1]]
            )
            if not bytes_written or c.write_range[1] < 536:
                # either we wrote no bytes, or we wrote < TCP MSS of bytes
                # so we're done with this connection
                self.close(sock)
            else:
                # more to write, so read the next portion of the data into
                # the memoryview for the next send event
                self.buff_advance(c, bytes_written)
    
    def buff_advance(self, c, bytes_written):
        """advance the writer buffer for this connection to next outgoing bytes"""

        if bytes_written == c.write_range[1] - c.write_range[0]:
            # wrote all the bytes we had buffered into the memoryview
            # set next write start on the memoryview to the beginning
            c.write_range[0] = 0
            # set next write end on the memoryview to length of bytes
            # read in from remainder of the body, up to TCP MSS
            c.write_range[1] = c.body.readinto(c.buff, 536)
        else:
            # didn't read in all the bytes that were in the memoryview
            # so just set next write start to where we ended the write
            c.write_range[0] += bytes_written
```

## Closing a client socket

There were a few cases above where we needed to close a client socket, either because we were done writing to it, or else done reading from it. Note that we never close the server socket (until we stop our program), since we want to be able to continue listening for incoming connection requests.

To cleanly close a client socket, we also need to unregister it from the poller, and delete any remaining request or connection data we had stored for it. Since we have very limited RAM on the ESP8266, we do this manually and then call the garbage collector to make sure we're conserving every single byte of RAM as early as possible to avoid memory errors.

```python
# captive_http.py
...
import gc
...
class HTTPServer(Server):
    ...
    def close(self, s):
        """close the socket, unregister from poller, and delete connection"""

        s.close()
        self.poller.unregister(s)
        sid = id(s)
        if sid in self.request:
            del self.request[sid]
        if sid in self.conns:
            del self.conns[sid]
        gc.collect()
```

# Adding the HTTP server to our CaptivePortal class

Now that we have the skeleton of the HTTP server set up, let's instantiate one in the `CaptivePortal` class and add it to the polling loop. We can test that we're actually reading in data correctly before we move on to actually correctly handling requests.

We previously wrote our `handle_dns()` method so that it returned False if it didn't handle the stream event, and True if it did. We'll make use of this here to make sure the HTTP server doesn't try to handle events that don't belong to it or one of its child client sockets.

```python {hl_lines=[4,11,"18-20", "31-33", "38-39"]}
# captive_portal.py
...
from captive_dns import DNSServer
from captive_http import HTTPServer

class CaptivePortal:
    ...
    def __init__(self, essid=None):
        ...
        self.dns_server = None
        self.http_server = None
        ...

    def captive_portal(self):
        print("Starting captive portal")
        self.start_access_point()

        if self.http_server is None:
            self.http_server = HTTPServer(self.poller, self.local_ip)
            print("Configured HTTP server")
        if self.dns_server is None:
            self.dns_server = DNSServer(self.poller, self.local_ip)
            print("Configured DNS server")

        try:
            while True:
                gc.collect()
                # check for socket events and handle them
                for response in self.poller.ipoll(1000):
                    sock, event, *others = response
                    is_handled = self.handle_dns(sock, event, others)
                    if not is_handled:
                        self.handle_http(sock, event, others)
        except KeyboardInterrupt:
            print("Captive portal stopped")
        self.cleanup()

    def handle_http(self, sock, event, others):
        self.http_server.handle(sock, event, others)
    
    ...
```

Time to test it out. Copy the code to the MCU and start it up by importing `main` from the REPL. Connect to the MCU's access point with your phone, and then open a browser and try to navigate to a **non-HTTPS** page.

```sh
Entering REPL. Use Control-X to exit.
>
MicroPython v1.12 on 2019-12-20; ESP module with ESP8266
Type "help()" for more information.
>>>
>>> import main
Trying to load WiFi credentials from ./wifi.creds
./wifi.creds does not exist
Starting captive portal
Waiting for access point to turn on
#37 ets_task(4020f510, 29, 3fff8f88, 10)
AP mode configured: ('192.168.4.1', '255.255.255.0', '192.168.4.1', '192.168.4.1')
HTTP Server listening on ('0.0.0.0', 80)
Configured HTTP server
DNS Server listening on ('0.0.0.0', 53)
Configured DNS server
Sending connectivitycheck.gstatic.com. -> 192.168.4.1
- Accepting new HTTP connection
- Reading incoming HTTP data
Client raw request:
 b'GET /generate_204 HTTP/1.1\r\nUser-Agent: Dalvik/2.1.0 (Linux; U; Android 6.0.1;
 Nexus 7 Build/MOB30X)\r\nHost: connectivitycheck.gstatic.com\r\nConnection:
 Keep-Alive\r\nAccept-Encoding: gzip\r\n\r\n'
- Sending outgoing HTTP data
Captive portal stopped
Cleaning up
DNS Server stopped
```

This looks good. We can see that the DNS server is redirecting all domains to the MCU's IP address, and then the HTTP server is accepting the connection and reading in the request data. This particular request is my Android device checking whether it has active internet or not. iOS devices do something similar, but with a different endpoint. If you wanted to trick the device into thinking it actually had an internet connection, all you'd need to do is respond to this request with a `204 No Content` response. If you're curious how this works, [this article](https://success.tanaza.com/s/article/How-Automatic-Detection-of-Captive-Portal-works) has some additional detail.

# Setting up routes and serving actual responses

So far, we're responding to all requests with a `404 Not Found` header and an empty body. Obviously we're going to need to send real responses to make this work, but we'll need a framework to decide which content to send.