package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type testWSClient struct {
	conn net.Conn
	br   *bufio.Reader
}

func dialTestWS(t *testing.T, rawURL string) *testWSClient {
	t.Helper()
	stripped := strings.TrimPrefix(rawURL, "http://")
	slash := strings.IndexByte(stripped, '/')
	host := stripped[:slash]
	path := stripped[slash:]
	conn, err := net.DialTimeout("tcp", host, 2*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", host, err)
	}
	var keyBytes [16]byte
	_, _ = rand.Read(keyBytes[:])
	key := base64.StdEncoding.EncodeToString(keyBytes[:])
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade: %v", err)
	}
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil || !strings.Contains(statusLine, "101") {
		t.Fatalf("expected 101, got %q err=%v", statusLine, err)
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("read header: %v", err)
		}
		if line == "\r\n" {
			break
		}
	}
	return &testWSClient{conn: conn, br: br}
}

func (c *testWSClient) writeText(t *testing.T, text string) {
	t.Helper()
	payload := []byte(text)
	var mask [4]byte
	_, _ = rand.Read(mask[:])
	var hdr []byte
	hdr = append(hdr, 0x81)
	switch {
	case len(payload) < 126:
		hdr = append(hdr, 0x80|byte(len(payload)))
	default:
		hdr = append(hdr, 0x80|126, byte(len(payload)>>8), byte(len(payload)))
	}
	hdr = append(hdr, mask[:]...)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	if _, err := c.conn.Write(append(hdr, masked...)); err != nil {
		t.Fatalf("writeText: %v", err)
	}
}

func (c *testWSClient) readText(t *testing.T) string {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var hdr [2]byte
	if _, err := io.ReadFull(c.br, hdr[:]); err != nil {
		t.Fatalf("readText header: %v", err)
	}
	n := int(hdr[1] & 0x7f)
	if n == 126 {
		var ext [2]byte
		_, _ = io.ReadFull(c.br, ext[:])
		n = int(binary.BigEndian.Uint16(ext[:]))
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(c.br, buf); err != nil {
		t.Fatalf("readText body: %v", err)
	}
	return string(buf)
}

func (c *testWSClient) close() { _ = c.conn.Close() }

func TestRelayMultiplexAndOffline(t *testing.T) {
	hub := newRelayHub()
	srv := httptest.NewServer(hub.handler())
	defer srv.Close()

	// Health check
	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz failed: %v", err)
	}
	_ = resp.Body.Close()

	desktopID := strings.Repeat("a", 64)

	// Mobile connects while desktop is offline
	mOffline := dialTestWS(t, srv.URL+"/v1/tunnel?role=mobile&desktop="+desktopID)
	defer mOffline.close()
	if got := mOffline.readText(t); !strings.Contains(got, "DEVICE_OFFLINE") {
		t.Fatalf("expected DEVICE_OFFLINE, got %s", got)
	}

	// Desktop connects
	desk := dialTestWS(t, srv.URL+"/v1/tunnel?role=desktop&desktop="+desktopID)
	defer desk.close()

	// Two concurrent mobiles connect
	m1 := dialTestWS(t, srv.URL+"/v1/tunnel?role=mobile&desktop="+desktopID)
	defer m1.close()
	var open1 relayEnvelope
	if err := json.Unmarshal([]byte(desk.readText(t)), &open1); err != nil || open1.R != "open" {
		t.Fatalf("expected open1, got %+v err=%v", open1, err)
	}

	m2 := dialTestWS(t, srv.URL+"/v1/tunnel?role=mobile&desktop="+desktopID)
	defer m2.close()
	var open2 relayEnvelope
	if err := json.Unmarshal([]byte(desk.readText(t)), &open2); err != nil || open2.R != "open" {
		t.Fatalf("expected open2, got %+v err=%v", open2, err)
	}

	// Mobile -> Desktop blind forwarding
	m1.writeText(t, `{"t":"box","n":0,"c":"cipher1"}`)
	var msg1 relayEnvelope
	if err := json.Unmarshal([]byte(desk.readText(t)), &msg1); err != nil ||
		msg1.R != "msg" || msg1.C != open1.C || msg1.D != `{"t":"box","n":0,"c":"cipher1"}` {
		t.Fatalf("unexpected msg1: %+v", msg1)
	}

	// Desktop -> Mobile2 targeted forwarding
	reply, _ := json.Marshal(relayEnvelope{R: "msg", C: open2.C, D: `{"t":"welcome","depk":"abc"}`})
	desk.writeText(t, string(reply))
	if got := m2.readText(t); got != `{"t":"welcome","depk":"abc"}` {
		t.Fatalf("unexpected m2 reply: %s", got)
	}

	// Mobile1 closes -> Desktop receives close
	m1.close()
	var close1 relayEnvelope
	if err := json.Unmarshal([]byte(desk.readText(t)), &close1); err != nil || close1.R != "close" || close1.C != open1.C {
		t.Fatalf("expected close1, got %+v", close1)
	}
}
