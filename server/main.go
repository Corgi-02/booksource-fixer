package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"
)

//go:embed web
var assets embed.FS

const version = "1.0.0"
const ruleVersion = "harmony-sample-2026.11.06-v1"

func handler() http.Handler {
	web, err := fs.Sub(assets, "web")
	if err != nil {
		panic(err)
	}
	static := http.FileServer(http.FS(web))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(map[string]string{"version": version, "ruleVersion": ruleVersion, "processing": "browser-local"})
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-store")
		}
		static.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		mux.ServeHTTP(w, r)
	})
}

func main() {
	host := flag.String("host", "127.0.0.1", "监听地址；局域网访问使用 0.0.0.0")
	port := flag.Int("port", 8080, "监听端口")
	noOpen := flag.Bool("no-open", false, "Windows 下不自动打开浏览器")
	showVersion := flag.Bool("version", false, "显示版本")
	flag.Parse()
	if *showVersion {
		fmt.Printf("booksource-fixer %s (%s)\n", version, ruleVersion)
		return
	}
	if *port < 1 || *port > 65535 {
		log.Fatal("端口必须在 1–65535 之间")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(*host, strconv.Itoa(*port)))
	if err != nil {
		log.Fatalf("无法监听 %s:%d，请检查端口是否占用：%v", *host, *port, err)
	}
	urlHost := *host
	if urlHost == "0.0.0.0" || urlHost == "::" || urlHost == "" {
		urlHost = "127.0.0.1"
	}
	url := "http://" + net.JoinHostPort(urlHost, strconv.Itoa(*port))
	fmt.Printf("\n  源序 · 书源修正工具 v%s\n  %s\n  文件仅在浏览器内处理。按 Ctrl+C 退出。\n\n", version, url)
	server := &http.Server{Handler: handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	if runtime.GOOS == "windows" && !*noOpen {
		cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		if err := cmd.Start(); err != nil {
			log.Printf("请手动打开上方网址：%v", err)
		} else {
			go cmd.Wait()
		}
	}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
