package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	wsGUID         = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	maxFrameBytes  = 2 * 1024 * 1024
	maxMobilesDesk = 32
	pingInterval   = 25 * time.Second
	writeTimeout   = 15 * time.Second
)

var desktopIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// wsConn 是基于标准库的轻量 RFC 6455 WebSocket 封装，零外部依赖。
type wsConn struct {
	netConn net.Conn
	br      *bufio.Reader
	writeMu sync.Mutex
	closed  atomic.Bool
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		!strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		http.Error(w, "upgrade required", http.StatusUpgradeRequired)
		return nil, errors.New("missing websocket upgrade headers")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		http.Error(w, "missing websocket key", http.StatusBadRequest)
		return nil, errors.New("missing Sec-WebSocket-Key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking unsupported", http.StatusInternalServerError)
		return nil, errors.New("hijacker unsupported")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := rw.WriteString(resp); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &wsConn{netConn: conn, br: rw.Reader}, nil
}

func (c *wsConn) Close() error {
	if c.closed.Swap(true) {
		return nil
	}
	return c.netConn.Close()
}

func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closed.Load() {
		return net.ErrClosed
	}
	_ = c.netConn.SetWriteDeadline(time.Now().Add(writeTimeout))
	var header [10]byte
	header[0] = 0x80 | opcode
	n := len(payload)
	hdrLen := 2
	switch {
	case n < 126:
		header[1] = byte(n)
	case n <= 65535:
		header[1] = 126
		binary.BigEndian.PutUint16(header[2:4], uint16(n))
		hdrLen = 4
	default:
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:10], uint64(n))
		hdrLen = 10
	}
	if _, err := c.netConn.Write(header[:hdrLen]); err != nil {
		return err
	}
	if n > 0 {
		if _, err := c.netConn.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

func (c *wsConn) WriteText(msg string) error {
	return c.writeFrame(0x1, []byte(msg))
}

func (c *wsConn) WritePing() error {
	return c.writeFrame(0x9, nil)
}

func (c *wsConn) ReadText() (string, error) {
	var msgBuf []byte
	for {
		var hdr [2]byte
		if _, err := io.ReadFull(c.br, hdr[:]); err != nil {
			return "", err
		}
		fin := (hdr[0] & 0x80) != 0
		opcode := hdr[0] & 0x0f
		masked := (hdr[1] & 0x80) != 0
		length := uint64(hdr[1] & 0x7f)
		switch length {
		case 126:
			var ext [2]byte
			if _, err := io.ReadFull(c.br, ext[:]); err != nil {
				return "", err
			}
			length = uint64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			if _, err := io.ReadFull(c.br, ext[:]); err != nil {
				return "", err
			}
			length = binary.BigEndian.Uint64(ext[:])
		}
		if length > maxFrameBytes || uint64(len(msgBuf))+length > maxFrameBytes {
			return "", errors.New("frame too large")
		}
		var maskKey [4]byte
		if masked {
			if _, err := io.ReadFull(c.br, maskKey[:]); err != nil {
				return "", err
			}
		}
		payload := make([]byte, length)
		if length > 0 {
			if _, err := io.ReadFull(c.br, payload); err != nil {
				return "", err
			}
			if masked {
				for i := range payload {
					payload[i] ^= maskKey[i%4]
				}
			}
		}
		switch opcode {
		case 0x8: // close
			_ = c.writeFrame(0x8, nil)
			return "", io.EOF
		case 0x9: // ping
			_ = c.writeFrame(0xA, payload)
			continue
		case 0xA: // pong
			continue
		case 0x0, 0x1, 0x2:
			msgBuf = append(msgBuf, payload...)
			if fin {
				return string(msgBuf), nil
			}
		default:
			return "", fmt.Errorf("unsupported opcode %d", opcode)
		}
	}
}

// --- Stateless Relay Hub ---

type relayEnvelope struct {
	R string `json:"r"`           // "open" | "msg" | "close"
	C string `json:"c"`           // mobile connection id
	D string `json:"d,omitempty"` // opaque E2EE payload
}

type desktopSlot struct {
	conn    *wsConn
	mu      sync.Mutex
	mobiles map[string]*wsConn
}

type relayHub struct {
	mu       sync.RWMutex
	desktops map[string]*desktopSlot
	seq      atomic.Uint64
}

func newRelayHub() *relayHub {
	return &relayHub{desktops: make(map[string]*desktopSlot)}
}

func (h *relayHub) sendDesktop(slot *desktopSlot, env relayEnvelope) error {
	raw, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return slot.conn.WriteText(string(raw))
}

func (h *relayHub) serveDesktop(w http.ResponseWriter, r *http.Request, desktopID string) {
	conn, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	slot := &desktopSlot{conn: conn, mobiles: make(map[string]*wsConn)}

	h.mu.Lock()
	old := h.desktops[desktopID]
	h.desktops[desktopID] = slot
	h.mu.Unlock()
	if old != nil {
		old.closeAll()
	}

	stopPing := startPinger(conn)
	defer func() {
		stopPing()
		h.mu.Lock()
		if h.desktops[desktopID] == slot {
			delete(h.desktops, desktopID)
		}
		h.mu.Unlock()
		slot.closeAll()
	}()

	for {
		raw, err := conn.ReadText()
		if err != nil {
			return
		}
		var env relayEnvelope
		if err := json.Unmarshal([]byte(raw), &env); err != nil || env.C == "" {
			continue
		}
		slot.mu.Lock()
		mobile := slot.mobiles[env.C]
		if env.R == "close" {
			delete(slot.mobiles, env.C)
		}
		slot.mu.Unlock()
		if mobile == nil {
			continue
		}
		switch env.R {
		case "msg":
			if err := mobile.WriteText(env.D); err != nil {
				_ = mobile.Close()
			}
		case "close":
			_ = mobile.Close()
		}
	}
}

func (s *desktopSlot) closeAll() {
	s.mu.Lock()
	mobiles := make([]*wsConn, 0, len(s.mobiles))
	for id, m := range s.mobiles {
		mobiles = append(mobiles, m)
		delete(s.mobiles, id)
	}
	s.mu.Unlock()
	for _, m := range mobiles {
		_ = m.WriteText(`{"t":"err","code":"DEVICE_OFFLINE"}`)
		_ = m.Close()
	}
	_ = s.conn.Close()
}

func (h *relayHub) serveMobile(w http.ResponseWriter, r *http.Request, desktopID string) {
	conn, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	h.mu.RLock()
	slot := h.desktops[desktopID]
	h.mu.RUnlock()
	if slot == nil {
		_ = conn.WriteText(`{"t":"err","code":"DEVICE_OFFLINE"}`)
		_ = conn.Close()
		return
	}

	cid := fmt.Sprintf("m%d", h.seq.Add(1))
	slot.mu.Lock()
	if len(slot.mobiles) >= maxMobilesDesk {
		slot.mu.Unlock()
		_ = conn.WriteText(`{"t":"err","code":"TOO_MANY_CONNECTIONS"}`)
		_ = conn.Close()
		return
	}
	slot.mobiles[cid] = conn
	slot.mu.Unlock()

	if err := h.sendDesktop(slot, relayEnvelope{R: "open", C: cid}); err != nil {
		slot.mu.Lock()
		delete(slot.mobiles, cid)
		slot.mu.Unlock()
		_ = conn.WriteText(`{"t":"err","code":"DEVICE_OFFLINE"}`)
		_ = conn.Close()
		return
	}

	stopPing := startPinger(conn)
	defer func() {
		stopPing()
		slot.mu.Lock()
		_, existed := slot.mobiles[cid]
		delete(slot.mobiles, cid)
		slot.mu.Unlock()
		if existed {
			_ = h.sendDesktop(slot, relayEnvelope{R: "close", C: cid})
		}
		_ = conn.Close()
	}()

	for {
		raw, err := conn.ReadText()
		if err != nil {
			return
		}
		if err := h.sendDesktop(slot, relayEnvelope{R: "msg", C: cid, D: raw}); err != nil {
			return
		}
	}
}

func startPinger(conn *wsConn) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := conn.WritePing(); err != nil {
					_ = conn.Close()
					return
				}
			}
		}
	}()
	return func() { close(done) }
}

func (h *relayHub) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/v1/tunnel", func(w http.ResponseWriter, r *http.Request) {
		role := r.URL.Query().Get("role")
		desktopID := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("desktop")))
		if !desktopIDPattern.MatchString(desktopID) {
			http.Error(w, "invalid desktop id", http.StatusBadRequest)
			return
		}
		switch role {
		case "desktop":
			h.serveDesktop(w, r, desktopID)
		case "mobile":
			h.serveMobile(w, r, desktopID)
		default:
			http.Error(w, "invalid role", http.StatusBadRequest)
		}
	})
	return mux
}

func main() {
	defaultAddr := os.Getenv("LING_RELAY_ADDR")
	if defaultAddr == "" {
		defaultAddr = ":8787"
	}
	addr := flag.String("addr", defaultAddr, "listen address")
	flag.Parse()

	hub := newRelayHub()
	srv := &http.Server{
		Addr:              *addr,
		Handler:           hub.handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("ling-relay listening on %s", *addr)
	log.Fatal(srv.ListenAndServe())
}
