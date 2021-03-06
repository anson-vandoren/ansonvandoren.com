+++ 
draft = false
date = 2019-12-23T12:28:25-08:00
title = "Captive Web Portal for ESP8266 with MicroPython - Part 2"
description = "Easily authenticate to WiFi with home automation devices"
slug = "" 
tags = ["ESP8266", "MicroPython", "DNS", "home automation", "sockets"]
categories = []
externalLink = ""
series = []
+++

In [Part 1](https://ansonvandoren.com/posts/esp8266-captive-web-portal-part-1) of this series, I had set up the beginnings of a "captive portal" DNS server. The intent of this server is to redirect all DNS requests to point to the IP address of the Wemos D1 Mini MCU that's running the WiFi access point. See the intro to that post for why I want to do this.

I'd progressed to the point where I had a working socket that could display the raw datagram coming in over port 53 for DNS queries when I connected my phone to the MCU's AP. Now I need to understand how to interpret those requests, and how to construct a DNS answer I can send back to the client that will redirect them to the IP address I want.

# Understanding DNS requests

I don't want to go into excruciating detail here about how DNS messages are constructed, but it is pretty important to understand in order to make this work. I relied pretty heavily on a great article by [James Routley](https://github.com/jamesroutley) that you [can find here](https://routley.io/posts/hand-writing-dns-messages/). I'd suggest reading it for the details, and then come back to see how I implemented it for my captive portal. The [Wikipedia article](https://en.wikipedia.org/wiki/Domain_Name_System#DNS_message_format) also has some good amplifying information that was pretty useful. If you just can't get enough of DNS nitty-gritty, you could also try reading [RFC 2929](https://tools.ietf.org/html/rfc2929) which is the internet standard for DNS messages.

# DNS request example

Here's an example of the request my DNS server logged as incoming from my phone when it first connected:

`b'\x99\xa5\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x03ssl\x07gstatic\x03com\x00\x00\x01\x00\x01'`

Python is showing me the message in byte format (`b''`), which converts to ASCII where it can, and displays the raw hexadecimal value of each byte where it can't.

## Request Header

The message header is 12 bytes long; in this example the header is:

`\x99\xa5\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00`

- The first two bytes are the request ID generated by the client. As the server, I don't really care what this ID is, except that I need to remember it and include it in the response back to the client.
  - In this example, the ID is `\x99\xa5`
- The second two bytes (16 bits) are the Flags section:
  - In this example, the Flags are `\x01\x00`, or in binary `0000000100000000`
  - See Wikipedia article linked above for a full explanation of what each bit means.
  - In this case, the binary representation of these two bytes (in [big-endian](https://en.wikipedia.org/wiki/Endianness) ("network byte") format) means all header flags are set to 0 except for the `RD` bit, or "Recursion Desired".
  - Cloudflare has a [good article](https://www.cloudflare.com/learning/dns/what-is-recursive-dns/) explaining recursive vs. iterative DNS requests if you're interested. For our part, we don't really care about this since we're only redirecting all DNS requests to our captive portal anyway.
- The rest of the header (`\x00\x01\x00\x00\x00\x00\x00\x00`) gives the number of questions, answers, authority records, and additional records in the message. I'll ignore them for my purposes, and assume the client is only sending one question (which is true in this case).

## Request Question

The question section has a variable length for the first part (`QNAME`) and a fixed two bytes for each of the remaining two parts (`QTYPE` and `QCLASS`). All I really care about for this project is the `QNAME`, which is the domain the client wants an IP address for, as I'll need that to construct the answer response. This section contains one or more "labels" where the first byte tells how many bytes the full label is, and the rest of the label is part of the domain being queried.

In this example:
- First byte tells how long the upcoming label is (`\x03` for the first label)
- The next 3 bytes (`ssl` for the first label) is the label name. Since these bytes are valid ASCII characters, Python has converted it for me automatically.
- After each label in this section, there is an implicit `.`, which I'll need to add.
- Repeat until label length is `\x00`, which marks end of the QNAME section

This `QNAME` fully resolves to `ssl.gstatic.com`, after which there is a zero-byte (`\x00`) telling me the `QNAME` section is done.

- The next byte pair is `QTYPE`, which in this case is `\x00\x01` for an A record. [This Wikipedia article](https://en.wikipedia.org/wiki/List_of_DNS_record_types) lists other possible options for record types.
- The final byte pair is `QCLASS`, which in this case is `\x00\x01` for internet (IN).

# Parsing a DNS question

Let's create a new class in our `captive_dns.py` file to handle DNS queries:

```python
# captive_dns.py
...
class DNSQuery:
    def __init__(self, data):
        self.data = data
        self.domain = ""
        # header is bytes 0-11, so question starts on byte 12
        head = 12
        # length of this label defined in first byte
        length = data[head]
        while length != 0:
            label = head + 1
            # add the label to the requested domain and insert a dot after
            self.domain += data[label : label + length].decode("utf-8") + "."
            # check if there is another label after this one
            head += length + 1
            length = data[head]
...
```

When we create a new `DNSQuery`, we'll pass in the raw datagram we got from the socket and store it. What we really are trying to get at to start with is the requested domain, so we don't need to parse the header information yet (although we will need to for the response).

To get the domain out of the message, we start on byte 12, read the length of that label, and then read that many bytes into the domain, appending a `.` to each label. When we get to a length-byte of 0, we know we have the full requested domain.

Now let's update our `DNSServer` class to parse the incoming requests:

```python {hl_lines=["13-18"]}
# captive_dns.py
...
class DNSServer(Server):
    ...
    def handle(self, sock, event, others):
        # server doesn't spawn other sockets, so only respond to its own socket
        if sock is not self.sock:
            return

        # check the DNS question, and respond with an answer
        try:
            data, sender = sock.recvfrom(1024)
            request = DNSQuery(data)
            print("Client requested IP address for domain:", request.domain)
            
            # help MicroPython with memory management
            del request
            gc.collect()
        except Exception as e:
            print("DNS server exception:", e)
```

If I run this now, and reconnect my phone to the MCU access point, I'll see something like this with the resolved domain name questions:
```sh {hl_lines=["17-19","29-31"]}
MicroPython v1.12 on 2019-12-20; ESP module with ESP8266
Type "help()" for more information.
>>>
>>> import main
Trying to load WiFi credentials from ./wifi.creds
./wifi.creds does not exist
Starting captive portal
Waiting for access point to turn on
#57 ets_task(4020f510, 29, 3fff8f88, 10)
AP mode configured: ('192.168.4.1', '255.255.255.0', '192.168.4.1', '192.168.4.1')
DNS Server listening on ('0.0.0.0', 53)
Configured DNS server
Client requested IP address for domain: connectivitycheck.gstatic.com.
Client requested IP address for domain: encrypted-tbn0.gstatic.com.
Client requested IP address for domain: www.google.com.
Client requested IP address for domain: android.googleapis.com.
Client requested IP address for domain: zowkbggnyjedl.
Client requested IP address for domain: uxfwdospee.
Client requested IP address for domain: dwcccklrboesuuf.
Client requested IP address for domain: encrypted-tbn0.gstatic.com.
Client requested IP address for domain: www.google.com.
Client requested IP address for domain: update.googleapis.com.
Client requested IP address for domain: inbox.google.com.
Client requested IP address for domain: encrypted-tbn0.gstatic.com.
Client requested IP address for domain: www.google.com.
Client requested IP address for domain: connectivitycheck.gstatic.com.
Client requested IP address for domain: android.googleapis.com.
Client requested IP address for domain: mtalk.google.com.
Client requested IP address for domain: zowkbggnyjedl.
Client requested IP address for domain: uxfwdospee.
Client requested IP address for domain: dwcccklrboesuuf.
```

Notice groups of 3 "garbage" domain requests interspersed between the legitimate ones. It took me quite a while to figure out some google terms that would lead me to an answer as to what those were (winning answer was "gobbledygook dns queries"), but it turns out those are Chrome trying to prevent DNS hijacking by an ISP. There's a pretty good [StackExchange answer](https://unix.stackexchange.com/a/363513/197269) if you're curious for more details. In our case it is pretty irrelevant since we aren't trying to actually correct DNS results, and we don't care that Chrome/Chromium knows about it.

# Understanding DNS responses

Now that we know what domain the client is asking for, it's time to generate a response. Since the point of the captive portal is to redirect all DNS requests back to the MCU's IP address, we don't care about what the correct answer is. This makes it a lot simpler to finish out this section of the project.

If you need to, refer back to the links at the beginning of the post to see the details about the response format, since I'll just gloss over it here. The response contains all the same sections as the request (Header, Question), but it will also contain an Answer section that we'll need to construct here. The Question will be identical, but we'll also need to modify the Header section a bit.

## Response Header

Again, we're not trying to construct a necessarily correct response, just a valid one so the client can process it. What we need in the header section is:

- Set first two bytes to the ID that came with the request, so the client knows which request this response belongs to.
- Cheat a little, and set the flags section without actual regard for request. For every answer, we'll set the flags to `\x81\x80`, which translates to `1000000110000000` in binary and means:
  - `QR`=1 (this is a response, not a query)
  - `Opcode`=0 (this is a response to a standard query)
  - `TC`=0 (this response is not truncated)
  - `RD`=1 (makes assumption client also set this bit on for a recursive lookup, which is normal)
  - `RA`=1 (telling client recursive lookup is available)
- Copy the question count from request and set answer count to the same
- Set authority records and additional records to 0

## Response Question and Answer

The body of our response will repeat back the question that was asked and then add an answer on the end. We already have the question stored in our DNSQuery class (raw data starting on byte 12 and going to the end), so we can copy that over easily.

To construct the answer, we need a few parts:
- A pointer back to the requested domain name. This pointer is two bytes long, with the first two bits being 1s, and the remaining 14 bits being an unsigned integer that specifies the number of bytes from the beginning of the message where the prior occurrence of the name can be found. In our case, that's byte 12.
- The next two byte pairs are `TYPE` and `CLASS` (similar to `QTYPE` and `QCLASS` in the question section). We'll set these for an A record and IN class, regardless of the question, since that's all our simple server knows how to handle (and also by far the most common request we'll get).
- The next byte pair is TTL in seconds, as a 32-bit number. This tells the client how long this response is valid for, and I chose 60sec, or `\x00\x00\x00\x3C`.
- Then comes the length (in bytes) of the response body. Since I'm returning an IPv4 address, this fits into 4 bytes, so I used `\x00\x04`.
- Finally, I break down the IP address into 4 bytes and send them as the final bytes in the packet.

Using the example from the request section above, here's what my response looks like, broken down:

Header: `\x99\xa5\x81\x80\x00\x01\x00\x01\x00\x00\x00\x00`

Question: `\x03ssl\x07gstatic\x03com\x00`

Answer: `\x00\x01\x00\x01\xc0\x0c\x00\x01\x00\x01\x00<\x00\x04\xc0\xa8\x04\x01`

>Note the odd-looking behavior in our TTL octets: we actually sent `\x00\x00\x00\x3C`, but when printed to the screen it shows as `\x00\x00\x00<` instead. This is because Python automatically tries to convert ASCII characters it knows about into the ASCII equivalent. `\x3c` is decimal 60, which is ASCII `<` character. This is perfectly normal, and the response is still correct in terms of bytes; it took me a while to figure out that this is just a Python internal representation when I was looking at the output of my program here.

# Creating a DNS response

Now that we know the format of a response, let's update our `DNSQuery` class to generate one when asked:

```python {hl_lines=["5-32"]}
# captive_dns.py
...
class DNSQuery:
    ...
    def answer(self, ip_addr):
        # ** create the answer header **
        # copy the ID from incoming request
        packet = self.data[:2]
        # set response flags (assume RD=1 from request)
        packet += b"\x81\x80"
        # copy over QDCOUNT and set ANCOUNT equal
        packet += self.data[4:6] + self.data[4:6]
        # set NSCOUNT and ARCOUNT to 0
        packet += b"\x00\x00\x00\x00"

        # ** create the answer body **
        # respond with original domain name question
        packet += self.data[12:]
        # pointer back to domain name (at byte 12)
        packet += b"\xC0\x0C"
        # set TYPE and CLASS (A record and IN class)
        packet += b"\x00\x01\x00\x01"
        # set TTL to 60sec
        packet += b"\x00\x00\x00\x3C"
        # set response length to 4 bytes (to hold one IPv4 address)
        packet += b"\x00\x04"
        # now actually send the IP address as 4 bytes (without the "."s)
        packet += bytes(map(int, ip_addr.split(".")))

        gc.collect()

        return packet
...
```

Here, I'm passing in an IP address (the MCU's address in this case), and getting back a (hopefully) valid DNS answer pointing all domains to that IP.

With that in place, it's trivial to have the DNS server send back the answer to each question. Make the following addition to the `DNSServer` class:

```python {hl_lines=[14,15]}
# captive_dns.py
class DNSServer(Server):
    ...
    def handle(self, sock, event, others):
        # server doesn't spawn other sockets, so only respond to its own socket
        if sock is not self.sock:
            return

        # check the DNS question, and respond with an answer
        try:
            data, sender = sock.recvfrom(1024)
            request = DNSQuery(data)

            print("Sending {:s} -> {:s}".format(request.domain, self.ip_addr))
            sock.sendto(request.answer(self.ip_addr), sender)

            # help MicroPython with memory managament
            del request
            gc.collect()
        except Exception as e:
            print("DNS server exception:", e)
```

Fire it up and test everything out:
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
#73 ets_task(4020f510, 29, 3fff8f88, 10)
AP mode configured: ('192.168.4.1', '255.255.255.0', '192.168.4.1', '192.168.4.1')
DNS Server listening on ('0.0.0.0', 53)
Configured DNS server
Sending connectivitycheck.gstatic.com. -> 192.168.4.1
Sending connectivitycheck.gstatic.com. -> 192.168.4.1
Sending mtalk.google.com. -> 192.168.4.1
Sending alt5-mtalk.google.com. -> 192.168.4.1
Sending android.googleapis.com. -> 192.168.4.1
```

The output looks like things are working, but we don't have a real way to test right now. Next up, we'll write a HTTP server to see that the client is actually getting redirected where we want.

# Recap

We can now parse a DNS request to figure out what domain name the client is asking about, and then create a (fake) response that will direct them to the D1 Mini's IP address. In the next section, we'll create a HTTP server on the MCU to make use of the HTTP requests that are currently being routed there by our DNS server.

-----------------

Next: [Captive Web Portal for ESP8266 with MicroPython - Part 3](https://ansonvandoren.com/posts/esp8266-captive-web-portal-part-3/)

Code: [GitHub project repo](https://github.com/anson-vandoren/esp8266-captive-portal)

Found a problem with this post? Submit a PR to fix it here: [GitHub website repo](https://github.com/anson-vandoren/ansonvandoren.com/blob/master/content/posts/esp8266-captive-web-portal-part-2.md)


