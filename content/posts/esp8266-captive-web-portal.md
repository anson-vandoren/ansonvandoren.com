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

## Update to latest MicroPython (reflash)

## MicroPython filestructure, REPL, rshell

## Set up WLAN configuration (STA/AP)

```python
# /pyboard/main.py
import network

LOCAL_IP = "192.168.4.1"

def configureWan():
    # turn off Station Mode
    network.WLAN(network.STA_IF).active(False)
    
    # turn on and configure Access Point Mode
    ap_if = network.WLAN(network.AP_IF)
    # IP address, netmask, gateway, DNS
    
    ap_if.ifconfig((LOCAL_IP, "255.255.255.0", LOCAL_IP, LOCAL_IP))
    ap_if.active(True)
```

## The DNS Server class

- Open a socket connection