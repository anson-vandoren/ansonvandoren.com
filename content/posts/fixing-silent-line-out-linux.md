+++ 
draft = true
date = 2026-05-21T08:00:00-07:00
title = "Fixing Silent 'Line Out' and Simultaneous Audio on Realtek ALC1220 in Linux"
description = "Troubleshooting hardware mixer elements and PipeWire profiles to fix audio routing."
slug = "" 
tags = ["linux", "audio", "pipewire", "alsa", "troubleshooting"]
categories = []
externalLink = ""
series = []
+++

I recently ran into one of those incredibly niche Linux desktop issues that will probably only interest maybe 3 people... but as usual, one of those people is likely to be future-me when I inevitably reinstall my system and forget how I fixed it.

I spend quite a bit of time at my desk, and my hardware setup is fairly standard. I've got a Gigabyte motherboard with an AMD Ryzen HD Audio Controller (which uses the Realtek ALC1220 codec). I keep my speakers plugged into the Line Out jack on the back, and a pair of headphones plugged into the front. I rely on the volume applet in my desktop environment to seamlessly switch between the two outputs via software.

Everything was working flawlessly until a routine software update about a week ago. Suddenly, switching to the "Line Out" profile gave me absolutely nothing. Total silence. The weirdest part? The desktop audio UI still happily reported the speakers as "plugged in" and available.

### The Discovery Trail

Like any good Linux audio troubleshooting session, I started by looking under the hood at ALSA, the underlying hardware sound architecture, since PipeWire (my audio server) sits on top of it. 

I fired up the terminal and ran `amixer` to see what the hardware was actually doing:

```bash
$ amixer -c 1 contents | grep -A 3 "Line Out Playback"
numid=2,iface=MIXER,name='Line Out Playback Switch'
  ; type=BOOLEAN,access=rw------,values=2
  : values=off,off
```

Surprise, surprise. The hardware switch for `Line Out` was completely disabled (`off`), and the volume was bottomed out, even though PipeWire thought it was happily pumping audio to it. The software state was somehow out of sync with the actual hardware state.

I manually unmuted it:

```bash
$ amixer -c 1 sset 'Line Out' unmute && amixer -c 1 sset 'Line Out' 80%
```

Great! I had sound again. But my victory was short-lived. When I used the UI to switch *back* to my headphones, the audio started playing out of **both** the headphones and the speakers at the same time. 

### The Auto-Mute Conundrum

At this point, you might be thinking, "Hey, doesn't ALSA have an Auto-Mute feature?" Yes, it does. `Auto-Mute Mode` is a hardware-level circuit that physically cuts the signal to the Line Out jack the moment it detects something plugged into the headphone jack.

But here's the catch: if you leave `Auto-Mute Mode` Enabled, the hardware forces the speakers off permanently as long as the headphones remain plugged in. That means you can *never* switch to your speakers in software without physically pulling the headphone plug out of the case. Since I want to toggle outputs purely via software, `Auto-Mute Mode` *must* remain Disabled. 

The software (PipeWire) is supposed to be smart enough to take over and manually mute the inactive port. So why wasn't it?

### The Root Cause

After digging through the ALSA card profile paths in `/usr/share/alsa-card-profile/mixer/paths/`, I finally found the culprit. 

Standard Linux audio profiles tell the system how to handle different output paths. When you select headphones, the `analog-output-headphones.conf` file tells the system to explicitly mute elements named "Speaker", "Front", "Surround", etc. 

However, my specific Realtek ALC1220 implementation names its hardware switch exactly what it physically is: `Line Out`. The standard Linux profile didn't have an `[Element Line Out]` definition, so it literally didn't know it was supposed to toggle it off when I switched to headphones, or back on when I switched to speakers. A recent package update likely overwrote or shifted how these profiles apply to my specific hardware.

### The Solution

The fix involves creating a user-level override for these audio profiles so we don't clobber the system files (and so our changes survive the next package update).

First, ensure hardware Auto-Mute is disabled so PipeWire can do its job:

```bash
$ amixer -c 1 sset 'Auto-Mute Mode' Disabled
```

Next, create a local directory for your custom ALSA profiles:

```bash
$ mkdir -p ~/.config/alsa-card-profile/mixer/paths/
```

Copy the default system profiles over to your user directory:

```bash
$ cp /usr/share/alsa-card-profile/mixer/paths/analog-output-headphones.conf ~/.config/alsa-card-profile/mixer/paths/
$ cp /usr/share/alsa-card-profile/mixer/paths/analog-output-lineout.conf ~/.config/alsa-card-profile/mixer/paths/
```

Now, edit your local `analog-output-headphones.conf`. Find the `.include analog-output.conf.common` line near the bottom of the file, and add this block right above it:

```ini
[Element Line Out]
switch = off
volume = off
```
*(This tells the system: "When headphones are active, explicitly mute the Line Out hardware switch.")*

Then, edit your local `analog-output-lineout.conf`. Again, find the `.include` line at the bottom and add this block:

```ini
[Element Line Out]
switch = mute
volume = merge
override-map.1 = all
override-map.2 = all-left,all-right
```
*(This tells the system: "When Line Out is active, unmute the hardware switch and sync its volume with the master slider.")*

Finally, restart your audio services so they pick up the new profiles:

```bash
$ systemctl --user restart pipewire wireplumber
```

### Wrapping Up

After restarting WirePlumber, my desktop volume toggles work perfectly again. The speakers shut off when headphones are selected, and vice versa, without needing to physically unplug anything.

I'll definitely be adding these two `.conf` files to my dotfiles repository. Audio routing in Linux on desktop can still be a bit of a dark art when hardware vendors use non-standard element names, but at least user-level overrides make it relatively painless to fix once you track down the culprit.
