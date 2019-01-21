+++ 
draft = false
date = 2019-01-20T09:48:00-08:00
title = "Deploying a Hugo site on a GitHub commit"
description = "Exploring webhooks"
slug = "" 
tags = ["GitHub", "Hugo", "Webhooks"]
categories = []
externalLink = ""
+++

### Doing things the hard way

I recently helped my brother get his first website up and running. After a bit of research, we decided on static HTML, served via [Caddy](https://caddyserver.com/) on a [Digital Ocean](https://digitalocean.com) droplet. The choice of Caddy was predominantly due to its built-in hooks that would allow him to maintain his website as a GitHub repo, and have it automatically update every time he pushed a commit.

When redesigning my website yesterday, I should have done the same thing, since our use-cases are pretty similar. But I didn't... Instead, I ended up with:

- Digital Ocean droplet
- Nginx serving content
- [Let's Encrypt](https://letsencrypt.org/) to avoid the 'Not Secure' message in the URL bar
- [Hugo](https://gohugo.io) static site generator (so I can use Markdown!)

So now I'm left needing to figure out a way to implement the following workflow:

1. Make a change, or add a new blog post locally. Commit the change locally and push to GitHub.
2. Magically have my website update to reflect the new content.

Ideally, I want it to be as simple as that. My first implementation ([based on this guide](https://www.digitalocean.com/community/tutorials/how-to-deploy-a-hugo-site-to-production-with-git-hooks-on-ubuntu-14-04)) was more complicated, and involved setting a remote repo on my server that I could push to (in addition to GitHub). I don't like this solution because:

1. It involves an extra step, and means I need to maintain two separate remote repos.
2. It makes it more likely that I'll forget to push to GitHub as well, so when my server inevitably dies due to neglect or freak accident, I may not have a solid backup.

This is still a workable solution, but I want it to be as streamlined as possible. In hindsight, I should have just used Caddy ([with this awesome tutorial](https://www.digitalocean.com/community/tutorials/how-to-host-a-website-with-caddy-on-ubuntu-16-04)), but sometimes I like doing things the hard way.

### What I need

1. A GitHub webhook set up to monitor a [PushEvent](https://developer.github.com/v3/activity/events/types/#pushevent) and send that along to my server.
2. Nginx to receive the POST event from GitHub and forward it to an internal listener of some sort.
3. Internal listener to run a shell script that will:
    - Fetch the latest commit from GitHub to a working directory
    - Run Hugo to build static content based on the new commit
    - Copy Hugo output to the appropriate folder that Nginx is serving

Easy, right?

### How I finally solved it

###### Setting up webhook

The go-to (pun intended) server for this seems to be [webhook](https://github.com/adnanh/webhook), written in Go by [Adnan Hajdarević](https://github.com/adnanh). I don't have a Golang environment running on the remote and don't really need one for anything else, so the `go get` option wasn't optimal, nor was building from source. The Ubuntu package via `apt-get install webhook` was several versions behind the latest release, so I opted to download the latest released binary instead.

First I had to figure out what architecture I need:
```shell
$ uname -i
x86_64
```
Next, download the correct release (x86_64 version) [from here](https://github.com/adnanh/webhook/releases) and unzip it:
```shell
$ wget https://github.com/adnanh/webhook/releases/download/2.6.9/webhook-linux-amd64.tar.gz
$ tar -xvf webhook*.tar.gz
```
Make the binary available in my environment, and clean up:
```shell
$ sudo mv webhook-linux-amd64/webhook /usr/local/bin
$ rm -rf webhook-linux-amd64*
```
Make sure everything worked:
```shell
$ webhook -version
webhook version 2.6.9
```
`webhooks` needs a hook file (which tells it how to handle incoming requests), and a script that it should run if it matches an incoming request. I made a place for those to live, and transferred ownership to my (non-root) user:
```shell
$ sudo mkdir /opt/scripts
$ sudo mkdir /opt/hooks
$ sudo chown -R $USER:$USER /opt/scripts
$ sudo chown -R $USER:$USER /opt/hooks
```

###### Creating a hook

Next I set up a `hooks.json` file to allow `webhook` to trigger on an incoming GitHub POST. I like vim, but you can use nano or whatever other editor you prefer:
```shell
$ vim /opt/hooks/hooks.json
```
 [The documentation](https://github.com/adnanh/webhook/blob/master/docs/Hook-Definition.md) has more details about available properties, but I'll just show the configuration I ended up using.

 Before doing that, though, I need a secret I can share with GitHub to ensure the hook is only triggered appropriately (i.e., not by someone randomly sending a POST request to the correct endpoint). You can use anything you want as the secret, but one easy way to generate a secret is to run `uuidgen`:
 ```shell
 $ uuidgen
 81febb4d-4483-4fc8-a2dc-8ece300bc5f4
 ```
 This will output a nice long random value that is expected to be unique ([see here for more detail](http://man7.org/linux/man-pages/man1/uuidgen.1.html)). Copy this value, and use it both in the JSON file below, and also when you do the next steps on GitHub. Note that the example below shows "my-github-secret" instead; you'll want to replace this in your version.
```json
[
    {
        "id": "redeploy",
        "execute-command": "/opt/scripts/redeploy.sh",
        "command-working-directory": "/opt/scripts",
        "pass-arguments-to-command":
        [
            {
                "source": "payload",
                "name": "head_commit.message"
            },
            {
                "source": "payload",
                "name": "pusher.name"
            },
            {
                "source": "payload",
                "name": "head_commit.id"
            }
        ],
        "trigger-rule":
        {
            "and":
            [
                {
                    "match":
                    {
                        "type": "payload-hash-sha1",
                        "secret": "my-github-secret",
                        "parameter":
                        {
                            "source": "header",
                            "name": "X-Hub-Signature"
                        }
                    }
                },
                {
                    "match":
                    {
                        "type": "value",
                        "value": "refs/heads/master",
                        "parameter":
                        {
                            "source": "payload",
                            "name": "ref"
                        }
                    }
                }
            ]
        }
    }
]
```
The [GitHub documentation](https://developer.github.com/v3/activity/events/types/) has more details about the different payload parameters for each event type. Basically, the above hook will listen on an endpoint called `redeploy`, and if the `trigger-rule` is satisfied, will run the `redeploy.sh` shell script with arguments from the POST message. This trigger rule will guarantee that it was sent from GitHub (only they have my secret), and the push happened on _master_ branch in my GitHub repo (I don't want to rebuild if the commit was only to a feature/testing branch).

###### Configuring the firewall
Before moving on, I need to make sure my server firewall will allow the hooks through on port 9000:
```shell
$ sudo ufw status
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
OpenSSH (v6)               ALLOW       Anywhere (v6)
Nginx Full (v6)            ALLOW       Anywhere (v6)
```
Right now, I'm only allowing ssh and normal web traffic, so I need to open up port 9000:
```shell
$ sudo ufw allow 9000
Rule added
Rule added (v6)
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
DigitalOcean has a [good primer on ufw](https://www.digitalocean.com/community/tutorials/ufw-essentials-common-firewall-rules-and-commands) if you need more details on configuring a firewall.

_Edit: In the end, I decided to configure Nginx to proxy requests for https://ansonvandoren.com/hooks/ through to my webhooks server instead, and closed port 9000 again. I may write a separate post on that since it wasn't as trivial as I wanted it to be, but the above method works just as well. The basics of what I did were from hints on [this article](https://labs.lacnic.net/a-new-platform-for-lacniclabs/)._

###### Setting up GitHub

1. On the GitHub page for my static site, I navigated to **Settings** > **Webhooks** > **Add Webhook**.
2. For the **Payload URL**, I entered: `http://ansonvandoren.com:9000/hooks/redeploy` 
(where `redeploy` is the id I set up in my hooks.json file).
3. I chose **application/json** for **Content type**, and pasted the secret I generated with uuidgen into the **Secret** field.
4. I left **Enable SSL verification** selected, and for **Which events would you like to trigger this webhook?**, I chose **Just push event**, and then clicked **Add webhook**.

Right away I see a notification icon showing that it failed to deliver, since I haven't actually started the webhook server yet on my remote machine. Once I do, though, GitHub will start sending POST requests every time a commit is pushed to my website repo.

It is possible to set up `webhook` to use HTTPS if you need to, but it's not as straightforward and I don't have a real need to in my case. If you need to do this, check out [this section of the docs](https://github.com/adnanh/webhook#using-https).

_Edit: Using Nginx to proxy requests through to `webhooks` as I did later actually makes it easier to use HTTPS for this, since I already had it set up for my web page thanks to Let's Encrypt. I may write a separate post about setting this up later._

###### Writing the redeploy script

When I created the `hooks.json` file, I pointed it to a script called `/opt/scripts/redeploy.sh`, so now I need to actually write that script.
```shell
$ vim /opt/scripts/redeploy.sh
```
Your needs may vary and you may need to customize this script in different ways than I did, but below should give you some ideas about how to proceed.
```shell
#!/bin/bash -e
# Note the '-e' in the line above. This is required for error trapping implemented below.

# Repo name on GitHub
REMOTE_REPO=https://github.com/anson-vandoren/ansonvandoren.com.git
# A place to clone the remote repo so Hugo can build from it
WORKING_DIRECTORY=$HOME/staging_area
# Location (server block) where Nginx looks for content to serve
PUBLIC_WWW=/var/www/ansonvandoren.com/html
# Backup folder in case something goes wrong during this script
BACKUP_WWW=$HOME/backup_html
# Domain name so Hugo can generate links correctly
MY_DOMAIN=ansonvandoren.com

# For future notifications on Telegram
commit_message=$1
pusher_name=$2
commit_id=$3

# If something goes wrong, put the previous verison back in place
function cleanup {
    echo "A problem occurred. Reverting to backup."
    rsync -aqz --del $BACKUP_WWW/ $PUBLIC_WWW
    rm -rf $WORKING_DIRECTORY
    # !!Placeholder for Telegram notification
}

# Call the cleanup function if this script exits abnormally. The -e flag
# in the shebang line ensures an immediate abnormal exit on any error
trap cleanup EXIT

# Clear out the working directory
rm -rf $WORKING_DIRECTORY
# Make a backup copy of current website version
rsync -aqz $PUBLIC_WWW/ $BACKUP_WWW

# Clone the new version from GitHub
git clone $REMOTE_REPO $WORKING_DIRECTORY

# !!Placeholder for Telegram notification

# Delete old version
rm -rf $PUBLIC_WWW/*
# Have Hugo generate the new static HTML directly into the public WWW folder
/usr/local/bin/hugo -s $WORKING_DIRECTORY -d $PUBLIC_WWW -b "https://${MY_DOMAIN}"

# !!Placeholder for Telegram notification

# Clear out working directory
rm -rf $WORKING_DIRECTORY
# Exit without trapping, since everything went well
trap - EXIT
```
With the comments, I think most of that should be clear enough. There's some additional material on bash error trapping (it was brand new to me) that [can be found here](http://redsymbol.net/articles/bash-exit-traps/).

The script needs to be executable so the hook can run it:
```bash
$ chmod +x /opt/scripts/redeploy.sh
```

I wanted to make sure the script ran OK before moving on:
```bash
$ bash /opt/scripts/redeploy.sh
Cloning into '/home/blog/staging_area'...
remote: Enumerating objects: 155, done.
remote: Counting objects: 100% (155/155), done.
remote: Compressing objects: 100% (125/125), done.
remote: Total 155 (delta 21), reused 145 (delta 11), pack-reused 0
Receiving objects: 100% (155/155), 620.23 KiB | 7.13 MiB/s, done.
Resolving deltas: 100% (21/21), done.

                   | EN
+------------------+----+
  Pages            | 15
  Paginator pages  |  0
  Non-page files   |  0
  Static files     |  5
  Processed images |  0
  Aliases          |  5
  Sitemaps         |  1
  Cleaned          |  0

Total in 47 ms
```
###### Testing with webhooks
Everything looks good, and the website is still working. Let's try a real test by running webhooks:
```shell
$ webhook -hooks /opt/hooks/hooks.json -verbose
[webhook] 2019/01/20 21:46:23 version 2.6.9 starting
[webhook] 2019/01/20 21:46:23 setting up os signal watcher
[webhook] 2019/01/20 21:46:23 attempting to load hooks from /opt/hooks/hooks.json
[webhook] 2019/01/20 21:46:23 found 1 hook(s) in file
[webhook] 2019/01/20 21:46:23 	loaded: redeploy
[webhook] 2019/01/20 21:46:23 serving hooks on http://0.0.0.0:9000/hooks/{id}
[webhook] 2019/01/20 21:46:23 os signal watcher ready
```
Now, from my local machine, I'll create a test commit and push to GitHub
```shell
$ git commit --allow-empty -m "Trigger test"
[master eb3fdc6] Trigger test
$ git push origin master
Enumerating objects: 1, done.
Counting objects: 100% (1/1), done.
Writing objects: 100% (1/1), 197 bytes | 197.00 KiB/s, done.
Total 1 (delta 0), reused 0 (delta 0)
To github.com:anson-vandoren/ansonvandoren.com.git
   c12a30d..eb3fdc6  master -> master
```
It worked! Here's the output from webhooks back on the remote machine:
```shell
[webhook] 2019/01/20 21:46:34 [dfa235] incoming HTTP request from 192.30.252.37:39834
[webhook] 2019/01/20 21:46:34 [dfa235] redeploy got matched
[webhook] 2019/01/20 21:46:34 [dfa235] redeploy hook triggered successfully
[webhook] 2019/01/20 21:46:34 200 | 1.222118ms | ansonvandoren.com:9000 | POST /hooks/redeploy
[webhook] 2019/01/20 21:46:34 [dfa235] executing /opt/scripts/redeploy.sh (/opt/scripts/redeploy.sh) with arguments ["/opt/scripts/redeploy.sh" "Trigger notification5" "anson-vandoren" "4a1...7a2"] and environment [] using /opt/scripts as cwd
[webhook] 2019/01/20 21:46:35 [dfa235] command output: Cloning into '/home/blog/staging_area'...
Building sites …
                   | EN
+------------------+----+
  Pages            | 15
  Paginator pages  |  0
  Non-page files   |  0
  Static files     |  5
  Processed images |  0
  Aliases          |  5
  Sitemaps         |  1
  Cleaned          |  0

Total in 40 ms

[webhook] 2019/01/20 21:46:35 [dfa235] finished handling redeploy
```
###### Adding webhooks as a service

Since I'll be running this on a remote machine, I want to set it up as a systemd service so it will come back up if the server reboots for any reason. It took me a while to settle on the "right" way to do this one, but I think this should work well.

First, I need to create a service file as my non-root user, in the home directory as shown below. Again, you can use nano if you're not comfortable with vim.
```shell
$ vim ~/.config/systemd/user/webhook.service
```
The contents of this file should look similar to this:
```shell
[Unit]
Description=Simple Golang webhook server
ConditionPathExists=/usr/local/bin/webhook
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/blog
ExecStart=/usr/local/bin/webhook -ip 127.0.0.1 -hooks /opt/hooks/hooks.json -verbose
Restart=on-failure
PrivateTmp=true

[Install]
WantedBy=default.target
```
For a complete descriptions of the sections of a service file, you can check out [this documentation](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/system_administrators_guide/sect-managing_services_with_systemd-unit_files) from RedHat.

Next I needed to ensure that my non-root user (shown below as 'myuser', but substitute whatever login you are using for this) could keep a process running even when not logged in. After enabling 'lingering', I enabled my new service and started it.
```shell
$ sudo loginctl enable-linger myuser
$ systemctl --user enable webhook
$ systemctl --user start webhook
```
Everything should be working correctly now, so I ran another empty commit/push from my local machine, and then checked the status of the service:
```shell
blog@ansonvandoren:~$ systemctl --user status webhook
● webhook.service - Simple Golang webhook server
   Loaded: loaded (/home/blog/.config/systemd/user/webhook.service; enabled; vendor preset: enabled)
   Active: active (running) since Mon 2019-01-21 00:34:03 UTC; 50s ago
 Main PID: 20422 (webhook)
   CGroup: /user.slice/user-1000.slice/user@1000.service/webhook.service
           └─20422 /usr/local/bin/webhook -ip 127.0.0.1 -hooks /opt/hooks/hooks.json -verbose

Jan 21 00:34:49 ansonvandoren webhook[20422]:   Pages            | 15
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Paginator pages  |  0
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Non-page files   |  0
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Static files     |  5
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Processed images |  0
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Aliases          |  5
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Sitemaps         |  1
Jan 21 00:34:49 ansonvandoren webhook[20422]:   Cleaned          |  0
Jan 21 00:34:49 ansonvandoren webhook[20422]: Total in 53 ms
Jan 21 00:34:49 ansonvandoren webhook[20422]: [webhook] 2019/01/21 00:34:49 [67d5a4] finished handling
```

It worked! Just to make sure (I'm a little paranoid), I rebooted my remote machine, and checked again when it came back up. Everything worked as advertised, and webhook is running again, waiting for my next git commit.

The only thing I still need to set up is the Telegram notifications for build/deploy status. This post is long enough as it is, and that's almost an entirely separate topic, so I'll leave that for (maybe) another post later on.