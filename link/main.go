// remote-link: Remote's connection part. It joins our own private network (tsnet, the library inside Tailscale,
// with our Headscale server as the coordination server) and is the only way into or out of Remote:
//
//   - Receiving: it listens on port 7787 of the private network address only, never on the computer's own network
//     cards, so a computer outside the network cannot reach Remote at all. Each request is passed to Remote's local
//     server with the asking computer's name, which the network itself vouches for (WhoIs), never what the request says.
//   - Viewing: Remote asks it, on 127.0.0.1, for the list of computers in the network and sends requests to another
//     computer through it (/peer/<name>/...).
//
// Why a separate program and not a library inside the native module: tsnet is Go, and linking a Go library into the
// Rust module means two runtimes in one process and a cgo build for every OS and CPU. A small program that Remote
// starts and stops is the same code (libtailscale wraps exactly this) and builds for every OS with GOOS/GOARCH.
//
// Remote starts it with: remote-link --dir <state> --hostname <name> --control <url> [--authkey <key>]
// --app 127.0.0.1:<port> --token <secret>. It prints one line {"port":N} when its local API is up, and quits when its
// standard input closes, so it never outlives Remote.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

// Port is where every Remote listens on the private network.
const Port = 7787

// Headers Remote's local server trusts. They are set here and any copy a request brings along is dropped first.
const (
	headerPeer  = "X-Remote-Peer"
	headerUser  = "X-Remote-User"
	headerToken = "X-Remote-Token"
)

type options struct {
	dir, hostname, control, authKey, app, token string
}

func main() {
	var o options
	flag.StringVar(&o.dir, "dir", "", "folder for this computer's network identity")
	flag.StringVar(&o.hostname, "hostname", "", "name of this computer in the network")
	flag.StringVar(&o.control, "control", "", "coordination server (Headscale) address")
	flag.StringVar(&o.authKey, "authkey", "", "pre-authorized key for joining without a browser")
	flag.StringVar(&o.app, "app", "", "Remote's local server, host:port")
	flag.StringVar(&o.token, "token", "", "secret shared with Remote for every local request")
	flag.Parse()
	if o.dir == "" || o.hostname == "" || o.control == "" || o.app == "" || len(o.token) < 16 {
		fmt.Fprintln(os.Stderr, "remote-link: --dir, --hostname, --control, --app and --token (16+ chars) are required")
		os.Exit(2)
	}
	if err := run(o); err != nil {
		log.Fatal("remote-link: ", err)
	}
}

func run(o options) error {
	server := &tsnet.Server{
		Dir:        o.dir,
		Hostname:   o.hostname,
		ControlURL: o.control,
		AuthKey:    o.authKey,
		// Why: tsnet logs a lot; Remote keeps only what this program prints itself on standard error.
		Logf:      func(string, ...any) {},
		UserLogf:  log.Printf,
		Ephemeral: false,
	}
	defer server.Close()
	if err := server.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}
	client, err := server.LocalClient()
	if err != nil {
		return err
	}

	network, err := server.Listen("tcp", fmt.Sprintf(":%d", Port))
	if err != nil {
		return fmt.Errorf("listen on the network: %w", err)
	}
	go serveNetwork(network, client, o)

	local, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	go serveLocal(local, server, client, o)

	ready, _ := json.Marshal(map[string]int{"port": local.Addr().(*net.TCPAddr).Port})
	fmt.Println(string(ready))

	// Why: Remote holds our standard input open; when Remote quits or crashes it closes, and so do we.
	_, _ = io.Copy(io.Discard, os.Stdin)
	return nil
}

// serveNetwork passes requests from other computers to Remote, with who sent them.
func serveNetwork(listener net.Listener, client *local.Client, o options) {
	target := &url.URL{Scheme: "http", Host: o.app}
	proxy := httputil.NewSingleHostReverseProxy(target)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		who, err := client.WhoIs(ctx, r.RemoteAddr)
		cancel()
		if err != nil || who.Node == nil {
			http.Error(w, "unknown computer", http.StatusForbidden)
			return
		}
		for _, h := range []string{headerPeer, headerUser, headerToken} {
			r.Header.Del(h)
		}
		name := who.Node.ComputedName
		if who.Node.Hostinfo.Valid() && who.Node.Hostinfo.Hostname() != "" {
			name = who.Node.Hostinfo.Hostname()
		}
		r.Header.Set(headerPeer, name)
		if who.UserProfile != nil {
			r.Header.Set(headerUser, who.UserProfile.LoginName)
		}
		r.Header.Set(headerToken, o.token)
		proxy.ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	if err := server.Serve(listener); err != nil && !errors.Is(err, net.ErrClosed) {
		log.Print("network server: ", err)
	}
}

// Computer is one entry of the network list Remote shows.
type Computer struct {
	Name   string `json:"name"`
	Host   string `json:"host"`
	Online bool   `json:"online"`
	OS     string `json:"os"`
}

// Status is what /status answers: whether this computer is in the network, and who else is.
type Status struct {
	// State is tsnet's backend state: NoState, NeedsLogin, NeedsMachineAuth, Stopped, Starting or Running.
	State string `json:"state"`
	// AuthURL is set while the server waits for this computer to be approved.
	AuthURL   string     `json:"authUrl"`
	Self      string     `json:"self"`
	Computers []Computer `json:"computers"`
}

// serveLocal is the API for Remote on this computer only (127.0.0.1, with the shared token).
func serveLocal(listener net.Listener, server *tsnet.Server, client *local.Client, o options) {
	peers := &http.Transport{DialContext: server.Dial, ResponseHeaderTimeout: 10 * time.Second}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		st, err := client.Status(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		out := Status{State: st.BackendState, AuthURL: st.AuthURL, Computers: []Computer{}}
		if st.Self != nil {
			out.Self = st.Self.HostName
		}
		for _, peer := range st.Peer {
			host := strings.TrimSuffix(peer.DNSName, ".")
			if i := strings.IndexByte(host, '.'); i > 0 {
				host = host[:i]
			}
			out.Computers = append(out.Computers, Computer{Name: peer.HostName, Host: host, Online: peer.Online, OS: peer.OS})
		}
		sort.Slice(out.Computers, func(i, j int) bool { return out.Computers[i].Name < out.Computers[j].Name })
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
	// /peer/<host>/<path> goes to http://<host>:7787/<path> through the private network.
	mux.HandleFunc("/peer/{host}/{path...}", func(w http.ResponseWriter, r *http.Request) {
		host := r.PathValue("host")
		if host == "" || strings.ContainsAny(host, ":/@") {
			http.Error(w, "bad computer name", http.StatusBadRequest)
			return
		}
		proxy := &httputil.ReverseProxy{
			Transport: peers,
			Rewrite: func(p *httputil.ProxyRequest) {
				p.Out.URL.Scheme = "http"
				p.Out.URL.Host = fmt.Sprintf("%s:%d", host, Port)
				p.Out.URL.Path = "/" + r.PathValue("path")
				p.Out.Host = p.Out.URL.Host
				p.Out.Header.Del(headerToken)
			},
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
				http.Error(w, "unreachable: "+err.Error(), http.StatusBadGateway)
			},
		}
		proxy.ServeHTTP(w, r)
	})
	guarded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get(headerToken)), []byte(o.token)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
	httpServer := &http.Server{Handler: guarded, ReadHeaderTimeout: 10 * time.Second}
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, net.ErrClosed) {
		log.Print("local server: ", err)
	}
}
