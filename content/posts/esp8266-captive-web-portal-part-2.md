+++ 
draft = true
date = 2019-12-28T12:28:25-08:00
title = ""
description = ""
slug = "" 
tags = []
categories = []
externalLink = ""
series = []
+++


## Understanding DNS requests

Example:
`b'\x99\xa5\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x03ssl\x07gstatic\x03com\x00\x00\x01\x00\x01'`

- First 16 bits (2 octets) are the request ID and is (pseudo)random
  - `\x99\xa5` in this case
- Second 16 bits is the Flags section
  - `\x01\x00` in this case, or in binary `0000000100000000`
  - See Wikipedia link below for what these 16 bits mean
  - In this case, the binary representation if these two octets (big-endian) means all header flags are set to 0 except for the `RD` bit, or "Recursion Desired".
  - Cloudflare has a [good article](https://www.cloudflare.com/learning/dns/what-is-recursive-dns/) explaining recursive vs. iterative DNS requests if you're interested. For our part, we don't really care about this since we're only redirecting all DNS requests to our captive portal anyway.
  - Ignore the rest of the headers, and assume only one question (which is true in this case)
    - `\x00\x01\x00\x00\x00\x00\x00\x00`
- Next is the Question section:
  - First byte tells how long the upcoming label is (`\x03` for the first label)
  - The next 3 bytes (`ssl` for the first label) is the label name. Each label should be suffixed with a `.`
  - Repeat until label length is `\x00`, which marks end of the QNAME section
  - The next octet pair is QTYPE, which in this case is `\x00\x01` for an A record. [This Wikipedia article](https://en.wikipedia.org/wiki/List_of_DNS_record_types) lists other possible options for record types.
  - The final octet pair is QCLASS, which in this case is `\x00\x01` for internet (IN)

- https://amriunix.com/post/deep-dive-into-dns-messages/
- https://en.wikipedia.org/wiki/Domain_Name_System#DNS_message_format
- https://routley.io/posts/hand-writing-dns-messages/
- https://tools.ietf.org/html/rfc2929


## Creating a DNS response

- Set first two octets to the ID (copied from request)
- Cheat a little and set Flags section without actual regard for request. `\x81\x80` translates to:
  - `1000000110000000`
  - QR=1 (response)
  - RD=1 (makes assumption client also set this bit on)
  - RA=1 (telling client recursive lookup is available)
- Copy the question count from request and set answer count to the same
- Set authority records and additional records to 0

That takes care of the headers, so now just need to construct the body of the response. 
- The first part of the response is just the received question
- Next comes a pointer back to the requested domain name
  - The first two bits are always 1s, and the remaining 14 are an unsigned integer that specifies the number of bytes from the beginning of the message where the prior occurrence of the name can be found. In our case, that's byte 12.
- The next two octet pairs are TYPE and CLASS (similar to QTYPE and QCLASS in the question)
- Next pair is TTL in seconds, as a 32-bit number. I chose 60sec, or `\x00\x00\x00\x3C`
- Then comes the length (in bytes) of the response body. Since I'm returning an IPv4 address, this fits into 4 bytes, so I used `\x00\x04`
- Finally, I break down the IP address into 4 bytes and send them as the final bytes in the packet.

Here's what my response looks like:

`b'\x99\xa5\x81\x80\x00\x01\x00\x01\x00\x00
\x00\x00\x03ssl\x07gstatic\x03com\x00\x00\x01\x00\x01\xc0\x0c\x00\x01\x00\x01\x00<\x00\x04\xc0\xa8\x04\x01'
`

>Note the odd-looking behavior in our TTL octets: we actually sent `\x00\x00\x00\x3C`, but when printed to the screen it shows as `\x00\x00\x00<` instead. This is because Python automatically tries to convert ASCII characters it knows about into the ASCII equivalent. `\x3c` is decimal 60, which is ASCII `<` character. This is perfectly normal, and the response is still correct in terms of bytes; it took me a while to figure out that this is just a Python internal representation when I was looking at the output of my program here.

OK, so now we've got a DNS server that points all connectivity requests to our devices IP address. Next, we need to set up a web server to help the user connect our device to the real WiFi connection we want

### List of captive portal requests:

- https://success.tanaza.com/s/article/How-Automatic-Detection-of-Captive-Portal-works

