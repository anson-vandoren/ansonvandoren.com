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

So far, the `CaptivePortal` class creates the DNS Server and registers its socket with a poller that listens for data on the socket stream. This was fairly straightforward since UDP (which DNS uses) is connectionless, and I didn't need to keep track of whether a connection was fully closed or not. I'll do something similar for the HTTP server, but will need to keep track of which connections are incoming and outgoing, and which are closed. This makes things a little more complicated, but I'll start with my base server superclass, and proceed bit-by-bit from there. Create a new file called `captive_http.py` and add the code below:

```python
# captive_http.py
import usocket as socket

from collections import namedtuple

WriteConn = namedtuple("WriteConn", ["body", "buff", "buffmv", "write_range"])

from server import Server

class HTTPServer(Server):
    def __init__(self, poller, local_ip):
        super().__init__(poller, 80, socket.SOCK_STREAM, "HTTP Server")
        if type(local_ip) is bytes:
            self.local_ip = local_ip
        else:
            self.local_ip = local_ip.encode()
        self.routes = dict()
        self.request = dict()
        self.conns = dict()

        self.sock.listen(1)
        self.sock.setblocking(False)
    
    def handle(self, sock, event, others):
        if sock is self.sock:
            # client connecting on port 80, so spawn off a new
            # socket to handle this connection
            print("- Accepting new HTTP connection")
            self.accept(sock)
        elif event & select.POLLOUT:
            # existing connection has space to send more data
            print("- Sending outgoing HTTP data")
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
        elif event & select.POLLIN:
            # socket has data to read in
            print("- Reading incoming HTTP data")
            self.read(sock)

    def accept(self, s):
        """accept a new client request socket and register it for polling"""

        try:
            sock, addr = s.accept()
        except OSError as e:
            if e.args[0] == uerrno.EAGAIN:
                print("failed to accept a new socket:", s)
                return

        sock.setblocking(False)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.poller.register(sock, select.POLLIN)

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
        
        print("Client raw request:", req)
        
        # send a 404 response for now
        headers = b"HTTP/1.1 404 Not Found\r\n"
        body = uio.BytesIO(b"")
        self.prepare_write(s, body, headers) 

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








- https://success.tanaza.com/s/article/How-Automatic-Detection-of-Captive-Portal-works