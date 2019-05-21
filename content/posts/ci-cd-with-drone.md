+++ 
draft = false
date = 2019-05-20T19:00:00-07:00
title = "Setting up a CI/CD pipeline with Drone.io"
description = ""
slug = "ci-cd-with-drone" 
tags = ["DigitalOcean", "Drone.io", "Docker"]
categories = ["DevOps", "Testing"]
externalLink = ""
+++

# What I wanted to accomplish

A side project I'm working on recently gained a few other contributors, and I started looking for a good CI/CD solution. There were basically two things I wanted to accomplish with this:

- When a pull request was opened, I wanted to easily see the results of the tests with the proposed changes. This helps me when reviewing the PR (I don't need to pull the new branch locally to run the tests), and also gives feedback to the other contributors in case they didn't run the tests locally.
- With more contributors comes more eventual commits to master, which means more manual deploys of the new code to the production server. My deploy strategy to this point had been SSH-ing into the server, running a `git pull`, and then rebuilding Docker images and restarting Docker containers with the new code.

# What options I considered

- I've used [Travis](https://travis-ci.com) as the CI/CD server for other projects, and was generally pretty happy with it, but it's only free for open source projects (this one isn't). The cheapest paid plan on Travis is $69/month, and since this project isn't revenue-generating (yet, at least), I really wanted to minimize costs.
- I looked into other fully-hosted solutions (CircleCI, Appveyor, Codeship, Semaphore, ...) and the pricing plans are roughly the same as Travis: free for open source, >$50/month for cheapest paid plan.
- I considered TeamCity (since I'm generally a fan of the JetBrains IDEs), which is free and self-hosted, but it's closed-source, seems a bit of an afterthought for JetBrains, and doesn't seem to have much community traction or support. I may be wrong about some of that, but I wasn't impressed enough to give it a shot.
- Jenkins seemed to fit the bill: free and open source, good community support, actively developed, and lots of information on setup. I spent a few days trying to get this up and running, but eventually decided against it because:
  - There is too much configuration needed just to get a basic working pipeline. I'm looking for a solution that is easy to set up; it doesn't need to work exactly out-of-the-box, but I don't want to spend days poring through documentation just to get a simple setup working.
  - It doesn't support Docker without plugins. My project is completely container-based, but Jenkins is really designed around more traditional, compiled-to-executable type workflows. There are plugins I could use to make this work, but I'd rather a solution that actually fits my needs.
  - Jenkins is not lightweight. This isn't necessarily a bad thing, and is probably a result both of being built with Java and also being a mature product that does a ton of things out of the box, but in my case I wanted something that would run comfortably on a small-sized server instance, and Jenkins just wasn't happy with the 1GB of RAM I had available there.


# What I finally decided on

Once I have up on Jenkins, I had narrowed my search down to "free, lightweight, self-hosted, open source, container-friendly." There aren't too many CI/CD solutions in that space right now, and the first one I came across, via a [great post](https://angristan.xyz/host-your-own-ci-cd-server-with-drone/) by Stanislas Lange (aka [_angristan_](https://github.com/angristan)) was [Drone](https://drone.io).

Although I'd never heard of Drone before, a little digging showed it was a well-maintained, active project with a lot of community support around it (and 18,000 stars on GitHub). The setup looked pretty simple, it was supposedly very light-weight, and the pipeline syntax looked easy to learn.

The only real downside I've found (and I didn't realize this until I'd already jumped in feet-first) is that the 1.0 version was recently released, which brought some significant changes (for the better), but most of the documentation/blog posts/StackOverflow answers out there relate to the old 0.8 version, meaning it took longer to find the information I needed.

# The good part... how to setup Drone.io

### Server provisioning

I already use [Digital Ocean](https://www.digitalocean.com) for other projects (including this blog) and have been very happy with them, so that was an easy choice to make. I spun up a $5/month Ubuntu droplet and installed Docker, Docker Compose, and Nginx, and set up a non-root user and configured the `ufw` firewall to allow SSH and HTTPS traffic. I also used [Let's Encrypt](https://letsencrypt.org) to get a free TLS certificate.

I had been looking for a project to try out the Python [Fabric](http://www.fabfile.org) library on, so I spent some time scripting out the steps required to go from new droplet to something usable to save time in the future. There's probably easier/better ways to do this, but this worked well for me. You can [take a look](https://github.com/anson-vandoren/up-digitalocean), fork, and modify for your own needs if you like.

### Installing Drone

Moving on to actually installing Drone, I found the official documentation informative, but not really enough to complete the process. It didn't help that I accidentally started with the instructions for version 0.8 (even though I was using 1.0), and that much of the information elsewhere around the web also deals with the older version. Eventually I got things running using Docker Compose like so:

{{< gist anson-vandoren d1abca7d5bf56d957e86bca93639ca2c >}}

This loosely follows the recommended ["multi-machine" installation for GitHub](https://docs.drone.io/installation/github/multi-machine/) from the official documentation. **Make sure you follow the prerequisite steps from the official docs** to get the right values to fill in here.

Of note:

- I am mounting the docker socket from the host machine into both containers to avoid needing to run Docker-in-Docker.
- The server also gets a volume mounted from the host to store build information and configuration.
- Both containers are set to always restart so that I can reboot the droplet without needing to worry about manually restarting Drone.
- The drone-server is listening on external port 8080, and remapping that to internal container port 80. My Nginx configuration is reverse-proxying :80/:443 traffic onto this port since I had already set up my TLS certificates. I think the easier way would have been to let Drone handle the TLS certs by itself (it's supposed to be able to do this), and then I shouldn't have needed a fronting Nginx at all. I may test that idea out later, but things are working for now and I don't want to reconfigure.
- The `DRONE_AGENTS_ENABLED=true` variable allows me to set up one or more build agents instead of having drone-server also run the builds. For now, I only have a single build agent set up, but this gives me the flexibility to add more in the future if needed.
- I turned on the logging options to work out some initial kinks, and just left them on until I'm sure everything is stable.
- If you don't do any user creation in this configuration, you'll still be able to login through your GitHub OAuth app you set up, but you won't be an administrator. I needed to be able to run my build script in 'trusted mode' (more on that later), so I created myself as a admin user here.

After getting this and my Nginx configuration set up, I was able to point my browser to the server URL and login with my GitHub credentials. After login, a list of all my repositories shows up, and I activated the one I wanted to create a pipeline for.

### Repository settings

There were only two settings I needed to configure for my repository:

- Make the repository "trusted" so that I could mount external volumes during my build script. I needed to mount volumes for two reasons:
  - I am using Cypress for my end-to-end tests on the project, and while there are a few different ways to make that work, the easiest I found was to build a Docker container as part of the build script that mounted my tests inside a Cypress image. To build a docker image within a Drone pipeline, I needed to mount the Docker socket from the host.
  - To speed up my pipeline, I wanted to be able to cache libraries for both Node and Python/pip. More details on how I did that in the section below, but this step (which again requires mounting a host volume) cut my build/test/deploy time from ~7 minutes down to 1.5 minutes. There are some Drone plugins that can do the caching for you, but they also require the "trusted" setting, and I think they're overkill for a fairly simple task.
- **There are security implications to running in trusted mode, especially for a public repo or where you don't trust everyone who may have access to your CI/CD server.** Make sure you understand the risks before enabling this setting.

### Pipeline script

Prior to setting up Drone, I had run my tests locally using a bash script that sequentially performed front-end tests, back-end tests, and e2e tests. The back-end and e2e tests both also required a database to be up and running, and to this point I had been running all tests inside Docker containers. I could've kept my test script as the shell script, but instead I chose to split it out into separate parts using the .drone.yml file format. This also allowed me to take advantage of running the database as a background service during the tests.

Since this is what many of you are probably still reading this post to see, I'll just get it out there:

{{< gist anson-vandoren 03234a231e9af533aa0bad9ff2d2b58f >}}

Some notes:

- This is the v1.0 syntax for the .drone.yml file, and it looks different than many of the examples you will see around (at least as of early 2019). v0.8 files won't work with v1.0 Drone engine, and vice versa (hopefully obviously...)
- I have two named pipelines, and the second one is set up to only run if the first is successful. The ordering in the file doesn't matter, only the `depends_on` and `trigger` sections of the second pipeline.
- Running Jest tests (via `npm test` or `yarn test`) on my React front-end requires the `CI=true` environment variable, otherwise it will start the file watcher and never exit even if successful.
- You can see how I mounted in a cache directory for both Node and Python to avoid needing to re-download and re-build dependencies. This was a huge time-saver, and was just as easy to do it this way as to use the drone-cache plugin that is recommended in many places.
- The Python tests are making use of the Postgres database I started as a service in the first pipeline.
- There's a Telegram notification (with a format I totally [ripped off](https://angristan.xyz/setup-telegram-bot-for-drone-ci-cd-builds/) from Angristan... thanks!). His post is a little light on how to set up the Telegram bot, but you can check out [my other article](https://ansonvandoren.com/posts/telegram-notification-on-deploy/) to walk you through that.
- There is probably several better ways to do the deployment step than what I came up with, but this one works for me. Basically, I'm just starting a Python container and installing Fabric, then using a Fabfile I had already created to SSH into the production server, do a `git pull` from master, and rebuild images and restart containers. Most of the other solutions I found either required a private Docker registry (possible, but more work), a paid Docker Hub plan (trying to minimize costs), or some Docker Machine setup that would've required redoing a lot of work on my production server. All that to say I'm not advertising this as the 'right' way to do things necessarily... If you're curious how I have the Fabfile setup, let me know in the comments.


# Testing things out

At this point, everything was working in theory, and pushing a commit to a PR on GitHub was triggering builds for both the PR branch, and also testing against a merge to master.

I ended up spending quite a bit of time trying to get my Cypress tests to pass on the CI server. Apparently I'm not the only one that has problems with flaky Cypress tests, but I did spend the time to try to eliminate the root causes instead of just allowing huge timeouts. Cypress has some pretty good tips on avoiding flaky tests on their website.

If you've set up a Drone server and see things I could've done better, or if you have questions about any specifics, please let me know in the comments.