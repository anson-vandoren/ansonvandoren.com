+++ 
draft = false
date = 2020-01-12T07:06:03-10:00
title = "Making CapsLock useful on Ubuntu"
description = "Swapping CapsLock for combined Esc & Ctrl"
slug = "" 
tags = ['linux', 'keyboard', 'capslock']
images = ["/images/keyboard_header.jpg"]
categories = []
externalLink = ""
series = []
+++

# CapsLock is in the wrong spot

I use `vim` as my default text editor for most tasks, which means I use both the `Esc` and `Ctrl` keys quite a lot. On most keyboards, however, these two keys are not in very comfortable positions, and I need to stretch my little finger to hit either.

Meanwhile, the `CapsLock` key is sitting right in prime real estate to the left of the `A` key, but is a key I never really use. I've already rectified this situation on my macOS computers with [Karabiner](https://pqrs.org/osx/karabiner/), and on my Windows computers with [AutoHotKey](https://www.autohotkey.com/). I recently switched an old 2012 Samsung laptop over to running [elementaryOS](https://elementary.io/), which is based on Ubuntu, and needed to accomplish the same task.

# The swap

Basically, I want to move the CapsLock key somewhere unobtrusive on the keyboard (since I never use it), and then make the former CapsLock key perform two different functions:

- If it's pressed by itself (i.e., not held down while pressing another key), then I want it to act as the Esc key.
- If it's held down while pressing another key, I want it to act like the Ctrl key.

This way I get two very useful keyboard actions out of the same key, and can save my little finger some stress and strain for my most commonly used modifier keys.

## Remapping CapsLock

There's two different utilities I use to accomplish this swap. First is the `setxkbmap` command that's part of X Server. I want to move the CapsLock key to the original LeftCtrl position, and the Ctrl key to the original CapsLock position, so I'm using this:

```sh
$ setxkbmap -option ctrl:swapcaps
```

## Setting Ctrl to Escape if pressed alone

Next, I want to make Ctrl (in its new position) act as Esc if pressed by itself, but as Ctrl if pressed with another key. I'm using a tool called `xcape` for this, which isn't part of a standard Ubuntu/elementaryOS installation, but can be easily installed via instructions on its [GitHub page](https://github.com/alols/xcape). Once I have xcape installed somewhere on my PATH, I use it like this:

```sh
$ xcape -e 'Control_L=Escape'
```

# Keeping the changes set after sleep

Originally, I put the two commands above in my `.zshrc` file so whenever I opened a new terminal it would apply the changes. This was mostly OK, except that whenever the laptop came out of sleep mode, the changes would be reset and I'd need to either open a new terminal, or re-source the .zshrc file. Neither is particularly optimal, so I spent some time figuring out how to get a script to run on system wakeup/resume. I'm still not sure my method is the "right way" to do this, but it has worked so far.

I created a new file in `/lib/systemd/system-sleep/` called `resume` (_Note: you'll need to use `sudo` to be able to save/edit a file here_), and added these lines:

```sh
#!/bin/bash

# make caps lock useful
case $1 in
    post)
        sleep 5
        declare -x DISPLAY=":0.0"
        declare -x XAUTHORITY="/home/<your-user-name>/.Xauthority"
        setxkbmap -option ctrl:swapcaps
        xcape -e 'Control_L=Escape'
        ;;
esac
```

Once you have saved this file, make it executable with:

```sh
$ sudo chmod +x /lib/systemd/system-sleep/resume
```

Basically, this is only running in the `post`-sleep case, is ensuring we have an XServer reference, and then running the two commands I already had. Originally I didn't have the two `declare` lines, and kept getting errors like:

> `Unable to connect to X11 display. Is $DISPLAY set`

These errors are fixed by the `declare` lines I mentioned above. If the script isn't working for you and you're not sure why, you can add this line just below the `#!/bin/bash` line in the script, and then check the contents after system resume:

```sh
exec 2> /tmp/systemd_suspend_test_err.txt
```

This line will send the STDERR stream to the temporary file that you can examine later.

If you can't get this to work for you, have a better way of doing it, or just have a question, feel free to leave a comment below.
