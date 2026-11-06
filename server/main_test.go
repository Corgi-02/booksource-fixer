package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServingAndNoUpload(t *testing.T) {
	h := handler()
	for _, test := range []struct {
		method, path string
		status       int
		content      string
	}{
		{"GET", "/healthz", 200, "ok"},
		{"GET", "/api/version", 200, "browser-local"},
		{"GET", "/", 200, "源序"},
		{"GET", "/missing", 404, "404"},
		{"POST", "/upload", 405, ""},
		{"POST", "/", 405, ""},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(test.method, test.path, nil))
		if w.Code != test.status || !strings.Contains(w.Body.String(), test.content) {
			t.Errorf("%s %s: %d %s", test.method, test.path, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Header().Get("Content-Security-Policy"), "connect-src 'none'") {
			t.Fatal("missing network restriction")
		}
	}
}
