+++ 
draft = false
date = 2019-02-06T13:15:00-08:00
title = "HMAC signatures for Insomnia requests"
description = "How to write an Insomnia plugin, and a bit about HMAC signing"
slug = "" 
tags = ["API", "Insomnia", "Node", "Plugin"]
categories = []
externalLink = ""
+++

I've been working with the [Binance API](https://github.com/binance-exchange/binance-official-api-docs) recently, and found I was spending too much time making manual [curl](https://curl.haxx.se/) or [requests](http://docs.python-requests.org/en/master/) calls just to see what sort of data I was getting back in order to appropriately process it. It never occurred to me that there might be a better way until I stumbled across the [Insomnia](https://insomnia.rest/) REST client last night.

### Working with APIs with Insomnia

If you haven't worked with Insomnia before, but you do spend a decent amount of time either producing or consuming APIs, go check it out now. If you've used Postman, it's probably not going to blow your socks off, but if you've ever found yourself trying to remember all the curl options just to make a simple request and check out the response, you'll probably love this.

A few minutes after installing it, I had this set up for my Binance work:

{{< figure src="/images/insomnia_client.png#center" link="/images/insomnia_client.png" alt="Insomnia REST client screenshot" >}}

I added a few environment variables that work across all calls (base API URL, API key, API secret, etc.), and then created new endpoints for each of the API calls I need to refer to. I won't go into much more detail here since it's pretty easy to set up and use, but if this looks interesting for your work, definately go check it out!

### Signed requests

This was all well and good until I got the part that I really wanted to do, which was executing API operations like listing account balances and placing trades. Binance uses [HMAC signing](https://blog.andrewhoang.me/how-api-request-signing-works-and-how-to-implement-it-in-nodejs-2/) to confirm sensitive requests come from authorized individuals only. The [Binance API docs](https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md#signed-trade-and-user_data-endpoint-security) have a reasonable amount of information on how to do this, but in my actual code I'm using the [python-binance](https://github.com/sammchardy/python-binance) library to take care of it so I hadn't looked into it much.

Insomnia comes with a few [auth options](https://support.insomnia.rest/article/38-authentication) out-of-the-box, but none of them worked for my case. There are a handful of [Insomnia plugins](https://www.npmjs.com/search?q=insomnia-plugin) available on the NPM registry, but none that worked for what I needed.

### Insomnia plugins

That brings me to the real reason for writing this post, which is so that future-me will remember how I solved this and not re-invent the wheel when I run across this again down the road. The Insomnia docs have a page on [writing plugins](https://support.insomnia.rest/article/26-plugins), but it's not as well documented as it could be.

Basically I had two choices:

- A template tag, which I could reference like an environment variable inside of the client
- A request/response hook that is triggered either just before the request is sent out, or upon receiving a response to a previous request.

My first thought was to write a template tag that I could just put into the signature query parameter which would look at the other parameters, compute the HMAC, and write it out before sending. I would still like to implement it this way, but I ran into a problem relating to how the timestamp tag (an Insomnia built-in) was updating after I computed the hash but before sending the request, which rendered the signature invalid before it was sent off.

Since this didn't seem to be an easy option, I chose instead to write a request hook that looks at all requests, checks whether they are going to Binance, and if so, whether they need to be signed. In the particular case of Binance, I chose to make this second part trigger off whether there was a `timestamp` parameter already included in the query. All of the Binance REST endpoints that need to be signed also require a timestamp, and the other endpoints do not accept one.

The basic structure of my request hook looks like this:

```javascript
// insomnia_plugin_binance_signing.js

module.exports.requestHooks = [
    (context) => {
        // Validate context object
        // Check the URL points to the Binance API
        // Check if a timestamp parameter exists
        // Make sure there is not already a signature parameter
        // Check the API Key is present in the environment variables
        // Set a time window to prevent time-sensitive request from executing late
        // Compose the query string from the request
        // Generate the signature
        // Set the signature
    }
]

```

The first couple of validations are boring, so I won't include them here, but the whole thing [is on GitHub](https://github.com/anson-vandoren/insomnia-plugin-binance-signing) if you're curious. Basically I'm just ensuring the context object exists, it has a `request` property, and that request property has a `getUrl()` method. If any check fails, just return early and do nothing.

Below is the basic implementation, skipping redundant parts. Again, check out the full code if you want more detail.

```javascript
        // Validate context object
        // ... boring stuff...
        
        const req = context.request;
        
        // Check the URL points to the Binance API
        if (!req.getUrl().startsWith("https://api.binance.com")) {
            console.log("Not a Binance API URL.");
            return;
        }
        
        // Check if a timestamp parameter exists
        if (!req.hasParameter("timestamp")) {
            console.log("No timestamp parameter, not signing.");
            return;
        }
        
        // Check the API Key is present in the environment variables
        const key = req.getEnvironmentVariable('api_secret');
        if (key == null) {
            throw new Error("Cannot find environment variable 'api_secret'");
        }
        
        console.log('Generating request signature...');
        
        // The message to be signed for Binance API is the query string
        const message = computeSigningBase(req);
        // Use crypto-js library to compute the hash
        const signature = computeHttpSignature(message, key);
        
        // Set the signature parameter on the outgoing request
        req.setParameter('signature', signature);
        
        console.log('Signature appended to outgoing request');
        
```

The context object doesn't provide the query string directly, but it can be generated easily:

```javascript
function computeSigningBase(req) {
    const paramObj = req.getParameters();
    
    var params = [];
    for (const p of paramObj) {
        params.push(`${p.name}=${p.value}`);
    }
    return params.join("&");
}
```

The hash function is straightforward from the crypto-js library:

```javascript
const CryptoJS = require('crypto-js');

function encodeURL(str) {
    return str.replace(/\+/g, '-').replace(/\//g, '_');
}

function computeHttpSignature(msg, key) {
    const hash = CryptoJS.HmacSHA256(msg, key);
    return encodeUrl(CryptoJS.enc.Hex.stringify(hash));
```

### Using the plugin

Once I was happy with how things worked, I wrote up a basic `package.json` file and published to the NPM registry as `insomnia_plugin_binance_signing`. Insomnia has a plugin manager that will search NPM packages and automatically install from there. Once it loads the plugin (for a response/request hook), it will automatically apply that plugin to all incoming/outgoing messages, so there's nothing special I need to do in my setup after this.

Had I went with a template tag, the only additional step would have been to add the tag into the correct spot in the request GUI.

I don't have the rest of the signed endpoints set up yet, but the ones I have tried work perfectly now. If any request includes the timestamp parameter already (using the Insomnia built-in), it will be signed on its way out.

{{< figure src="/images/insomnia_signed_request.png#center" link="/images/insomnia_client.png" alt="Insomnia REST client screenshot" >}}