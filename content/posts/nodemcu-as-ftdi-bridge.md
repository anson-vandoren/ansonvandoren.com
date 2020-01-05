+++ 
draft = true
date = 2020-01-04T21:21:04-08:00
title = "Using a NodeMCU ESP8266 as a passthrough FTDI chip"
description = "Hacking a Sonoff Basic (v2) switch"
slug = "" 
tags = []
categories = []
externalLink = ""
series = []
+++

I recently purchased a few [Sonoff Basic R2](https://amzn.to/2MU73tm) smart switches for some lights in our house that don't have actual wall switches, but where I can access the wiring easily. These switches come pre-configured to use the Sonoff eWelink app which can link up with Google Home/Assistant, which seems ideal and relatively straightforward and easy. Of course, why would I take the easy way, when there's a perfectly good, more difficult path I could follow where I'd learn more stuff!

So instead what I'll be doing is replacing the Sonoff firmware on the switch with something custom, and writing my own code to control the switch. My idea is to get the switch talking over MQTT to a Raspberry Pi, which in turn will interface with Google Home.

A few other benefits to this method (aside from lots of learning):
- The switch won't need to "phone home" to some random server controlled by some random company, passing along who-knows-what information, potentially including my home WiFi SSID and password.
- The switch should keep operating even if Sonoff ever decides to deprecate their app/servers.
- I don't need _yet another_ smart-home app on my phone, and particularly not one that demands a lot of [unnecessary permissions](https://www.iot-tests.org/2018/06/sonoff-basic-wifi/#attachment_866)

The first step I need to figure out for this whole project (and the sole topic for this post) is how to actually talk to this device.

# Sonoff Basic R2 switch

Here's what the switch looks like out of the box:

![Sonoff Basic R2](/images/sonoff-basic-r2.jpg)

Pop off the top cover, and you can see that inside this is a pretty simple PCB with a 3.3VDC power supply, an ESP8266 chip, and a relay to switch the mains power:

![Sonoff Basic R2 insides](/images/sonoff-basic-r2-inside.jpg)

OK, so you can't actually see all that from this picture, but trust me, that's what's there. Or don't trust me and check one out for yourself.

In order to upload some new firmware to this thing, I'm going to need to access the serial interface of the ESP8266. Thankfully, Sonoff made this (sort of) easy by providing pinouts for the 4 pins we need. You can see them labeled on the backside of the PCB:

![Sonoff Basic R2 pinout](/images/sonoff-basic-r2-pinout.jpg)

The only slight problem is that there's no connector built into the board, but that's easily solved by soldering in a 4-pin (0.1 inch, standard breadboard spacing) connector. I didn't have a 4-pin connector handy, so I broke down an 8-pin that came with a previous Wemos D1 Mini development board:

![Modified 4-pin connector](/images/4-pin-connector.jpg)

![Prepping to solder connector](/images/sonoff-basic-r2-connector.jpg)

![Soldered connector backside](/images/sonoff-basic-r2-connector-soldered.jpg)

![Soldered connector backside](/images/sonoff-basic-r2-connector-soldered-front.jpg)