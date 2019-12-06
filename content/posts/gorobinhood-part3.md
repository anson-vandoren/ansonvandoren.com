+++ 
draft = true
date = 2019-12-01T14:41:18-08:00
title = "Building a Robinhood app with Go - Part 3"
description = "Adding Postgres for user storage"
slug = "" 
tags = ["go", "web", "robinhood", "authentication", "postgres"]
categories = []
externalLink = ""
series = []
+++

# Adding authentication backend

At the end of the last part, I had created a login form template and added Log In and Log Out links to the navbar, but didn't implement any functionality yet. Recall that the submit button on the login form sends us to the `/authenticate` URL, but there's no handler for that so it just shows the index page right now.

## Doing some cleanup

Before we get started with that, though, we should fix a small problem regarding template execution. As it stands, `renderTemplate()` checks to make sure a template exists, and if it does, it tries to execute the template with the given data. If the data doesn't match what's expected by the template, an error will occur. We're checking for this error and would like to return an error page to the user, but the problem is that the `html/template.ExecuteTemplate()` function is writing to the `http.ResponseWriter` as a stream, so if we get an error partway through there's no way to retrieve what's already been sent back to the client.

One way to get around this is to have `ExecuteTemplate()` write to a buffer instead as an intermediate step. If it completes writing to the buffer and returns no error, then we can write the intermediate buffer to the ResponseWriter at that point. If there is an error, we'll discard the partial response and just send an error message.

Let's make this change in `route_main.go`

```go {hl_lines=[5,"26-37"]}
// route_main.go
package main

import (
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"path/filepath"
)
...
// wrap template.ExecuteTemplate to ensure template exists
func renderTemplate(w http.ResponseWriter, name string, data interface{}) error {
	// on first page request after app load, generate all templates
	if templates == nil {
		generateTemplates()
	}

	// make sure the template exists
	tmpl, ok := templates[name]
	if !ok {
		http.Error(w, "oops, something went wrong", http.StatusInternalServerError)
		return fmt.Errorf("the template '%s' does not exist", name)
	}

	// create intermediate buffer for template writing to catch errors
	buf := &bytes.Buffer{}
	err := tmpl.ExecuteTemplate(buf, "base", data)
	if err != nil {
		// template execution failed for some reason
		http.Error(w, "hmm... Looks like something is broken", http.StatusInternalServerError)
		return fmt.Errorf("Couldn't execute template %s: %s", name, err)
	}

	// execution was OK, so write the response back to client
	buf.WriteTo(w)
	return nil
}
...
```

## Parse login form data

The first step towards authenticating a user for login is getting the email and password they submitted in the form.

**Note:** You should only ever accept username/password (and any other sensitive details) from a user over a secured HTTPS connection, not an unencrypted HTTP like we have right now in the development environment. When I deploy this web server, it will be behind an Nginx reverse proxy that already utilizes HTTPS, so the only unencrypted part is safely inside my production server, but the roundtrip between client and server is fully encrypted. I'll get to how to set this up later on in this series.

### Create a new route
This should be familiar by now, but we'll start in `main.go` to create a new handler:

```go {hl_lines=[5]}
// main.go
...
	mux.HandleFunc("/", index)
	mux.HandleFunc("/login", login)
	mux.HandleFunc("/authenticate", authenticate)
...
```

### Implement a handler

The first two handlers I created only cared about responding to a GET request, but since I didn't check the request method, they would have responded the same to any other HTTP verb like POST or PUT. For this next handler, I specifically want to respond to POST requests only, so I'll redirect all other types back to the login page instead. I'll build the handler step-by-step, so here's the first part with just a basic request type checker:

```go {hl_lines=["10-30"]}
// route_main.go
...
func login(w http.ResponseWriter, r *http.Request) {
	err := renderTemplate(w, "login.tmpl", nil)
	if err != nil {
		logger.Println(err)
	}
}

// POST /authenticate
// try to log a user in given an email address and password
func authenticate(w http.ResponseWriter, r *http.Request) {

	// only POST method is applicable here, redirect others back to login page
	if r.Method != "POST" {
		http.Redirect(w, r, "/login", http.StatusTemporaryRedirect)
		return
	}

	// populate r.PostForm from the request form values
	err := r.ParseForm()
	if err != nil {
		logger.Println("[ERROR]: Could not process login form:", err)
		http.Error(w, "Could not parse login form. Please try again later", http.StatusInternalServerError)
		return
	}

	// check that we got form data back as expected
	logger.Printf("Email: %s, Password: %s\n", r.PostFormValue("email"), r.PostFormValue("password"))
}
```

The new handler:

1. Checks that the request type is POST, and redirects back to login page if not
2. Parses the POST form data and verifies no errors. This step makes the form values available via `r.PostFormValue()` calls
3. Logs the email and password that were entered to verify (for now) that we're on the right track.

Go ahead and reload the server and try entering an email address and password into the login form. Check either the disk or stderr log to make sure you got back what you expected.


## Set up SQLite database

Since I don't have much data to store anywhere in this app, and since I'll be the only user, I'm going to use SQLite since it doesn't require a SQL server set up, it's fully self-contained, and there's no real configuration needed.

Go comes with support for SQL generally, but not for any particular flavor out of the box. There's a few libraries that support SQLite specifically (listed on the [official SQLDrivers wiki](https://github.com/golang/go/wiki/SQLDrivers)), and I chose the one by GitHub user "mattn", which [can be found here](https://github.com/mattn/go-sqlite3)

