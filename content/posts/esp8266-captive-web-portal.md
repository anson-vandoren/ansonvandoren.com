+++ 
draft = true
date = 2019-12-21T17:11:02-08:00
title = "Captive Web Portal for ESP8266 with MicroPython"
description = "Easily authenticate to WiFi with home automation devices"
slug = "" 
tags = ["ESP8266", "MicroPython", "DNS"]
categories = []
externalLink = ""
series = []
+++

## Set up tooling

```sh
$ pip install esptool rshell
```

## Update to latest MicroPython (reflash)

```sh
$ esptool.py --port /dev/cu.SLAB_USBtoUART erase_flash
esptool.py v2.8
Serial port /dev/cu.SLAB_USBtoUART
Connecting........_
Detecting chip type... ESP8266
Chip is ESP8266EX
Features: WiFi
Crystal is 26MHz
MAC: a4:cf:12:bc:34:d2
Uploading stub...
Running stub...
Stub running...
Erasing flash (this may take a while)...
Chip erase completed successfully in 2.3s
Hard resetting via RTS pin...
```

```sh
$ esptool.py --baud 460800 --port /dev/cu.SLAB_USBtoUART write_flash 0 esp8266-20191220-v1.12.bin
esptool.py v2.8
Serial port /dev/cu.SLAB_USBtoUART
Connecting........_
Detecting chip type... ESP8266
Chip is ESP8266EX
Features: WiFi
Crystal is 26MHz
MAC: a4:cf:12:bc:34:d2
Uploading stub...
Running stub...
Stub running...
Changing baud rate to 460800
Changed.
Configuring flash size...
Auto-detected Flash size: 4MB
Flash params set to 0x0040
Compressed 619828 bytes to 404070...
Wrote 619828 bytes (404070 compressed) at 0x00000000 in 9.3 seconds (effective 534.0 kbit/s)...
Hash of data verified.

Leaving...
Hard resetting via RTS pin...
```

## MicroPython filestructure, REPL, rshell

To make things easier to develop on actual machine, I created a simple syncing script

```sh
#!/bin/sh
rshell --port /dev/cu.SLAB_USBtoUART cp main.py /pyboard/
rshell --port /dev/cu.SLAB_USBtoUART repl
```

## Set up WLAN configuration (STA/AP)

```python
# /pyboard/main.py
import network

LOCAL_IP = "192.168.4.1"

def configure_wan():
    # turn off Station Mode
    network.WLAN(network.STA_IF).active(False)
    
    # turn on and configure Access Point Mode
    ap_if = network.WLAN(network.AP_IF)
    # IP address, netmask, gateway, DNS
    
    ap_if.ifconfig((LOCAL_IP, "255.255.255.0", LOCAL_IP, LOCAL_IP))
    ap_if.active(True)
  
configure_wan()
```

## The DNS Server class

- Open a socket connection

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
- Ignore the rest of the headers

- https://amriunix.com/post/deep-dive-into-dns-messages/
- https://en.wikipedia.org/wiki/Domain_Name_System#DNS_message_format
- https://routley.io/posts/hand-writing-dns-messages/


## Creating a DNS response

- Set first two octets to the ID (copied from request)
- Cheat a little and set Flags section without actual regard for request. `\x81\x80` translates to:
  - `1000000110000000`
  - QR=1 (response)
  - RD=1 (makes assumption client also set this bit on)
  - RA=1 (telling client recursive lookup is available)