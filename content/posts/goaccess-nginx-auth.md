+++ 
draft = false
date = 2019-12-10T20:03:45-08:00
title = "Monitoring website traffic with GoAccess"
description = "Setting up web-based Nginx log monitoring"
slug = "" 
tags = ["Nginx", "GoAccess", "logs", "authentication"]
categories = []
externalLink = ""
+++

# Exploring alternatives to Google Analytics

One of the projects I've been neglecting for some time is to get rid of two parts of my personal website that I think are somewhat invasive to my readers: Google Analytics and Disqus comments.

- Both collect a lot of data from my visitors over which I have very limited control
- Both add page loading time overhead (although neither is particularly outrageous)

Of the two, I think it will be easier to get rid of GA, since basically all the stats I really want to know I can already find in my server access logs. There's really only a few things I want to know about how visitors interact with my site:

- What pages are getting the most traffic
- How many visitors am I getting per day/week/month
- What (if any) 404s (page not found) errors are occurring
- Generally speaking, where in the world is my audience coming from
- What time(s) of day see the most traffic
- What referrers are sending traffic to my website

Google Analytics obviously offers all these things and much more, but comes at the cost of lost privacy for my users as well as being dependent on Google for yet another service in my life. Many of the additional features of GA geared towards serving ads, which I don't plan to do.

# Options I considered

I've been saving links to some promising alternatives for the last few weeks, and sat down tonight to decide on and test one. There were three I looked at:

- [Matomo](https://matomo.org) (formerly Piwik)
- [Ackee](https://ackee.electerious.com/)
- [GoAccess](https://goaccess.io/)

All three are free (like GA), although Matomo does offer paid plans if you don't want to self-host. Matomo and Ackee both require setting up a self-hosted server and adding a tracking script to each page you want to track. This is definitely possible and likely not too difficult, but still seemed to be overkill for what I actually need in terms of data.

GoAccess is more basic than the other two, but still supports the information I want to get. Instead of using a tracking script on each page I serve, it just parses the access logs already produced by Nginx.

# Basic setup

After SSH'ing into my Ubuntu web server, I installed GoAccess with a simple

```sh
$ sudo apt install goaccess
```

From there, I just spent some time reading the [man page](https://goaccess.io/man) to choose what options I wanted. The only two real changes I made compared to the basic example on the Getting Started page was to store the results in a database so it will survive restart, and to run the service as a daemon in the background. My command to start the service looks like this:

```sh
$ sudo zcat /var/log/nginx/access.log.*.gz | sudo goaccess /var/log/nginx/access.log - -o /var/www/ansonvandoren.com/html/report.html --log-format=COMBINED --real-time-html --ws-url=wss://ansonvandoren.com/ws --port 7890 --keep-db-files --load-from-disk --daemonize -db-path=/home/myuser/goaccess/
```

If you're on a smaller screen you'll need to scroll right to see all of that... it's kind of a mouthful... A simple explanation of each option is below:

- `sudo zcat /var/log/nginx/access.log.*.gz |` unzips my archived logs and pipes them to stdout to be read by `goaccess`
- `sudo goaccess /var/log/nginx/access.log -` tells `goaccess` to tail the current access log file and then read in (the extra `-`) anything else from stdin (the archived logs from the left side of the pipe)
- `-o /var/www/ansonvandoren.com/html/report.html` is the location I want the generated HTML to be produced. To access the report, I just need to navigate to https://ansonvandoren.com/report.html. Note that if you try this now, you'll get a username/password prompt. More on that below.
- `--log-format=COMBINED` specifies what format the Nginx logs will be in. `COMBINED` worked for me, but if your Nginx logs are formatted differently than default, you may need a different format flag here. See the man page if needed.
- `--real-time-html` starts a WebSocket server to continually feed new data to the browser while I'm viewing the report page
- `--ws-url=wss://ansonvandoren.com/ws --port 7890` specifies the URL and port for the WebSocket server. This needs some additional configuration in my Nginx configuration that I'll detail below
- `--keep-db-files --load-from-disk` tells `goaccess` to save the results in a database on disk so that if I restart my server or `goaccess` later I won't lose any of the stats
- `--daemonize` tells `goaccess` to run as a background process. The other alternative would have been to not include this flag, but to run `goaccess` inside a tmux session and just detach from the session to leave it running.
- `-db-path=/home/myuser/goaccess/` tells `goaccess` where to save the database files to; this is just an empty directory I made in my home folder

After starting `goaccess` with these flags, I can see the PID for the daemon (in this case 25423:

```sh {hl_lines=[2]}
$ sudo zcat /var/log/nginx/access.log.*.gz | sudo goaccess /var/log/nginx/access.log - -o /var/www/ansonvandoren.com/html/report.html --log-format=COMBINED --real-time-html --ws-url=wss://ansonvandoren.com/ws --port 7890 --keep-db-files --load-from-disk --daemonize --db-path=/home/myuser/goaccess/
Daemonized GoAccess: 25423
```

If I want to kill the daemon I can use this PID with `sudo kill -11 25423`

# Configure Nginx to proxy the WebSocket connection

Since I set up real time updates with WebSockets, I need to pass that URL and port through from the client to the `goaccess` server. I already have Nginx configured to reverse proxy a few other services (see [my other article](https://ansonvandoren.com/posts/configuring-nginx-to-proxy-webhooks/) about forwarding GitHub webhooks for website deployment as an example), so it was pretty trivial to include one more location.

The relevant additional section of my Nginx configuration looks like this

```sh
    ...
    location /ws {
        proxy_pass http://localhost:7890;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
    ...
```

This is just a standard reverse proxy entry with the addition that it's upgrading to HTTP 1.1 to support WebSockets. Don't forget to restart Nginx after you save the changes with `sudo systemctl restart nginx`.

# Add basic authentication

I don't necessarily have a problem with random strangers on the internet seeing my basic website stats, but since this is a new tool that I don't have a good handle on yet, I thought it was safer for now to limit access. This can be easily achieved using HTTP Basic Authentication with a few more changes to my Nginx configuration file like so:

```sh
    ...
    location /report.html {
        auth_basic "Login Required";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }
    location /ws {
        proxy_pass http://localhost:7890;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        auth_basic "Login Required";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }
    ...
```

This just adds an authentication prompt to two locations (the HTML page that `goaccess` generates, and the websocket connection required for realtime updates), and points Nginx towards a password file that I created.

To allow access through the `.htpasswd` file, I needed to create a new one since nothing else on my site has required authentication before this.

```sh
$ sudo apt install apache2-utils
...
$ sudo htpasswd -c /etc/nginx/.htpasswd anson
Password: ***********
New password: *********
Re-type new password: *********
Adding password for user anson
```

`htpassword` with the `-c` option will create a new password file at the location specified, and add a new user (`anson` in this case). The first password prompt is the sudo'er password; the second and third prompts are for the password I want associated with the new username `anson` that I'm creating here.

I grabbed most of the instructions for this section from the [Nginx docs here](https://docs.nginx.com/nginx/admin-guide/security-controls/configuring-http-basic-authentication/) so if something doesn't work right, try checking to see if they have something updated.

# Final result

{{< figure src="/images/goaccess_html.png#center" link="/images/goaccess_html.png" target="_" >}}

Above is an example of the stats page generated automatically for me. There's a lot of information here, and it may be enough to completely replace my Google Analytics, but I need some time working with it a little more to make a final decision.

All in all, GoAccess was pretty easy to set up, is more respectful of visitor privacy, and doesn't require loading additional scripts on all my pages.

If you've had experience using GoAccess and notice anything I could've done better/differently, please let me know in the comments.