+++ 
draft = false
date = 2019-02-23T18:20:35-08:00
title = "Getting Telegram notifications from Travis CI"
description = "Carrying on further with Telegram bot notifications"
slug = "" 
tags = ["Travis", "Continuous Integration", "Telegram"]
categories = []
externalLink = ""
+++

I'm working through an [interesting mini-course](https://testdriven.io/courses/microservices-with-docker-flask-and-react/) on building microservices with Docker, Flask, and React, and had set up [Travis CI](https://travis-ci.com/) to build and test the services as I went. About halfway through the course, the builds started getting very time-consuming, and at times I needed to wait for a Travis job to complete before moving on to the next step, especially once I started using it to deploy containers to AWS.

Travis doesn't offer any out-of-the-box Telegram notification option, but after setting up my blog redeploy hook to notify me, it seemed like an easy job to duplicate here. I'm not going to repeat the steps for getting a Telegram bot set up (see [this post ](http://ansonvandoren.com/posts/telegram-notification-on-deploy/) for instructions), but just explain how to make it work for Travis in particular.

#### Set up on Travis

I didn't want to put my plaintext Telegram API credentials into my .travis.yml file or anything else I was committing to a public repo, so the two options are either to encrypt them in the build script, or else set them as a Travis environment variable. More information about the two options can be found in the [Travis documentation](https://docs.travis-ci.com/user/environment-variables/), but since I can use the same script for all builds/stages/versions, I chose to go with environment variables.

To create the environment variables, I navigated to my repo on and clicked "More Options > Settings", then scrolled down to the "Environment Variables" section. I added two variables, `TELEGRAM_CHAT_ID` and `TELEGRAM_TOKEN`.

{{< figure src="/images/travis_env_var.png#center" caption="Setting Travis environment variables" >}}

#### Modify the Travis configuration file

Next I added an `after_script` step to my .travis.yml file:
```yaml
after_script:
  - bash ./telegram_notification.sh
```

#### Write the Telegram script

I created a bash script in my project's root folder and saved it as `telegram_notification.sh`:

```shell
#!/bin/sh

BOT_URL="https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage"

if [ $TRAVIS_TEST_RESULT -ne 0 ]; then
    build_status="failed"
else
    build_status="succeeded"
fi

send_msg () {
    curl -s -X POST ${BOT_URL} -d chat_id=$TELEGRAM_CHAT_ID \
        -d text="$1" -d parse_mode="Markdown"
}

send_msg "
-------------------------------------
Travis build *${build_status}!*
\`Repository:  ${TRAVIS_REPO_SLUG}\`
\`Branch:      ${TRAVIS_BRANCH}\`
[Job Log here](${TRAVIS_JOB_WEB_URL})
--------------------------------------
"
```

And that's it! Not too much different from the first time around, but I did learn more about writing shell scripts, and how Travis handles environment variables. I also opted to go with Markdown instead of HTML formatting this time, mostly because I liked how it looked better in my script. The formatting options are pretty much the same either way. Note that the back-tick (`) is reserved in bash, so it needs to be escaped.

There are a lot more [baked-in variables](https://docs.travis-ci.com/user/environment-variables/#default-environment-variables) I could have used, but these gave me what I was looking for. Based on what Google turned up when I was looking for a built-in way to do this, I'm far from the only person wishing that Travis had this notification already implemented, but it's not too difficult to set up anyway.