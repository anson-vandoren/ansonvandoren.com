+++ 
draft = false
date = 2019-01-20T16:00:00-08:00
title = "Telegram Notification on Deploy"
description = "How to set up Telegram bots and use the API to send webhook notifications"
slug = "" 
tags = ["Telegram", "Webhooks", "API"]
categories = []
externalLink = ""
+++

I recently [set up webhooks](/posts/deploy-hugo-from-github/) on my web server to receive PUT requests from GitHub whenever I pushed a change to [ansonvandoren.com](https://ansonvandoren.com). It works well, but since it's running as a background service on a remote server, I don't get a lot of detail about its status.

About a year ago, when I first started using [Telegram](https://telegram.org) as my daily-driver chat app (thanks to finally getting fed up with Google cancelling every chat service it's ever invented), I noticed they also offered an API. I immediately thought of several things that could be useful for, but lacked the time and motivation to explore it further.

### What I want to accomplish:

**Current process**

1. Make changes locally, commit to a git repo, and push to GitHub
2. GitHub sends a POST request to my server, which then:
  - Clones the repo locally on the server
  - Builds the static site using Hugo
  - Copies the built content to the public WWW folder
3. If any part of 2. fails, it will roll back to the previous version and log a simple failure message.

**What I want to add**

Integrate with Telegram so that I will get a notification when a build/deploy succeeds, and a failure message otherwise with some indication of what went wrong.

### Where I'm starting from

Here's my current build script:
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
You can see where I stubbed in the places I thought I could hook into Telegram, but so far there's no code or infrastructure behind it.

### Creating a Telegram bot

After some initial research on the [Telegram API documentation](https://core.telegram.org/bots/api), the first step seems to be to create a new bot using the "BotFather". This is a very painless process through the Telegram app, and in a few seconds I was the proud owner of [ansonvandoren_bot](https://t.me/ansonvandoren_bot), and I had my API token (hereafter denoted `<TOKEN>`)

After obtaining the token, I needed to start a chat with the bot so I could get a conversation ID. I don't think it's possible for the bot to initiate a chat (probably a good thing), so I need to take the first step. The BotFather conversation will have a link to start talking with your robotic spawn, or else you can just go to https://t.me/your_new_bot to get redirected.

Getting the chat ID can be done from a browser, but I just used curl
```shell
$ curl https://api.telegram.org/bot<TOKEN>/getUpdates
{"ok":true,"result":[{"update_id":424724792,
..."chat":{"id":123456184,"first_name":"Anson","last_name":"VanDoren",...
```
The `"id"` field here is what I was looking for, and is the identifier for my conversation with the bot. I think it should stay the same over time, but am not 100% sure. I'll come back and update this if it ends up changing later. I'll refer to this field as `<CHAT_ID>` for the rest of this post.

Now that I've got the two key pieces of information, I can try sending a message (scroll right to see the whole thing):
```shell
$ curl -s -X POST https://api.telegram.org/bot<TOKEN>/sendMessage -d chat_id=<CHAT_ID> -d text="The bot speaks!"
```
{{< figure src="/images/telegram-bot-test-message.jpg#center" caption="Sending a test message" >}}


It worked! That should honestly be most of the API functionality I'll need for this little project. The API is actually very robust, and geared toward richer content and interactivity. I will probably come back and explore it later, but this project has a pretty narrow scope.

### Integrating the bot with my build/deploy script

All that's left is to figure out how to work this into my build script. This part can be as basic or complicated as you want. Below is how I decided to get notified:


{{< highlight shell "hl_lines=15-27 40-41 56-58 63-69" >}}
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

# Set up Telegram
TOKEN=INSERT_YOUR_TOKEN_HERE
CHAT_ID=INSERT_YOUR_CHAT_ID_HERE
BOT_URL="https://api.telegram.org/bot$TOKEN/sendMessage"

# Send messages to Telegram bot
function send_msg () {
    # Use "$1" to get the first argument (desired message) passed to this function
    # Set parsing mode to HTML because Markdown tags don't play nice in a bash script
    # Redirect curl output to /dev/null since we don't need to see it
    # (it just replays the message from the bot API)
    # Redirect stderr to stdout so we can still see an error message in curl if it occurs
    curl -s -X POST $BOT_URL -d chat_id=$CHAT_ID -d text="$1" -d parse_mode="HTML" > /dev/null 2>&1
}

commit_message=$1
pusher_name=$2
commit_id=$3

# If something goes wrong, put the previous verison back in place
function cleanup {
    echo "A problem occurred. Reverting to backup."
    rsync -aqz --del $BACKUP_WWW/ $PUBLIC_WWW
    rm -rf $WORKING_DIRECTORY
    
    # Use $? to get the error message that caused the failure
    send_msg "<b>Deployment of ansonvandoren.com failed:</b> $?"
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

send_msg "<i>Successfully cloned GitHub repo for ansonvandoren.com</i>
<code>Message: $commit_message</code>
<code>Pushed by: $pusher_name</code>"

# Delete old version
rm -rf $PUBLIC_WWW/*
# Have Hugo generate the new static HTML directly into the public WWW folder
# Save the output of Hugo to send to Telegram
hugo_response=$(/usr/local/bin/hugo -s $WORKING_DIRECTORY -d $PUBLIC_WWW -b "https://${MY_DOMAIN}")
# Send Hugo response to bot as a fenced code block to preserve formatting
send_msg "<pre>$hugo_response</pre>"

# All done!
send_msg "<b>Deployment successful!</b>"

# Clear out working directory
rm -rf $WORKING_DIRECTORY
# Exit without trapping, since everything went well
trap - EXIT
{{< / highlight >}}

A few things I learned:

- How to pass arguments to a bash function: this is different from 'normal' progrmaming languages in that you don't define what the arguments are, but simply refer to them in sequential order with $1, $2, etc. within the function.
- How to hide the output of a command: `curl... > /dev/null`
- How to redirect error output to stdout: `2>&1`
- How to get the last error message: `$?`.\
_Note: I have not been able to test this yet because I've not seen any errors on deployment. StackOverflow seems pretty convinced it should work, though._
- A limited subset of HTML can be used to format Telegram bot messages. The API documentation lists which are supported. Markdown (an alternative formatting option here) does not work well inside a bash script because the back-ticks mess up the formatting of the script.
- You can save the output of a command to a variable using `variable_name=$(command)`
- To use the full (multi-line) response stored from a command output as above, you need to put it inside double quotes. `$hugo_response` in my example would only show the first line, but `"$hugo_response"` does multi-line.

### Testing it all out

As with previous examples, I created a dummy commit and pushed to GitHub to try it out:
```shell
$ git commit --allow-empty -m "Test commit"
$ git push
```

{{< figure src="/images/telegram-bot-deploy-message.jpg#center" caption="Getting a commit notification!" >}}