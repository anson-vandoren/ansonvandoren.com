+++
title = "Building a Robinhood app with Go - Part 1"
description = "Creating a simple Go web server"
tags = ["go", "web", "robinhood"]
date = 2019-11-30T12:30:51-08:00
draft = true
+++

## Create a basic Go server
Create a new folder for the project wherever you'd like, and then create a new file called `main.go` and open it in your favorite editor (which should be vim).

```go
// main.go
package main

import (
	"fmt"
	"net/http"
)

func main() {
	fmt.Println("Starting Robinhood portfolio app")
	// create multiplexer to handle incoming requests
	mux := http.NewServeMux()

	// handle route for page index
	mux.HandleFunc("/", index)

	// configure and start the server using the multiplexer defined above
	// and some reasonable default values
	server := &http.Server{
		Addr:    "127.0.0.1:8081",
		Handler: mux,
	}
	server.ListenAndServe() // serve until stopped
}
```

This code creates a multiplexer that will listen on 127.0.0.1 (port 8081) and call a handler function based on the URL path that should generate a response that is sent back to the client.

## Write the first handler function

Create a new file called `route_main.go` to hold the handler function called above

```go
// route_main.go
package main

import (
	"html/template"
	"net/http"
)

// generate and serve the main page
func index(w http.ResponseWriter, r *http.Request) {
	file := "templates/layout.html"
	// parse the template and panic if parsing fails
	templates := template.Must(template.ParseFiles(file))
	// execute the template named "layout" with no input data, and write
	// the executed template to the http.ResponseWriter
	templates.ExecuteTemplate(w, "layout", nil)
}
```

The handler function takes an argument for a response writer, and a pointer to a HTTP request. To allow for more complex HTML generation later on, I am using the `html/template` library to start with, even though there is no dynamic content yet. I will need to define a template in the next step, but for now I am simply passing a filename to parse, and then calling the Execute method on the parsed template which will use the response writer to send back a fully-formed HTML document to the client.

## Create a HTML template

1. Create a new folder in the project root called `templates`
2. Create a new file in this folder called `templates/layout.html`

```go-html-template
<!-- templates/layout.html -->
{{ define "layout" }}

<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device=width, initial-scale=1" />
        <title>Robinhood Portfolio</title>
    </head>
    <body>
        Robinhood Portfolio app
    </body>
</html>

{{ end }}
```

This is a Go HTML template file. The terms inside `{{ }}` are evaluated by the template engine. For this starting example, there's not much going on here other than I am defining that the HTML inside the `define` and `end` tags describe a templated called `layout`. The importance of this will become clear when I add more content later on. For now, you can read it as just a normal HTML file with simple head and body sections.

## Run the server and test

From the project root, run `go run .` to start the server. In a browser, navigate to `http://127.0.0.1:8081` and you should see this:

{{< figure src="/images/gorobinhood_part_1_browser_test.png#center" >}}

## Recap

So far this isn't all that exciting; there are far easier ways to do what I have so far. But this is a good starting point for a full-featured web app, and I'll build on it in the remainder of the series.

-------------

Next: [Building a Robinhood app with Go - Part 2](/posts/gorobinhood-part2)

Code: [https://github.com/anson-vandoren/gorobinhood/tree/part_1](https://github.com/anson-vandoren/gorobinhood/tree/part_1)

Found a problem with this post? Submit a PR to fix it at [https://github.com/anson-vandoren/ansonvandoren.com/content/posts/gorobinhood-part1.md](https://github.com/anson-vandoren/ansonvandoren.com/content/posts/gorobinhood-part1.md)