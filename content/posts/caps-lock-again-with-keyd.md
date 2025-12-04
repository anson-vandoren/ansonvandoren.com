---
title: "CapsLock Again With Keyd"
date: 2025-12-04T20:45:45Z
draft: false
---

Well, another day, another distro, another fight with the uselessness that is the CapsLock key. My first two posts [here](https://ansonvandoren.com/posts/capslock-linux-redux/) and [here](https://ansonvandoren.com/posts/ubuntu-capslock-swap/) work to varying degrees of success but either not well enough, or too damn complicated to set up. So here goes again - this should be short...

Ubuntu has a `keyd` package, but it didn't work for me. Instead, I installed [from source](https://github.com/rvaiya/keyd?tab=readme-ov-file#from-source), made up a small config file, and started the daemon as instructed.

```shell
# /etc/keyd/default.conf
[ids]

*

[main]

capslock = overload(meta, esc)
leftshift = overload(shift, S-9)
rightshift = overload(shift, S-0)

delete = capslock
leftalt = leftcontrol
leftmeta = leftalt
```

It was that simple. This not only gives me CapsLock double-duty with Escape when tapped and Meta when held (for my i3/sway commands), but also gives me Space Cadet-esque parens on my shift keys, which I never thought I'd get on a laptop keyboard despite loving it on my Moonlander/ErgoDox.

Feels like it should be more complicated, but it's really not.
