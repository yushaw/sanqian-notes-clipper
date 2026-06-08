// Sanqian Notes Web Clipper - Native Messaging Host
//
// Bridges the Chrome extension to the Sanqian Notes desktop app.
//
// The extension speaks only Native Messaging (stdio); this host holds the
// bridge token and performs the HTTP call to the app's local MCP bridge.
// This keeps the token out of the browser and avoids any CORS concerns.
//
// Discovery: the app writes <userData>/runtime/mcp-api.json containing
// {port, token, pid, startedAt}. We locate it (prod / dev / env paths),
// confirm the server is live via GET /mcp/health, and proxy tool calls to
// POST /mcp/tool-call.
//
// One-shot model: Chrome launches the host per connectNative; we read one
// message, respond, and exit. The extension opens one connection per action.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const hostVersion = "0.0.1"

const maxMessageBytes = 1024 * 1024 // 1MB, matches Chrome native messaging + bridge body cap

// Request from the browser extension.
type Request struct {
	Action string                 `json:"action"`
	Tool   string                 `json:"tool,omitempty"`
	Args   map[string]interface{} `json:"args,omitempty"`
}

// Response to the browser extension.
type Response struct {
	OK           bool        `json:"ok"`
	Version      string      `json:"version,omitempty"`
	Result       interface{} `json:"result,omitempty"`
	Error        string      `json:"error,omitempty"`
	Code         string      `json:"code,omitempty"`
	Status       string      `json:"status,omitempty"`
	Capabilities []string    `json:"capabilities,omitempty"`
}

// portFile mirrors <userData>/runtime/mcp-api.json written by the app.
type portFile struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

// candidateRuntimeFiles returns the mcp-api.json paths to try, in priority order.
// Env override first, then the production (productName) and dev (package name) dirs.
func candidateRuntimeFiles() []string {
	var paths []string
	if env := os.Getenv("SANQIAN_NOTES_USER_DATA"); env != "" {
		paths = append(paths, filepath.Join(env, "runtime", "mcp-api.json"))
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return paths
	}
	const prod = "Sanqian Notes"
	const dev = "sanqian-notes"
	switch runtime.GOOS {
	case "darwin":
		base := filepath.Join(home, "Library", "Application Support")
		paths = append(paths,
			filepath.Join(base, prod, "runtime", "mcp-api.json"),
			filepath.Join(base, dev, "runtime", "mcp-api.json"),
		)
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		paths = append(paths,
			filepath.Join(appData, prod, "runtime", "mcp-api.json"),
			filepath.Join(appData, dev, "runtime", "mcp-api.json"),
		)
	default:
		cfg := os.Getenv("XDG_CONFIG_HOME")
		if cfg == "" {
			cfg = filepath.Join(home, ".config")
		}
		paths = append(paths,
			filepath.Join(cfg, prod, "runtime", "mcp-api.json"),
			filepath.Join(cfg, dev, "runtime", "mcp-api.json"),
		)
	}
	return paths
}

// loadConnection finds the first runtime file whose server answers a healthy
// /mcp/health (which also validates the token), and returns it.
func loadConnection() (*portFile, error) {
	for _, p := range candidateRuntimeFiles() {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var pf portFile
		if err := json.Unmarshal(data, &pf); err != nil {
			continue
		}
		if pf.Port <= 0 || pf.Token == "" {
			continue
		}
		if healthOK(pf.Port, pf.Token) {
			return &pf, nil
		}
	}
	return nil, fmt.Errorf("not running")
}

func healthOK(port int, token string) bool {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/mcp/health", port), nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, maxMessageBytes))
	return resp.StatusCode == http.StatusOK
}

// handleProxyTool reads the live connection and forwards the tool call to the
// app's MCP bridge over HTTP. The token never leaves this process.
func handleProxyTool(req *Request) Response {
	if req.Tool == "" {
		return Response{OK: false, Error: "Missing tool name", Code: "INVALID_REQUEST"}
	}
	conn, err := loadConnection()
	if err != nil {
		return Response{OK: false, Error: "Sanqian Notes is not running", Code: "NOT_RUNNING"}
	}

	args := req.Args
	if args == nil {
		args = map[string]interface{}{}
	}
	payload, err := json.Marshal(map[string]interface{}{"tool": req.Tool, "args": args})
	if err != nil {
		return Response{OK: false, Error: "Failed to encode request", Code: "ENCODE_FAILED"}
	}

	httpReq, err := http.NewRequest(
		http.MethodPost,
		fmt.Sprintf("http://127.0.0.1:%d/mcp/tool-call", conn.Port),
		bytes.NewReader(payload),
	)
	if err != nil {
		return Response{OK: false, Error: err.Error(), Code: "REQUEST_FAILED"}
	}
	httpReq.Header.Set("Authorization", "Bearer "+conn.Token)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return Response{OK: false, Error: err.Error(), Code: "REQUEST_FAILED"}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxMessageBytes))
	if err != nil {
		return Response{OK: false, Error: "Failed to read bridge response", Code: "BAD_RESPONSE"}
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return Response{OK: false, Error: "Invalid bridge response", Code: "BAD_RESPONSE"}
	}

	if ok, _ := parsed["ok"].(bool); !ok {
		msg := "Tool execution failed"
		code := "TOOL_FAILED"
		if e, has := parsed["error"].(map[string]interface{}); has {
			if m, _ := e["message"].(string); m != "" {
				msg = m
			}
			if c, _ := e["code"].(string); c != "" {
				code = c
			}
		}
		return Response{OK: false, Error: msg, Code: code}
	}

	return Response{OK: true, Result: parsed["result"]}
}

// readMessage reads one native-messaging frame: 4-byte little-endian length
// prefix followed by a JSON body.
func readMessage() (*Request, error) {
	var length uint32
	if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length == 0 || length > maxMessageBytes {
		return nil, io.ErrUnexpectedEOF
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(os.Stdin, data); err != nil {
		return nil, err
	}
	var req Request
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

func sendMessage(resp Response) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	if err := binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data))); err != nil {
		return err
	}
	_, err = os.Stdout.Write(data)
	return err
}

func main() {
	req, err := readMessage()
	if err != nil {
		sendMessage(Response{OK: false, Error: "Invalid request", Code: "INVALID_REQUEST"})
		return
	}

	switch req.Action {
	case "get_connection":
		// Availability probe only. Deliberately does NOT return the token to
		// the browser; the token stays in this host for proxy_tool.
		if _, err := loadConnection(); err != nil {
			sendMessage(Response{OK: false, Error: "Sanqian Notes is not running", Code: "NOT_RUNNING"})
			return
		}
		sendMessage(Response{OK: true, Version: hostVersion})
	case "proxy_tool":
		sendMessage(handleProxyTool(req))
	case "ping":
		sendMessage(Response{
			OK:           true,
			Status:       "ok",
			Version:      hostVersion,
			Capabilities: []string{"get_connection", "proxy_tool", "ping"},
		})
	default:
		sendMessage(Response{OK: false, Error: "Unknown action: " + req.Action, Code: "UNKNOWN_ACTION"})
	}
}
