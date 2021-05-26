+++ 
draft = false
date = 2021-05-25T17:20:24-07:00
title = "Making CapsLock Useful... on Solus"
description = "Fixing up the CapsLock key with caps2esc, from source"
slug = "" 
tags = ["linux", "capslock", "solus", "keyboard"]
categories = []
externalLink = ""
series = []
+++

# I thought I had this figured out...

I [previously wrote about](https://ansonvandoren.com/posts/ubuntu-capslock-swap) fixing the caps lock key in Ubuntu.
This more or less worked fine, but it still felt pretty hacky. I wasn't happy with it, but at the same
time I mostly use Windows or macOS as my daily driver, and didn't spend much time looking for a better solution.

The other day I got fed up (again) with Windows 10, and set up a dual-boot install with Linux. After a bit of
searching around, I settled on [Solus Budgie](https://getsol.us/download/) as my distro of choice this time.
It seems that everyone who uses it vows to never switch to anything else, which isn't super surprising given the
Linux community, but... it looked intriguing. I've spent most of my Linux time on Ubuntu or other Debian variants,
with a bit of dabbling with Arch when I'm feeling particularly masochistic. Solus isn't based on either, and it
felt like a good time to learn something new so I dove in.

For the most part, it's been smooth sailing so far, and the majority of the packages I needed were available
through `eopkg` with names similar to what I'd expect from `apt-get`. When it came time to get caps lock working, though,
I found a new solution that looked a bit more stable, in the form of the [`caps2esc`](https://gitlab.com/interception/linux/plugins/caps2esc)
plugin for a tool called `interception`. Hat tip to Danny Guo's [post](https://www.dannyguo.com/blog/remap-caps-lock-to-escape-and-control/) that
led me to this more reliable alternative to `xcape`.

`caps2esc` is a plugin for a tool [by the same author](https://nosubstance.me/) called [`interception`](https://gitlab.com/interception/linux/tools),
which self-describes as "A minimal composable infrastructure on top of `libudev` and `libevdev`". Anyway, whatever. It looks like
it can do what I want, namely to remap caps lock into something useful, and also able to do it without
barfing whenever the computer goes to sleep, and without a bunch of hacks and workarounds.

`caps2esc` has nicely-built packages... for Ubuntu and Arch. Not so much for Solus.

# Building from source

## Install prerequisites

OK, no problem - just build it myself. This should have been way easier than it was, and I blame myself, mostly.
The documentation could've been a little more explicit, but I'm also not super familiar with
C++ development on Linux, and while I have a general idea of what `make` does, it's not something I use
regularly. But, in the spirit of not needing to look things up across the internet in the future, here's
what it took for me to get this thing built:

```sh
$ sudo eopkg install -c system.devel
```

This gives you things like `cmake` & `make`, `gcc` & `g++`, and a bunch of other useful utilities for building
other software.

```sh
$ sudo eopkg install libevdev-devel libconfig-devel yaml-cpp-devel libboost-devel
```

This gives you the rest of the libraries needed by both `caps2esc` and the underlying `interception`.

## Clone the repos and build

### caps2esc

```sh
$ cd ~/src
$ git clone git@gitlab.com:interception/linux/plugins/caps2esc.git
$ cd caps2esc
$ cmake -B build -DCMAKE_BUILD_TYPE=Release
$ cmake --build build
```

### interception

```sh
$ cd ~/src
$ git clone git@gitlab.com:interception/linux/tools.git interception-tools
$ cd interception-tools
$ cmake -B build -DCMAKE_BUILD_TYPE=Release
$ cmake --build build
```

## Copy binaries

You can probably put these wherever you like, as long as it's on your path. I chose
`/usr/bin/`:

```sh
$ sudo cp ~/src/caps2esc/build/caps2esc /usr/bin/
$ cd ~/src/interception-tools/build
$ cp udevmon intercept mux uinput /usr/bin/
```

## Set up a `systemd` unit file to run intercept

```sh
$ cd ~/src/interception-tools
$ sudo cp ./udevmon.service /etc/systemd/system/
```

If you take a look at the unit file, you'll see that `udevmon` will look for a YAML
config file at `/etc/interception/udevmon.yaml`, so let's create that.

```sh
$ sudo mkdir -p /etc/interception
$ sudo vim /etc/interception/udevmon.yaml
```

## Create a config file

The [GitLab page](https://gitlab.com/interception/linux/plugins/caps2esc) has an example
config file to use `caps2esc` correctly with `interception`:

```yaml
- JOB: intercept -g $DEVNODE | caps2esc | uinput -d $DEVNODE
  DEVICE:
    EVENTS:
      EV_KEY: [KEY_CAPSLOCK, KEY_ESC]
```

## Start the service

```sh
$ sudo systemctl enable udevmon --now
$ sudo systemctl status udevmon
● udevmon.service - Monitor input devices for launching tasks
     Loaded: loaded (/etc/systemd/system/udevmon.service; enabled; vendor preset: enabled)
     Active: active (running) since Tue 2021-05-25 17:18:54 PDT; 3h 43min ago
       Docs: man:udev(7)
   Main PID: 30691 (udevmon)
      Tasks: 17 (limit: 77059)
     Memory: 5.5M
        CPU: 10.870s
     CGroup: /system.slice/udevmon.service
             ├─30691 /usr/bin/udevmon -c /etc/interception/udevmon.yaml
             ├─30705 sh -c intercept -g $DEVNODE | caps2esc | uinput -d $DEVNODE
             ├─30706 sh -c intercept -g $DEVNODE | caps2esc | uinput -d $DEVNODE
             ├─30707 sh -c intercept -g $DEVNODE | caps2esc | uinput -d $DEVNODE
             ├─30708 intercept -g /dev/input/event1
             ├─30709 caps2esc
             ├─30710 sh -c intercept -g $DEVNODE | caps2esc | uinput -d $DEVNODE
             ├─30711 uinput -d /dev/input/event1
             ├─30712 intercept -g /dev/input/event2
             ├─30713 caps2esc
             ├─30714 uinput -d /dev/input/event2
             ├─30715 intercept -g /dev/input/event3
             ├─30716 caps2esc
             ├─30717 uinput -d /dev/input/event3
             ├─30718 intercept -g /dev/input/event0
             ├─30719 caps2esc
             └─30720 uinput -d /dev/input/event0
```

# OK, but...

So this is great, and it indeed makes CapsLock behave the way I want it to - Escape
when tapped, and Control when held down in combination with another key. All well
and good, right?... right?...

Of course it can't be that simple. Everything worked fine right up until the point where
I remapped a few other keys on the keyboard using `gnome-tweaks`. Although I frequently
switch between Windows and macOS, I'm most comfortable with macOS-ish (sort of) modifier
keys. I prefer the left-most key on the bottom row to act like a Windows key (i.e., to open
up the Start menu or launcher), then the Fn key (which I don't use), then the Alt/Opt key,
then the Command/Control key. `gnome-tweaks` has this exact swapperoo that I want (called
"Left Alt as Ctrl, Left Ctrl as Win, Left Win as Left Alt", under the "Ctrl position"
setting. Great. Enable that, re-login to enable it, and... whoops. Now CapsLock still works
as Escape, but no longer works as Ctrl.

A bit of digging around shows that `caps2esc` doesn't play well with anything else that
modifies the keyboard, particularly if the other mapping has lower priority. Hmm... After
trying out a different ways of remapping the keys I wanted, and getting the same results,
I finally found another plugin (unofficial) for `interception` that worked, with
a bit of playing around.

## interception-k2k

This [plugin](https://github.com/zsugabubus/interception-k2k) does quite a few different
things, but what I really need it for is pretty simple: add another pipeline step
in the `interception` chain that will remap the modifier keys *before* caps2esc gets
hold of them. Instead of having a one-size-fits-all scope, this plugin lets you define
your own keymappings in a way that `interception` can pipeline them.

Here's what I did:

### Clone the repo

```sh
$ cd ~/src
$ git clone git@github.com:zsugabubus/interception-k2k
```

### Create a new keymapping configuration

```sh
$ mkdir ~/src/interception-k2k/default/swapsies
$ nvim ~/src/interception-k2k/default/swapsies/map-rules.h.in
```

Add the following to this file:

```c
{ .from_key = KEY_LEFTCTRL, .to_key = KEY_LEFTMETA },
{ .from_key = KEY_LEFTMETA, .to_key = KEY_LEFTALT },
{ .from_key = KEY_LEFTALT, .to_key = KEY_LEFTCTRL }
```

### Build the pipeline step

```sh
$ cd ~/src/interception-k2k
$ make
touch default/swapsies/tap-rules.h.in
touch default/swapsies/multi-rules.h.in
cc -std=c99 -O3 -g -Wall -Wextra -Werror -Wno-type-limits -Idefault -Idefault/swapsies k2k.c -o out/swapsies
rm default/swapsies/multi-rules.h.in default/swapsies/tap-rules.h.in
```

This builds an executable from the rules I just specified, and puts it
in the `./out/` folder.

### Move the pipeline executable somewhere sane

```sh
$ sudo mkdir -p /opt/interception
$ sudo cp ~/src/interception-k2k/out/swapsies /opt/interception/
```

### Update `udevmon` to add this pipeline step

> IMPORTANT: this step MUST come before the `caps2esc` step, otherwise it doesn't
fix the problem at all

```sh
$ sudo nvim /etc/interception/udevmon.yaml
```

Add the new pipeline step in the `JOB` section as the first pipeline. The file
should look like this afterwards:

```yaml
- JOB: intercept -g $DEVNODE | /opt/interception/swapsies | caps2esc | uinput -d $DEVNODE
  DEVICE:
    EVENTS:
      EV_KEY: [KEY_CAPSLOCK, KEY_ESC]
```

### Restart `udevmon`

```sh
$ sudo systemctl restart udevmon
```

# Profit

It took a re-login after this to get things working, after initially finding
that my key-repeat and delay settings had been clobbered. After logging out
and back in again, though everything seems to be working properly, and I've
finally got what I wanted.


