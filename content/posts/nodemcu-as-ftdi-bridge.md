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

Two other benefits to this method (aside from lots of learning):
- The switch won't need to "phone home" to some random server controlled by some random company, passing along who-knows-what information, potentially including my home WiFi SSID and password.
- The switch should keep operating even if Sonoff ever decides to deprecate their app/servers.

The first step I need to figure out for this whole project (and the sole topic for this post) is how to actually talk to this device.