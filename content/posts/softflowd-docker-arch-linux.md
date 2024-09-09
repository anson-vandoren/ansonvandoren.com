+++ 
draft = false
date = 2024-03-10T15:03:38-07:00
title = "Fixing softflowd in Docker on Arch Linux"
description = "Fixing a very long delay when running some apps that iterate on NOFILES"
slug = "" 
tags = ["linux", "docker", "arch", "softflowd"]
categories = []
externalLink = ""
series = []
+++

**Disclaimer**: this will probably only interest maybe 3 people in the world, but one of
those people is likely to be future-me, so I'm writing it down here anyway.

# I almost ditched Arch again...

I really like Arch. I mean, at least I really want to like it. On some days, I actually
do. Yesterday was not one of those days. For some testing at work (oh, hey, by the way,
if you like the content on this blog and like hacking on things until they work and care
about writing super-performant code and don't hate Typescript and NodeJS, you may be
interested at working at [Cribl](https://cribl.io/careers/) with me)... where was I?...
Oh, right, I was taking a look at how we can integrate with NetFlow and IPFIX data, and
as a first step I wanted to set up a source that could throw appropriately formatted
data at our system. After some muddling around a bit, I settled on some publicly
available pcap files and a Docker container running `softflowd` to push the data to us.

That has the advantages of letting me switch between different NetFlow versions and
I think it can also output IPFIX, and with a carefully selected pcap file I can get lots
of different types of traffic to test with.

OK, step 1, let's just use Alpine to keep this as small as possible. Also nice that APK
already has a package for `softflowd`, so this should be super quick. Dockerfile, build,
run, and... hmm... it's not doing anything. Let's exec into a bare Alpine container and
add and run `softflowd`. Weird, it's just sitting there not doing anything.

Double-check on the host OS, and `softflowd` works fine. Maybe the package on Alpine is
just busted? Oh, containers for Arch or Ubuntu also do do the same thing when running
`softflowd`. I've been down a road a lot like this before, let me boot into something
that's not Arch instead and see if I have the same issues. Ubuntu 20.04 host OS, docker
container for Alpine, and `softflowd` works fine. OK, so it's not the container, it's
something about Arch. Surprise, surprise.

Oddly enough, my search of "arch+alpine+docker+softflowd" didn't turn up anything useful.
There are like two pages on the entire internet that have all those terms and that's
only because "arch" and "alpine" have more mainstream meanings, I think.

OK, back over to Arch, inside the Alpine container, and let's see what `strace` has to
say about this.

```bash
/ # strace softflowd -r sample.pcap -n 172.17.0.1:2255 -P tcp -v 5
execve("/usr/sbin/softflowd", ["softflowd", "-r", "sample.pcap", "-n", "172.17.0.1:2255", "-P", "tcp", "-v", "5"], 0x7ffc7d34d360 /* 6 vars */) = 0
arch_prctl(ARCH_SET_FS, 0x70139c9d8b08) = 0
set_tid_address(0x70139c9d8f70)         = 17
brk(NULL)                               = 0x56bf1910a000
brk(0x56bf1910c000)                     = 0x56bf1910c000
mmap(0x56bf1910a000, 4096, PROT_NONE, MAP_PRIVATE|MAP_FIXED|MAP_ANONYMOUS, -1, 0) = 0x56bf1910a000
open("/etc/ld-musl-x86_64.path", O_RDONLY|O_LARGEFILE|O_CLOEXEC) = -1 ENOENT (No such file or directory)
open("/lib/libpcap.so.1", O_RDONLY|O_LARGEFILE|O_CLOEXEC) = -1 ENOENT (No such file or directory)
open("/usr/local/lib/libpcap.so.1", O_RDONLY|O_LARGEFILE|O_CLOEXEC) = -1 ENOENT (No such file or directory)
open("/usr/lib/libpcap.so.1", O_RDONLY|O_LARGEFILE|O_CLOEXEC) = 3
fcntl(3, F_SETFD, FD_CLOEXEC)           = 0
fstat(3, {st_mode=S_IFREG|0755, st_size=235584, ...}) = 0
read(3, "\177ELF\2\1\1\0\0\0\0\0\0\0\0\0\3\0>\0\1\0\0\0\0\0\0\0\0\0\0\0"..., 960) = 960
mmap(NULL, 237568, PROT_READ, MAP_PRIVATE, 3, 0) = 0x70139c8fd000
mmap(0x70139c901000, 106496, PROT_READ|PROT_EXEC, MAP_PRIVATE|MAP_FIXED, 3, 0x4000) = 0x70139c901000
mmap(0x70139c91b000, 102400, PROT_READ, MAP_PRIVATE|MAP_FIXED, 3, 0x1e000) = 0x70139c91b000
mmap(0x70139c934000, 12288, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_FIXED, 3, 0x37000) = 0x70139c934000
close(3)                                = 0
mprotect(0x70139c934000, 8192, PROT_READ) = 0
mprotect(0x70139c9d5000, 4096, PROT_READ) = 0
mprotect(0x56bf1749a000, 4096, PROT_READ) = 0
prlimit64(0, RLIMIT_NOFILE, NULL, {rlim_cur=1073741816, rlim_max=1073741816}) = 0
close(3)                                = -1 EBADF (Bad file descriptor)
close(4)                                = -1 EBADF (Bad file descriptor)
close(5)                                = -1 EBADF (Bad file descriptor)
close(6)                                = -1 EBADF (Bad file descriptor)
close(7)                                = -1 EBADF (Bad file descriptor)
close(8)                                = -1 EBADF (Bad file descriptor)
close(9)                                = -1 EBADF (Bad file descriptor)
close(10)                               = -1 EBADF (Bad file descriptor)
close(11)                               = -1 EBADF (Bad file descriptor)
close(12)                               = -1 EBADF (Bad file descriptor)
close(13)                               = -1 EBADF (Bad file descriptor)
close(14)                               = -1 EBADF (Bad file descriptor)
close(15)                               = -1 EBADF (Bad file descriptor)
close(16)                               = -1 EBADF (Bad file descriptor)
close(17)                               = -1 EBADF (Bad file descriptor)
close(18)                               = -1 EBADF (Bad file descriptor)
<snip... keeps going on forever>
```

OK, I don't really want to dig too far into this and I don't have time to do too much
hunting around in `softflowd`s source, but, wait... that seems like an awfully big
number for `RLIMIT_NOFILE`. I don't know off the top of my head what a "normal" number
is, but I don't _think_ it's trillions. Let's see what it is on the host OS.

```bash
# meanwhile, back on Arch...
$ ulimit -n
1024
# and then in the container...
$ docker run --rm -it alpine:latest
/ # ulimit -n
1073741816
```

What is going on here? Let's check when Ubuntu is the host OS:

```bash
# Ubuntu 20.04
$ ulimit -n
1024
# and then in the container...
$ docker run --rm -it alpine:latest
/ # ulimit -n
1048576
```

OK, well that's still a big number, but at least it seems manageable for `softflowd` to
iterate through on whatever it's trying to do there. With this information in hand,
knowing that it's seemingly specific to Arch and NOFILES limits, I found [this gem](https://bbs.archlinux.org/viewtopic.php?id=285058).
Not much detail on why, but at least a version where it started and a workaround.

# The "fix", I guess

To make it work on a per-container basis, you can add `--ulimit nofile=<soft>:<hard>` when starting
the container, like:

```bash
$ docker run --rm -it --ulimit nofile=1048576:1048576 alpine:latest
```

To apply it globally, you can edit `/etc/docker/daemon.json` and add a `default-ulimits` section:

```json
{
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Soft": 1048576,
      "Hard": 1048576
    }
  }
}
```

Then restart the Docker daemon:

```bash
$ sudo systemctl restart docker
```

# Some other references...

- [PR to fix](https://github.com/containerd/containerd/pull/8924) in `containerd` 
- Maybe [where it's fixed](https://github.com/moby/moby/pull/45534/files) for Ubuntu.
