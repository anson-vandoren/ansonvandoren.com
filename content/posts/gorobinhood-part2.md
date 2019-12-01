+++ 
draft = true
date = 2019-11-30T13:03:03-08:00
title = "Building a Robinhood app with Go - Part 2"
description = "Adding login capability to a Go web server"
tags = ["go", "web", "robinhood", "authentication"]
slug = "" 
categories = []
externalLink = ""
+++

# Adding a login feature

For my own use, I want this page to be available publicly so I can access it from anywhere. Obviously, I don't want anyone else to be able to access my portfolio, so I'll need a way to securely login. This involves quite a few moving parts, and has potentially serious security implications; so I'm going to do my best to keep things as safe as possible.

Before actually getting into the backend code, though, I'm going to make up a header bar that will eventually have either a login or logout link, depending on my current authentication state. I'll also add a login page with a form for email and password.

## Cleaning up from Part 1

In Part 1, every time a client requested the "/" path, the handler function parsed the template files before rendering them. I may have different data to render on different requests, but I don't expect the template file itself to change while the app is running. Parsing the files each time is a waste, so I'll fix that now by changing the code to only parse a single time, and then use the cached templates after that. At the same time, I'm going to re-write my templates to be more modular so it's easier to add new ones as I go.

The last change for right now is to factor out a function to render a template, given the template name and some associated data.

Re-write `route_main.go` to look like this instead:

```go
// route_main.go
package main

import (
	"fmt"
	"html/template"
	"net/http"
	"path/filepath"
)

var templates map[string]*template.Template

// parse templates into a map by template name
func generateTemplates() {
	// don't parse again if templates have already been generated
	if templates != nil {
		return
	}
	templates = make(map[string]*template.Template)
	templatesDir := "templates/"

	// base is a mostly-bare skeleton from which other pages are generated
	base := templatesDir + "base.tmpl"

	// layouts directory contains full pages based on `base` template
	layouts, err := filepath.Glob(templatesDir + "layouts/*.tmpl")
	if err != nil {
		logger.Fatalln(err)
	}

	// includes are snippets that may be included in one or more layouts
	includes, err := filepath.Glob(templatesDir + "includes/*.tmpl")
	if err != nil {
		logger.Fatalln(err)
	}

	// generate templates for each of the layouts, including their components
	for _, layout := range layouts {
		// parse the base template first so child templates can overwrite as needed
		t := template.Must(template.ParseFiles(base))
		files := append(includes, layout)
		// re-parse using child templates
		templates[filepath.Base(layout)] = template.Must(t.ParseFiles(files...))
	}
}

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
		return fmt.Errorf("The template '%s' does not exist.", name)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	return tmpl.ExecuteTemplate(w, "base", data)
}

func index(w http.ResponseWriter, r *http.Request) {
	err := renderTemplate(w, "index.tmpl", nil)
	if err != nil {
		logger.Println(err)
	}
}
```

The first time `renderTemplate()` is called after starting, it will call `generateTemplates()` to create a map of layout name to fully-parsed template. Each template contains the base template (just a skeleton of a page, which we'll create in a moment), a layout template which is possibly specific for that page (or may be shared between a few pages), and some "includes", or template snippets that are used across many pages.

After the templates have been generated (which won't happen again on subsequent calls to the render function), `renderTemplate()` gets the desired template from the `templates` map and executes the `base` template which has (after parsing) been filled in with all the right component templates for that specific page.


## Nesting templates

In Part 1, I created a single HTML template that was just a basic layout, but no real content. To make use of the parsing and rendering code above, I need to split out my templates a bit more, which will make it easier later to create a new page when I need it.

Let's delete our previous `templates/layout.html` file and create a new base template called `templates/base.tmpl` instead:

__Note:__ from here on out I'll use *.tmpl instead of *.html for template files since they're not (all) actually valid HTML files.

```go-html-template
<!-- templates/base.tmpl -->
{{ define "base" }}

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device=width, initial-scale=1" />
    {{ block "title" . }}
      <title>Robinhood Portfolio</title>
    {{ end }}
  </head>
  <body>
    {{ template "navbar" . }}

    <div class="container">
      {{ template "content" . }}
    </div>
  </body>
</html>

{{ end }}
```

This doesn't look too different from what we had previously in terms of content, but it's laid out in a different way. Here I'm using two Go template actions:

- `block` is like an inline definition of a template. If a child template defines a "title" template, the child's version will be substituted in here; otherwise it will just use "Robinhood Portfolio" as the page title. Note that for this to work, we need to parse the base template before we parse child templates, otherwise the substitution won't happen.
- `template` _requires_ that a definition of a template is provided, and the parser will return a blank document if it cannot find the correct sub-template.

The `.` (referred to as "dot" after this) after the template or block name tells the template renderer to pass whatever data the parent template has into this child template. I'll get to how to send that data in later on.

Now we have a base page which is little more than a skeleton. We usually won't render the base by itself, but rather extend it to get the page we actually want. After our route refactoring above, we want to create an index template for the "/" route. To do that, make a new directory called `templates/layouts/` and create a new file at `templates/layouts/index.tmpl` with the following:

```go-html-template
{{ define "content" }}
Robinhood Portfolio app
{{ end }}

{{ define "title" }}<title>Home</title>{{ end }}
```

Here I'm defining two different templates in the same file. The "content" template defined first is required by the base template. I've just moved the minimal static content from the previous version inside this new template. The "title" template is not required since the base template already defines a title block. If I didn't include this here, the page title would be "Robinhood Portfolio" as defined in the base, but by defining it differently here I can overwrite that.



## Adding some styling

On some projects I like to design the whole thing by hand, since it lets me keep the page size as small as possible by excluding a bunch of library code I don't actually need. In this case, though, I'm going to need a fair bit of design, and I'd rather spend time on creating functionality rather than messing about with nit-picky design details. I'm going to use [Bootstrap](http://getbootstrap.com) to make this as easy for myself as I can. I also want to use some icons in various places, so I'll add [FontAwesome]() at the same time.

Since I'll want these styles to be available to every page I generate, it makes sense to put them into `base.tmpl` instead of adding them separately to each page layout. Instead of serving these files locally, I'll just pull from a CDN instead.

```go-html-template {hl_lines=["9-16",25]}
<!-- templates/base.tmpl -->
{{ define "base" }}

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device=width, initial-scale=1" />
    <link
      href="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css"
      rel="stylesheet"
    />
    <link
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/all.min.css"
      rel="stylesheet"
    />
    {{ block "title" . }}<title>Robinhood Portfolio</title>{{ end }}
  </head>
  <body>
    {{ template "navbar" . }}

    <div class="container">
      {{ template "content" . }}
    </div>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js"></script>
  </body>
</html>

{{ end }}
```

## Creating the navbar template

The base template requires a sub-template called "navbar", but I haven't defined that anywhere yet. Since this will be used across many pages, but isn't a full layout, I'll treat it as an "include" based on how I have structured my template parser. Create a new folder under `templates/includes/` and create the file `templates/includes/navbar.tmpl` with the following:

```go-html-template
<!-- templates/includes/navbar.tmpl -->
{{ define "navbar" }}

<nav
  class="navbar navbar-expand-md navbar-dark bg-dark justify-content-between"
>
  <a class="navbar-brand" href="/">
    <i class="fas fa-chart-line"></i>
    Robinhood Portfolio
  </a>
  <button
    type="button"
    class="navbar-toggler"
    data-toggle="collapse"
    data-target="#navbarContent"
  >
    <span class="navbar-toggler-icon"></span>
  </button>

  <div class="navbar-collapse collapse" id="navbarContent">
    <ul class="navbar-nav ml-auto">
      <li class="nav-item active">
        <a class="nav-link" href="/">
          Home
        </a>
      </li>
      {{ if not .User }}
      <li class="nav-item">
        <a class="nav-link" href="/login">Log In</a>
      </li>
      {{ else }}
      <li class="nav-item">
        <a class="nav-link" href="/logout">Log Out</a>
      </li>
      {{ end }}
    </ul>
  </div>
</nav>

{{ end }}
```

Here I'm using a new Go template action to decide whether to show the "Log In" or "Log Out" link. You can see that the variable I'm checking uses the "dot" notation followed by a variable name. I'll explain where this comes from later in this part, but first let's get this template parsed so that the parent templates can find it.

All the templates we need to render `index.tmpl` are now available, and to see all the new changes, restart the server and refresh the page. You should see something like this:

{{< figure src="/images/gorobinhood_part_2_navbar_test.png#center" >}}

If you're viewing on a small screen, you may have to click the hamburger icon on the right side to see the dropdown navbar with links to Home and Log In.

Note that if you click on the Log In button, nothing seems to happen; the address changes to `127.0.0.1:8081/login`, but the same content is displayed. That's because we only have one route setup right now ("/"), and `http/ServeMux` will call that the best match if we try to retrieve any longer paths (like "/login").

## Creating the login route and template

Let's build another route for the login page now by editing `main.go`:

```go {hl_lines=[15]}
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

	mux.HandleFunc("/", index)
	mux.HandleFunc("/login", login)

	// configure and start the server using the multiplexer defined above
	// and some reasonable default values
	server := &http.Server{
		Addr:    "127.0.0.1:8081",
		Handler: mux,
	}
	server.ListenAndServe() // serve until stopped
}
```

Next we need to execute a new template based on this route by editing `route_main.go`:

```go {hl_lines=["10-15"]}
// route_main.go
...
func index(w http.ResponseWriter, r *http.Request) {
	err := renderTemplate(w, "index.tmpl", nil)
	if err != nil {
		logger.Println(err)
	}
}

func login(w http.ResponseWriter, r *http.Request) {
	err := renderTemplate(w, "login.tmpl", nil)
	if err != nil {
		logger.Println(err)
	}
}
```

Now create a template for the login form with a new file at `templates/layouts/login.tmpl`:

```go-html-template
<!-- templates/layouts/login.tmpl -->
{{ define "content" }}

<form class="form-signin center" role="form" action="/authenticate" method="post">
  <h2 class="form signin-heading">
    <i class="fas fa-chart-line">Robinhood Portfolio</i>
  </h2>
  <input type="email" name="email" class="form-control" placeholder="Email address" required autofocus>
  <input type="password" name="password" class="form-control" placeholder="Password" required>
  <br/>
  <button class="btn btn-lg btn-primary btn-block" type="submit">Sign in</button>
</form>

{{ end }}
```

Since the base template already has an action to include a template named "content", I defined the login form inside a definition to this template. Now the route will start with the base template, substitute the login form into the "content" section, and render the output.

Both the home and login pages should display now, although the login page still doesn't actually do anything yet. Before we move on to creating login functionality, let's do some additional styling on the login page and learn how to serve assets that aren't generated from templates.

## Moving configuration out of the code

We want to move on to start serving some static content from our Go server, but before we do that we have a little more cleanup to take care of. So far we haven't had a lot of configuration in our code, but that's going to start changing. Rather than spread different configuration values throughout code files, I'd rather keep them all in one spot to make it easy to find and change when I need to.

JSON is a pretty easy-to-read format for app configuration, so let's create a config file in the project root directory called `config.json`, and populate it with a few values:

`config.json`:
```json
{
    "Address": "127.0.0.1:8081",
    "Static": "public",
    "Templates": {
        "Path": "templates/"
    }
}
```

I'm starting out simple here, and just including the address and port where I want the server to listen, and the directories from which I want to serve both static content and templates.

To read in and use this config, I'll create a new Go file in the project root called `utils.go` to handle this and a few other convenience functions:

```go
// utils.go
package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
)

type Configuration struct {
	Address   string
	Static    string
	Templates struct {
		Path string
	}
}

var config Configuration
var logger *log.Logger

func init() {
	// create or open log file
	file, err := os.OpenFile("gorobinhood.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalln("Failed to open log file:", err)
	}

	// log to both stderr and the file
	wrt := io.MultiWriter(os.Stderr, file)
	logger = log.New(wrt, "INFO", log.Ldate|log.Ltime|log.Lshortfile)

	loadConfig()
}

// load configuration from JSON
func loadConfig() {
	file, err := os.Open("config.json")
	if err != nil {
		logger.Fatalln("Cannot open config file:", err)
	}
	defer file.Close()

	// read configuration in from JSON
	decoder := json.NewDecoder(file)
	config = Configuration{}
	err = decoder.Decode(&config)
	if err != nil {
		log.Fatalln("Cannot get configuration from file:", err)
	}
	logger.Println("Configuration loaded")
}
```

My new Configuration struct matches the data I just placed in the JSON file, and I'll be able to use it elsewhere in my code. I also created a logger that will both print to stderr and also to a file.

Now that we moved the template path into a configuration value, let's get rid of the hard-coded value in `route_main.go`:

```go {hl_lines=[9]}
// route_main.go
...
func generateTemplates() {
	// don't parse again if templates have already been generated
	if templates != nil {
		return
	}
	templates = make(map[string]*template.Template)
	templatesDir := config.Templates.Path

	// base is a mostly-bare skeleton from which other pages are generated
	base := templatesDir + "base.tmpl"

	// layouts directory contains full pages based on `base` template
	layouts, err := filepath.Glob(templatesDir + "layouts/*.tmpl")
	if err != nil {
		logger.Fatalln(err)
	}
...
```


## Serving static files

To make use of the rest of the configuration values, I'll go back to `main.go` and make some changes there:

```go {hl_lines=[9,"13-14",22]}
// main.go
package main

import (
	"net/http"
)

func main() {
	logger.Printf("Starting Robinhood portfolio app on: %s\n", config.Address)

	// create multiplexer to handle incoming requests
	mux := http.NewServeMux()
	files := http.FileServer(http.Dir(config.Static))
	mux.Handle("/static/", http.StripPrefix("/static/", files))

	mux.HandleFunc("/", index)
	mux.HandleFunc("/login", login)

	// configure and start the server using the multiplexer defined above
	// and some reasonable default values
	server := &http.Server{
		Addr:    config.Address,
		Handler: mux,
	}
	server.ListenAndServe() // serve until stopped
}
```

The first and last changes are minor, and just use configuration from a file instead of the previous hardcoded values. The middle change creates a new file server that will just serve any files out of the directory defined in our `config.Static` field, which in our case is `public/`. The `FileServer` will try to serve requests for any file inside the given folder. The new handler strips the `/static/` prefix and then requests the file from the file server.

Right now, all the content we are serving comes from our templates. We have some styles that we got from Bootstrap and FontAwesome, but those are served up via CDN and not directly.

Now that we have a way to serve our own static files, let's create a nested folder called `public/css` in our project root to hold our new CSS. In this new folder, create a file called `login.css`:

```css
/* public/css/login.css */
.form-signin {
  max-width: 430px;
  padding: 15px;
  margin: 0 auto;
}

.form-signin .form-signin-heading,
.form-signin {
  margin-bottom: 10px;
}

.form-signin {
  font-weight: normal;
}

.form-signin .form-control {
  position: relative;
  height: auto;
  -webkit-box-sizing: border-box;
     -moz-box-sizing: border-box;
          box-sizing: border-box;
  padding: 10px;
  font-size: 16px;
}

.form-signin .form-control:focus {
  z-index: 2;
}

.form-signin input[type="email"] {
  margin-bottom: -1px;
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.form-signin input[type="password"] {
  margin-bottom: 10px;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
```

To make use of the new styles, we just need to edit `templates/layouts/base.tmpl` to include the stylesheet. There's a small problem, though: we only want to use this CSS when the login page is displayed, but not necessarily for all the other pages. This is another case where we can use the `block` action for Go templates. The block action is similar to the template action, except that it defines a template in-line. In this case, we'll leave the block definition empty, so that it only affects the page if a specific template is passed in by a child layout.

```go-html-template {hl_lines=[8]}
<!-- templates/layouts/base.tmpl -->
{{ define "base" }}

<!DOCTYPE html>
<html lang="en">
  <head>
    ...
    {{ block "styles" . }}{{ end }}
    {{ block "title" . }}<title>Robinhood Portfolio</title>{{ end }}
  </head>
  <body>
    ...
  </body>
</html>

{{ end }}
```

When parsing templates, if we pass any template file that defines a `"styles"` sub-template, it will be inserted here, otherwise this section will be empty. Let's add a "styles" definition to the `/templates/layouts/login.tmpl` file. We don't need to make a completely new file, since you can define multiple templates in a single file.

```go-html-template {hl_lines=["7-11"]}
<!-- templates/layouts/login.tmpl -->
{{ define "content" }}
<form class="form-signin center" role="form" action="/authenticate" method="post">
...
</form>
{{ end }}

{{ define "styles" }}<link href="/static/css/login.css" rel="stylesheet">{{ end }}
```

If you restart the server and reload the page, then click the Log In link, you should see something like this:

{{< figure src="/images/gorobinhood_part_2_login_styling.png#center" >}}

In the [next part](/posts/gorobinhood-part3), I'll set up the backend functionality to actually log in. Before we do that, however, I wanted to show how the template logic in the navbar template works to display either the Log In or Log Out links. As a reminder, the relevant section looked like this:

```go-html-template
<!-- templates/includes/navbar.tmpl -->
...
      {{ if not .User }}
      <li class="nav-item">
        <a class="nav-link" href="/login">Log In</a>
      </li>
      {{ else }}
      <li class="nav-item">
        <a class="nav-link" href="/logout">Log Out</a>
      </li>
      {{ end }}
...
```

As I alluded to earlier in this post, the "dot" in a Go template refers to the data that is passed in during template execution. So far, we've just been passing the nil value, but let's see what happens if we pass in a struct with some data instead. Make this (temporary) change in `route_main.go`:

```go {hl_lines=["3-5",8]}
// route_main.go
...
type PageData struct {
	User string
}

func index(w http.ResponseWriter, r *http.Request) {
	err := renderTemplate(w, "index.tmpl", PageData{User: "anson"})
	if err != nil {
		logger.Println(err)
	}
}
...
```

I've created a struct called PageData with a User field. When I render the template, instead of passing nil, I'm passing a PageData struct with my name in this field. Now, when the template looks for `.User`, it will evaluate to "anson" instead of empty like it did previously; this means that the Log Out link will be shown instead.

We'll get more in depth with this concept in later parts, but I wanted to introduce it now before we got too much further along with template design.

-------------

Next: [Building a Robinhood app with Go - Part 3](/posts/gorobinhood-part3)

Code: [https://github.com/anson-vandoren/gorobinhood/tree/part_2]

Found a problem with this post? Submit a PR to fix it at [https://github.com/anson-vandoren/ansonvandoren.com/content/posts/gorobinhood-part2.md](https://github.com/anson-vandoren/ansonvandoren.com/content/posts/gorobinhood-part2.md)