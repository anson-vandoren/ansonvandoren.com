+++ 
draft = false
date = 2025-12-05T16:26:25Z
title = "Switching i3 workspaces with trackpad gestures"
description = "Configuring libinput-gestures, xdotool, and i3 to play nicely"
tags = ["linux", "i3", "xdotool", "laptop"]
+++

For various reasons, I find myself working on a laptop with no external screen,
mouse, or separate keyboard for a time. Of course, since I don't normally use
this setup, I obviously needed an entirely new Linux setup to celebrate the
occasion and so that I could spend the requisite day of setup before going back
to real work.

This time I'm on a minimal kick and so started with Ubuntu Server with the
`minimize` option to have basically nothing, and build up just the parts I want
and need. I'm opting for X11 over wayland, which means i3 because tiling window
managers are awesome and i3 is closest to the config muscle memory I have from
sway and hyprland. So far so good and it's mostly the way I like it, but since
I have a trackpad that's so close to my fingers that it might as well be the
keyboard, I might as well take advantage of that and get some swipe gestures
that I want to use. Mostly this means swipe up and down to change workspaces,
with the added requirement that swiping up when there are no more active
workspaces, i3 should create a new workspace at the next highest number rather
than its default behavior of cycling back to the lowest-numbered workspace.

Here we go. This will be concise and to the point, as usual mostly for future
me to find and not need to re-invent this particular wheel.

## Prerequisites

```shell
sudo apt update
sudo apt install xdotool libinput-tools wmctrl
```

I'm pretty sure that for my setup `wmctrl` and `xdotool` are not required,
but the author of [`libinput-gestures`](https://github.com/bulletmark/libinput-gestures)
recommends them both "just in case", and I may want an action that actually
uses them in the future.

Next, add yourself to the `input` group so that you can read the touchpad device.

```shell
sudo gpasswd -a $USER input
```

After this, logout and log back in or else restart.

## Installing `libinput-gestures`

Finally, actually get `libinput-gestures` itself.

```shell
git clone https://github.com/bulletmark/libinput-gestures.git
cd libinput-gestures
sudo ./libinput-gestures-setup install
```

You can `libinput-gestures-setup autostart` to have it start from an autostart
desktop entry, but I opted to add it to my `i3` config instead

```shell
# ~/.config/i3/config
...
exec --no-startup-id libinput-gestures-setup start
...
```

## Custom action for next workspace

By default, `i3` will wrap around on `i3-msg workspace next`, meaning that
if I'm at my highest-numbered workspace and 3-finger-swipe up, I'll go back
to my lowest-numbered workspace. That's not usually what I want, though, and
instead I want it to (on the highest workspace) just create a new one instead.

So, here's the script I made for that

```shell
#!/bin/bash

# in ~/.config/i3/next-or-new.sh

CURRENT_NUM=$(i3-msg -t get_workspaces | jq -r '.[] | select(.focused==true).num')
ALL_NUMS=($(i3-msg -t get_workspaces | jq -r '.[].num' | sort -n))
NEXT_WORKSPACE_NUM=0

for NUM in "${ALL_NUMS[@]}"; do
    if (( $CURRENT_NUM < $NUM )); then
        NEXT_WORKSPACE_NUM=$NUM
        break
    fi
done

if [ "$NEXT_WORKSPACE_NUM" -eq 0 ]; then
    HIGHEST_NUM=$(echo "${ALL_NUMS[@]}" | tr ' ' '\n' | sort -nr | head -1)
    [ -z "$HIGHEST_NUM" ] && NEXT_WORKSPACE_NUM=1 || NEXT_WORKSPACE_NUM=$((HIGHEST_NUM + 1))
fi

i3-msg workspace number "$NEXT_WORKSPACE_NUM"
```

With the script in place, `chmod +x ~/.config/i3/next-or-new.sh` and then 
move on to actually calling it.

# Configuring `libinput-gestures`

Copy the default config to a local dir:

```shell
cp /etc/libinput-gestures.conf ~/.config/libinput-gestures.conf
```

Then, edit this file to replace the default swipe gestures

```shell
# ~/.config/libinput-gestures.conf

# On a 3-fingered down swipe, go to previous i3 workspace
gesture swipe down 3 i3-msg workspace prev
# On a 3-fingered up swipe, go to next i3 workspace or create a new one
gesture swipe up 3 ~/.config/i3/next-or-new.sh
# On a 4-fingered up swipe, go to next i3 workspace or cycle to first
gesture swipe up 4 i3-msg workspace next
```

Restart the daemon:

```shell
libinput-gestures-setup restart
```

Done!
