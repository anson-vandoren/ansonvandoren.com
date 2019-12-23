+++
title = "Configuring Nginx to Proxy Webhooks"
tags = ["Nginx", "Proxy", "Webhooks"]
description = "Configuring Nginx to proxy calls to a webhooks server"
date = 2019-01-21T08:00:00-08:00
draft = false
+++

In my [last post](/posts/deploy-hugo-from-github/), I set up a workflow that allows me to make changes to my website in a local git repository, push it [to GitHub](https://github.com/anson-vandoren/ansonvandoren.com.git), and have my remote server build the static content with Hugo and serve up the changes. On the remote server, I handled the GitHub hooks through a small Golang server called `webhook`, but wasn't really happy with needing to open up a separate port (it defaults to 9000) on my server firewall. In the grand scheme of things, it probably doesn't matter much from a security standpoint, but I thought I could do a bit better and learn something in the process of configuring Nginx to proxy the requests through HTTPS.

When I set up my website, I had already used [Let's Encrypt](https://letsencrypt.org/) to enable HTTPS by default. As part of that process, I used the `certbot` tool they provide to automatically modify my Nginx server block configuration, but now I needed to go back and modify them by hand.

## Starting configuration

**Firewall status**

At the end of the last post, I had port 9000 open through ufw to enable the webhooks server:

```shell
$ sudo ufw status
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
9000                       ALLOW       Anywhere
OpenSSH (v6)               ALLOW       Anywhere (v6)
Nginx Full (v6)            ALLOW       Anywhere (v6)
9000 (v6)                  ALLOW       Anywhere (v6)
```

**Nginx configuration**

My starting Nginx configuration looked like this, based on [these instructions](https://www.digitalocean.com/community/tutorials/how-to-set-up-nginx-server-blocks-virtual-hosts-on-ubuntu-16-04) and what Certbot changed:
```shell
server {
    # Redirect www to non-www. Hugo doesn't like subdomains
    if ($host = www.ansonvandoren.com) {
        return 301 https://ansonvandoren.com$request_uri;
    }

    root /var/www/ansonvandoren.com/html;
    index index.html index.htm index.nginx-debian.html;
    server_name www.ansonvandoren.com ansonvandoren.com;

    location / {
        try_files $uri $uri/ =404;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/ansonvandoren.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/ansonvandoren.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    # Redirect to HTTPS (and also redirect www to non-www)
    if ($host = www.ansonvandoren.com) {
        return 301 https://ansonvandoren.com$request_uri;
    } # managed by Certbot

    # Redirect to HTTPS
    if ($host = ansonvandoren.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name ansonvandoren.com www.ansonvandoren.com

    return 404; # managed by Certbot
}
```
Actually, it was quite a bit messier than that when I first looked, but I did some cleanup and rearranging through trial and error until I got things looking the way I wanted.

**webhooks server**

My `webhooks` server was listening on 0.0.0.0, port 9000

**GitHub configuration**

My website repo on GitHub had a webhook set up with:

- Payload URL: http://ansonvandoren.com:9000/hooks/redeploy
- Content type: application/json
- Enable SSL verification turned on
- Triggering event set to 'Just the push event'

## What I wanted instead
I had two main things I wanted to accomplish with these changes:

1. Close port 9000 on `ufw`
2. Change my **Payload URL** on GitHub to use HTTPS (and not require port 9000)

## How I did it
In hindsight, this was actually not a difficult problem to solve, but it did take quite a bit of trial and error, and I couldn't find any examples that accomplished exactly what I was looking for.

**Close the firewall port**

Since I'm the only one pushing commits to the website repo, I won't be interrupting anything if I close the port now.
```shell
$ sudo ufw delete allow 9000
Rule deleted
Rule deleted (v6)
$ sudo ufw status
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
OpenSSH (v6)               ALLOW       Anywhere (v6)
Nginx Full (v6)            ALLOW       Anywhere (v6)
```
So far, so good...

**Add Nginx proxy**

This took me the most time to sort out, but it's relatively simple.
```shell
$ sudo vim /etc/nginx/sites-available/ansonvandoren.com
```
In my first server block (the one listening on 443), I added the highlighted lines below
```sh {hl_lines=["11-14"]}
server {
    # Redirect www to non-www. Hugo doesn't like subdomains
    if ($host = www.ansonvandoren.com) {
        return 301 https://ansonvandoren.com$request_uri;
    }

    root /var/www/ansonvandoren.com/html;
    index index.html index.htm index.nginx-debian.html;
    server_name www.ansonvandoren.com ansonvandoren.com;

    # Forward webhook requests
    location /hooks/ {
        proxy_pass http://127.0.0.1:9000/hooks/;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/ansonvandoren.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/ansonvandoren.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    # Redirect to HTTPS (and also redirect www to non-www)
    if ($host = www.ansonvandoren.com) {
        return 301 https://ansonvandoren.com$request_uri;
    } # managed by Certbot

    # Redirect to HTTPS
    if ($host = ansonvandoren.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name ansonvandoren.com www.ansonvandoren.com

    return 404; # managed by Certbot
}
```

Simple, right? If any web requests come in over HTTPS on the /hooks path, they get proxied to localhost:9000, which is where the webhooks server is already listening.

**Update GitHub**

Almost done, and just need to let my GitHub webhook know about the changes. Back on the same settings page, I just needed to change the Payload URL to:

- Payload URL: https://ansonvandoren.com/hooks/redeploy

To prevent you needing to scroll back up, I just removed the ':9000' port identifier, and changed the http:// to https://

### Testing it out

To make sure everything worked after my changes, I made some edits to my site locally, committed them, and pushed to GitHub.

The webhook service looks good:
```shell
$ systemctl --user status webhook
● webhook.service - Simple Golang webhook server
   Loaded: loaded (/home/bloguser/.config/systemd/user/webhook.service; enabled; vendor preset: enabled)
   Active: active (running) since Mon 2019-01-21 00:40:37 UTC; 1h 40min ago
 Main PID: 851 (webhook)
   CGroup: /user.slice/user-1000.slice/user@1000.service/webhook.service
           └─851 /usr/local/bin/webhook -ip 127.0.0.1 -hooks /opt/hooks/hooks.json -verbose

Jan 21 01:22:00 ansonvandoren webhook[851]:   Pages            | 20
Jan 21 01:22:00 ansonvandoren webhook[851]:   Paginator pages  |  0
Jan 21 01:22:00 ansonvandoren webhook[851]:   Non-page files   |  0
Jan 21 01:22:00 ansonvandoren webhook[851]:   Static files     |  5
Jan 21 01:22:00 ansonvandoren webhook[851]:   Processed images |  0
Jan 21 01:22:00 ansonvandoren webhook[851]:   Aliases          |  7
Jan 21 01:22:00 ansonvandoren webhook[851]:   Sitemaps         |  1
Jan 21 01:22:00 ansonvandoren webhook[851]:   Cleaned          |  0
Jan 21 01:22:00 ansonvandoren webhook[851]: Total in 99 ms
Jan 21 01:22:00 ansonvandoren webhook[851]: [webhook] 2019/01/21 01:22:00 [0fa3ba] finished redeploy
```

A quick check of the webpage shows the changes propagated correctly. Success!
