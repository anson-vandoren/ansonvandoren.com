+++ 
draft = false
date = 2022-08-21T22:25:28-07:00
title = "Setting a PulseAudio profile on Bluetooth headset connection"
description = "On getting my Jabra headset to always use HFP in Linux"
slug = "" 
tags = ["linux", "audio", "bluetooth", "pulseaudio"]
categories = []
externalLink = ""
series = []
+++

I love most things about developing on and using Linux as my daily driver operating system, but occasionally I come across little
things that just feel way too complicated to "fix" when I don't like the standard way of doing things.

One thing that's been bugging me for a while, and I finally came up with a workable solution for, is getting my Jabra headset to
always use the HFP profile when it reconnects to my computer. Like a lot of people working from a computer these days, I spend quite
a bit of time each week on video calls, and it's a small but constant annoyance to have to manually switch the profile on my headset
to HFP when I connect it to my computer so that I can use the built-in mic instead of Linux just treating it as a regular audio output.

# The problem

When my Bluetooth earbuds re-connect with my computer, they always default to the A2DP profile, which means that the mic is disabled,
and I need to manually open `pavucontrol` and switch the profile to HFP before I can join the Zoom call. Compounding the problem is
that if I forget to do this before joining the meeting, I need to leave the meeting and re-join it after switching the profile, since
Zoom doesn't pick up the change once the call is started for some reason.

The way this _should_ work is that when Zoom starts, it signals to PulseAudio that it wants to use the headset for a "phone call", and
PulseAudio should automatically switch the profile to HFP. This actually works correctly on my phone, and also on macOS, but for some
reason it doesn't work on Linux.

# Failed or incomplete solutions

**Setting the profile each time I connect**

I could do this manually from the PulseAudio volume control applet each time under the Configuration tab, but I don't want to need that
extra step. Likewise, I could use `pactl set-card-profile` to do it from the command line, but I don't want to need to do that either.

**Setting the default profile in PulseAudio config file**

Most of the recommendations I found on the internet while searching for a solution to this problem involved editing `/etc/pulse/default.pa`.
This solution works fine for a headset which is always connected, but that's obviously not the case for Bluetooth earbuds. `default.pa` is
only run once when PulseAudio starts, so if the earbuds are not connected at that point (they never are), then the profile will never be
set.

**"Locking" the profile, or setting `auto_switch=0`**

A few other answers I found suggested using the lock icon in `pavucontrol` once the HFP profile was set on a connected headset, or else
in `/etc/pulse/default.pa` adding/changing the line `load-module module-bluetooth-policy auto_switch=0`. This does indeed prevent a
well-behaved app from automatically changing the profile between A2DP and HFP, but it doesn't change anything about the behavior when
the headset is reconnected, and it still defaults to A2DP.

# The solution

Since it doesn't look like PulseAudio is going to let me do this via its configuration, I decided to take a step back and try to automate
the manual profile switch I was doing one layer above, when the Bluetooth connection is established. To do this, I need two parts: one
to detect when this particular headset is connected and run an arbitrary script, and a second script to actually switch the profile.

**Script to change the profile to HFP**

First thing I need here is to know how PulseAudio refers to this headset. I paired and connected the earbuds to my computer, then ran:

```bash
# Note: in some cases you may need to substitute `pacmd` instead of `pactl`
# in the places it's used in the rest of this article. Thanks Anya for
# pointing this out to me!
$ pactl list
...
Card #20
	Name: bluez_card.70_BF_92_C9_F5_D0
	Driver: module-bluez5-device.c
	Owner Module: 42
	Properties:
		device.description = "Jabra Elite 75t"
		device.string = "70:BF:92:C9:F5:D0"
		device.api = "bluez"
		device.class = "sound"
		device.bus = "bluetooth"
		device.form_factor = "headset"
		bluez.path = "/org/bluez/hci0/dev_70_BF_92_C9_F5_D0"
		bluez.class = "0x240404"
		bluez.alias = "Jabra Elite 75t"
		bluetooth.battery = "100%"
		device.icon_name = "audio-headset-bluetooth"
		device.intended_roles = "phone"
		bluetooth.codec = "mSBC"
	Profiles:
		a2dp_sink: High Fidelity Playback (A2DP Sink) (sinks: 1, sources: 0, priority: 40, available: yes)
		handsfree_head_unit: Handsfree Head Unit (HFP) (sinks: 1, sources: 1, priority: 30, available: yes)
		off: Off (sinks: 0, sources: 0, priority: 0, available: yes)
	Active Profile: a2dp_sink
	Ports:
		headset-output: Headset (type: Headset, priority: 0, latency offset: 0 usec, availability unknown)
			Part of profile(s): a2dp_sink, handsfree_head_unit
		headset-input: Headset (type: Headset, priority: 0, latency offset: 0 usec, availability unknown)
			Part of profile(s): handsfree_head_unit
```

This output tells me a few things I need to know:

- The card name is `bluez_card.70_BF_92_C9_F5_D0`. Since the index (`20` in this case) is not consistent, I'll need to use the name
  instead.
- The profile I want to switch to is called `handsfree_head_unit`.

With that information, I can write a script to switch the profile:

**Note**: if you have a managed user instead of a local one, you may need to `id -u
myuser` to get the proper user id, and use it in place of `1000` in the script below.
Thanks again to Anya for pointing this out to me.

```bash
#!/bin/bash
sleep 2 # wait for the headset to fully connect
# if `pactl` below doesn't work for you, `pacmd` instead might get you going.
sudo -u '#1000' XDG_RUNTIME_DIR=/run/user/1000 \
    pactl set-card-profile bluez_card.70_BF_92_C9_F5_D0 handsfree_head_unit
logger "Switched Jabra headset to HFP profile"
```

The `sleep 2` is necessary because the headset takes a few seconds to fully connect, and if I try to switch the profile too soon, it
doesn't work. 

The `sudo -u '#1000' XDG_RUNTIME_DIR=/run/user/1000` is necessary because the second part I need is a `udev` rule that
will execute this script, and `udev` runs as root, which doesn't have access to my user's PulseAudio socket. The `XDG_RUNTIME_DIR` lets `udev` (running as root) find the PulseAudio socket (owned by the user) to connect to.

You can add the `logger` call like I did if you want to be able to monitor `syslog` to see when the profile is switched. This was
useful when debugging the script, but probably not needed once it works.

Saving this script somewhere accessible and running a `chmod +x /path/to/script` on it will make it executable, and running it
from the command line will switch the profile to HFP. If this doesn't work manually, make sure that you have the correct
card name and profile name. This script should also work correctly from a `sudo -i` shell even though the user at that point is `root`.

**`udev` rule to run the script when the headset connects**

Now that I have a script to switch the profile, I need to run it when the headset connects, which means I need to see what happens
in `udev`. To do this, I disconnected the earbuds, ran `udevadm monitor`, then connected the earbuds. This is the relevant part
of the output:

```bash
$ udevadm monitor
monitor will print the received events for:
UDEV - the event which udev sends out after rule processing
KERNEL - the kernel uevent
...
UDEV  [54588.946048] add      /devices/virtual/input/input112 (input)
UDEV  [54588.977938] add      /devices/virtual/input/input112/event256 (input)
...
```

There's two important parts of this. First, the event is an `add` event, which I'll need, and second, the device is
`/devices/virtual/input/input112` as of right now. Note that this will change every time I connect the earbuds, so I need
to get some more info before disconnecting them. To do that, I ran `udevadm info -ap` with the device path from above:

```bash
$ udevadm info -ap /devices/virtual/input/input112

Udevadm info starts with the device specified by the devpath and then
walks up the chain of parent devices. It prints for every device
found, all possible attributes in the udev rules key format.
A rule to match, can be composed by the attributes of the device
and the attributes from one single parent device.

  looking at device '/devices/virtual/input/input112':
    KERNEL=="input112"
    SUBSYSTEM=="input"
    DRIVER==""
    ATTR{capabilities/abs}=="0"
    ATTR{capabilities/ev}=="100007"
    ATTR{capabilities/ff}=="0"
    ATTR{capabilities/key}=="2fc800 145200000000 0 10300 49e800000c00 e16800000000f f810000010000ffc"
    ATTR{capabilities/led}=="0"
    ATTR{capabilities/msc}=="0"
    ATTR{capabilities/rel}=="0"
    ATTR{capabilities/snd}=="0"
    ATTR{capabilities/sw}=="0"
    ATTR{id/bustype}=="0005"
    ATTR{id/product}=="24a7"
    ATTR{id/vendor}=="0067"
    ATTR{id/version}=="0200"
    ATTR{inhibited}=="0"
    ATTR{name}=="Jabra Elite 75t (AVRCP)"
    ATTR{phys}=="e0:d4:64:38:d1:db"
    ATTR{power/async}=="disabled"
    ATTR{power/control}=="auto"
    ATTR{power/runtime_active_kids}=="0"
    ATTR{power/runtime_active_time}=="0"
    ATTR{power/runtime_enabled}=="disabled"
    ATTR{power/runtime_status}=="unsupported"
    ATTR{power/runtime_suspended_time}=="0"
    ATTR{power/runtime_usage}=="0"
    ATTR{properties}=="0"
    ATTR{uniq}==""
```

There's a few things I need to pull out of here to write my `udev` rule:

- The device subsystem is `input`
- The device vendor ID is `0067`
- The device product ID is `24a7`

At this point, you can disconnect the earbuds again since you have all the information you need.

If I wanted my rule to be specific to only just this one Jabra headset, I could also use `ATTR{phys}` to match the MAC address,
but I only have one headset, so I don't need to do that.

To write this new rule, I created the file `/etc/udev/rules.d/52-jabra-headset.rules` with the following contents:

```bash
ACTION=="add", SUBSYSTEM=="input", ATTR{id/vendor}=="0067", ATTR{id/product}=="24a7", RUN+="/home/<myUsername>/.config/myPactlScript.sh"
```

Obviously you'll need to replace a few parts of that rule to match your particular device configuration and where you put the `pactl` script
from earlier, but it should be enough to point you in the right direction.

**Testing the rule**

To test the rule, ran `tail -f /var/log/syslog` and reconnected the earbuds. Since I have the `logger` call in my script, I was able to
see (after many attempts at getting this right...) that the rule was working correctly:

```bash
$ tail -f /var/log/syslog
...
Jun  8 21:38:04 <myHostname> kernel: [  545.888000] input: Jabra Elite 75t (AVRCP) as /devices/virtual/input/input112
Jun  8 21:38:04 <myHostname> root: Switched Jabra headset to HFP profile
```

# Wrapping up

The only things left to do were my usual after fixing an annoying, obscure problem:

- Add the new config to my dotfiles repo so it's easier next time, and
- Writing a short post about it so I remember my reasoning next time I need this and the dotfiles don't give me enough to remember

Feel free to let me know if some of the above isn't clear, or if you've found a better solution to this particular problem. You can
find my contact info [on the home page](https://ansonvandoren.com).
