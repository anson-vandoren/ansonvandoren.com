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

# Project idea

I've worked on a few small projects recently using an ESP8266 chip, and one thing that sort of bothered me is that I needed to hard-code my home WiFI access point SSID and password into either the Python file or a separate config file. It's not really that big of a deal for small personal projects, but when I buy "smart" gadgets from anywhere else, they always come with the option to set up the device by connecting to a temporary WiFi access point on the device itself.

This aim of this project is to program the ESP8266 MCU to:
- On startup, first check if it knows how to log into my home WiFi.
- If it doesn't have any known credentials, or the previously saved credentials don't work, then start an unsecured WiFi access point on bootup instead.
- With my phone, connect to the MCU WiFi AP, and then enter the SSID and password for my actual home WiFI.
- The MCU then tries to connect to my home WiFi using the newly provided credentials, and display a basic status page showing what network it connected to, and what is its IP address on my home network.

This idea isn't really new, and it's referred to as a "captive portal" in other contexts. It's something you may have seen when logging into public WiFi at your favorite coffee shop, where you're redirected to a sign-in page before being allowed online. There's a few different ways to accomplish that, but the way I'm going to do it will require a HTTP server (to serve some HTML to ask for WiFi SSID and password), and also a DNS server to redirect all DNS questions to the IP address of the MCU so that I don't need to know the board's IP address. I'll be able to just connect to the board's access point, and then navigate to any (non-HTTPS) website, and it will redirect me to the login page I want.

The non-HTTPS part is important; for the sake of simplicity, the HTTP server is only listening on port 80, and not 443. HTTPS requests will still get redirected to the board, but there isn't a HTTPS socket listening for them there, so they'll time out. I may add this capability eventually, but it's a little complicated to get set up and probably not worth the effort. For my Android phone (and I think for iOS devices as well), the OS detects that it doesn't have internet access and will automatically ask me to sign in anyway, which goes over HTTP and does the redirection I need.

# Basic hardware setup

I wrote a previous article on setting up a NodeMCU ESP8266 with MicroPython a few months ago, so instead of repeating all the instructions here you can check out that article instead. I'll assume that you can already `rshell` into your MCU for the rest of this post.

The only difference from last time is that I'm using a different board this time, a [Wemos D1 Mini](https://amzn.to/2t5AvWi) I ordered from Amazon. It has the same ESP8266 chipset and mostly the same features, but fewer GPIO pins than the other one. The price is about the same either way, but I was looking for a smaller form factor for my next project, and this is about half the size of the [NodeMCU development board](https://amzn.to/2J9CRrJ).

The one additional step I did need to get the D1 Mini to work was to install an additional driver. All of my search results for this ended up with kind of sketchy-looking websites, but I think the "official" version from the board manufacturer is [here](http://www.wch.cn/download/CH341SER_MAC_ZIP.html). There are also links to drivers for Windows and Linux on the same page. Use at your own risk, but at least I can say the drivers from there worked for me on macOS 10.13.6 (High Sierra).

Aside from this, everything was basically the same except that the Wemos D1 Mini shows up on a different serial port, in my case `/dev/cu.wchusbserial1430`. As a reminder, you can check this yourself using the esptool.py tool [from Espressif](https://github.com/espressif/esptool):

```sh
$ esptool.py read_mac
esptool.py v2.8
Found 3 serial ports
Serial port /dev/cu.wchusbserial1430
Connecting....
Detecting chip type... ESP8266
Chip is ESP8266EX
Features: WiFi
Crystal is 26MHz
MAC: 2c:f4:32:78:d0:c1
Uploading stub...
Running stub...
Stub running...
MAC: 2c:f4:32:78:d0:c1
Hard resetting via RTS pin...
```

# ESP8266 filesystem

Connecting to the board with `rshell` after initially flashing the latest MicroPython binary [from here](https://micropython.org/download#esp8266) (I used v1.12) shows a single file (boot.py) in the `/pyboard` folder.

I didn't touch the boot.py file, and mine looked like this:

```python
# /pyboard/boot.py
# This file is executed on every boot (including wake-boot from deepsleep)
#import esp
#esp.osdebug(None)
import uos, machine
#uos.dupterm(None, 1) # disable REPL on UART(0)
import gc
#import webrepl
#webrepl.start()
gc.collect()
```

The boot.py file is the first file run each time the board resets. It's not doing much in my case other than a garbage collection, but I'll leave it as is.

The other file that''s run on each boot is called main.py, but it doesn't exist yet. Since this project is intended to just be the bootstrap code for a new device, I don't want to clutter up main.py with the captive portal code. I'll write most of this code in separate files, and just import and call it from a couple of lines in main.py.

One other important fact I learned on this project is that since MicroPython needs to import and "compile" (into frozen bytecode) each file in one chunk, raw Python file sizes need to be limited to what's available in RAM on the MCU, minus what the interpreter is using up. In practice, I found this meant that I couldn't import a source file much larger than ~8Kb, and when importing multiple files, I needed to run garbage collection between the imports. If you get (cryptic, seemingly incomplete) errors like the example below, it may mean your file size is too large, and you should break it up into multiple files:

```sh
>>> import captive_http
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
MemoryError:

>>>
```

# Getting started

It's possible to use `rshell` to edit files directly (sort of) on the MCU, but I prefer to edit from my host machine and then copy the files in from there during testing. This way I keep the latest updates inside my git repo on my desktop and never need to worry about which is the latest version. My workflow looks something like this:

- Edit files (e.g., main.py) on my host PC
- `rshell` to MCU, then `cp main.py /pyboard/`
- On MCU, `repl`, then `import main`

To start this project off, I'm going to create two files:
- main.py, which will kick off the code I want to run and otherwise be available for future project code
- captive_portal.py, which will coordinate the HTTP and DNS servers to make this WiFi bootstrapping code work

```python
# main.py
from captive_portal import CaptivePortal

portal = CaptivePortal()

portal.start()
```

```python
# captive_portal.py
import network
import uerrno
import uos as os
import utime as time

class CaptivePortal:
    CRED_FILE = "./wifi.creds"
    MAX_CONN_ATTEMPTS = 10
    
    def __init__(self):
        self.sta_if = network.WLAN(network.STA_IF)
        
        self.ssid = None
        self.password = None
    
    def connect_to_wifi(self):
        print(
            "Trying to connect to SSID '{:s}' with password {:s}".format(
                self.ssid, self.password
            )
        )
        # initiate the connection
        self.sta_if.active(True)
        self.sta_if.connect(self.ssid, self.password)
        
        attempts = 0
        while attempts < self.MAX_CONN_ATTEMPTS:
            if not self.sta_if.isconnected():
                print("Connection in progress")
                time.sleep(2)
                attempts += 1
            else:
                print("Connected to {:s}".format(self.ssid))
                self.local_ip = self.sta_if.ifconfig()[0]
                self.write_creds(self.ssid, self.password)
                return True
        
        print("Failed to connect to {:s} with {:s}. WLAN status={:d}".format(
            self.ssid, self.password, self.sta_if.status()
        ))
        # forget the credentials since they didn't work, and turn off station mode
        self.ssid = self.password = None
        self.sta_if.active(False)
        return False
    
    def captive_portal(self):
        print("Starting captive portal")
    
    def try_connect_from_file(self):
        print("Trying to load WiFi credentials from {:s}".format(self.CRED_FILE))
        try:
            os.stat(self.CRED_FILE)
        except OSError as e:
            if e.args[0] == uerrno.ENOENT:
                print("{:s} does not exist".format(self.CRED_FILE))
                return False
        
        contents = open(self.CRED_FILE, 'rb').read().split(b',')
        if len(contents) == 2:
            self.ssid, self.password = contents
        else:
            print("Invalid credentials file:", contents)
            return False
        
        if not self.connect_to_wifi():
            print("Failed to connect with stored credentials, starting captive portal")
            os.remove(self.CRED_FILE)
            return False
        
        return True

    def start(self):
        # turn off station interface to force a reconnect
        self.sta_if.active(False)
        if not self.try_connect_from_file():
            self.captive_portal()
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

## The generic Server class
- SO_REUSEADDR flag: https://stackoverflow.com/questions/14388706/how-do-so-reuseaddr-and-so-reuseport-differ



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

`b'\x99\xa5\x81\x80\x00\x01\x00\x01\x00\x00\x00\x00\x03ssl\x07gstatic\x03com\x00\x00\x01\x00\x01\xc0\x0c\x00\x01\x00\x01\x00<\x00\x04\xc0\xa8\x04\x01'
`

>Note the odd-looking behavior in our TTL octets: we actually sent `\x00\x00\x00\x3C`, but when printed to the screen it shows as `\x00\x00\x00<` instead. This is because Python automatically tries to convert ASCII characters it knows about into the ASCII equivalent. `\x3c` is decimal 60, which is ASCII `<` character. This is perfectly normal, and the response is still correct in terms of bytes; it took me a while to figure out that this is just a Python internal representation when I was looking at the output of my program here.

OK, so now we've got a DNS server that points all connectivity requests to our devices IP address. Next, we need to set up a web server to help the user connect our device to the real WiFi connection we want

### List of captive portal requests:

- https://success.tanaza.com/s/article/How-Automatic-Detection-of-Captive-Portal-works

