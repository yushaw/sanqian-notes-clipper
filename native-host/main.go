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
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const hostVersion = "0.0.1"

// App identity (electron-builder.yml: appId / productName).
const appBundleID = "com.sanqian.notes"
const appProductName = "Sanqian Notes"

// How long to wait for the app's MCP bridge to come up after we launch it.
const launchTimeout = 15 * time.Second
const launchPollInterval = 500 * time.Millisecond

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

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// appInstalled reports whether the Sanqian Notes desktop app is present, so the
// extension can tell "not running" (offer to launch / prompt to open) apart
// from "not installed" (prompt to download).
func appInstalled() bool {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		for _, p := range []string{
			filepath.Join("/Applications", appProductName+".app"),
			filepath.Join(home, "Applications", appProductName+".app"),
		} {
			if pathExists(p) {
				return true
			}
		}
		// Spotlight fallback covers non-standard install locations.
		out, err := exec.Command("mdfind", "kMDItemCFBundleIdentifier == '"+appBundleID+"'").Output()
		return err == nil && len(bytes.TrimSpace(out)) > 0
	case "windows":
		exe := appProductName + ".exe"
		var candidates []string
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			candidates = append(candidates, filepath.Join(local, "Programs", appProductName, exe))
		}
		if pf := os.Getenv("ProgramFiles"); pf != "" {
			candidates = append(candidates, filepath.Join(pf, appProductName, exe))
		}
		// Shortcuts are install-dir independent (NSIS shortcutName/desktop shortcut),
		// so they detect installs that chose a custom directory.
		if appData := os.Getenv("APPDATA"); appData != "" {
			candidates = append(candidates,
				filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", appProductName+".lnk"))
		}
		candidates = append(candidates, filepath.Join(home, "Desktop", appProductName+".lnk"))
		for _, p := range candidates {
			if pathExists(p) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// launchApp starts the app detached from this one-shot host. Returns false when
// no launch was attempted (unsupported platform). macOS only: Windows/Linux
// have no reliable mechanism (matches the app's own MCP server), so there the
// extension prompts the user to open it manually.
func launchApp() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	// `open` hands off to LaunchServices, so the app is not our child and
	// survives our exit. -g keeps focus on the browser.
	_ = exec.Command("open", "-b", appBundleID, "-g").Run()
	return true
}

// handleEnsureRunning makes the app reachable for an imminent clip: it returns
// running if the bridge is already up; otherwise launches the app (where
// supported) and polls until the bridge answers or we time out. Called only for
// an explicit clip, never for incidental probes, so opening the popup never
// launches the app.
func handleEnsureRunning() Response {
	if _, err := loadConnection(); err == nil {
		return Response{OK: true, Version: hostVersion, Status: "running"}
	}
	if !appInstalled() {
		return Response{OK: false, Error: appProductName + " is not installed", Code: "NOT_INSTALLED", Status: "not_installed"}
	}
	if !launchApp() {
		return Response{OK: false, Error: appProductName + " is not running", Code: "NOT_RUNNING", Status: "installed"}
	}
	deadline := time.Now().Add(launchTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(launchPollInterval)
		if _, err := loadConnection(); err == nil {
			return Response{OK: true, Version: hostVersion, Status: "running"}
		}
	}
	return Response{OK: false, Error: appProductName + " did not start in time", Code: "LAUNCH_TIMEOUT", Status: "installed"}
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
		// Availability probe only -- never launches the app, and deliberately
		// does NOT return the token to the browser (it stays here for proxy_tool).
		// Distinguishes running / installed-not-running / not-installed.
		if _, err := loadConnection(); err == nil {
			sendMessage(Response{OK: true, Version: hostVersion, Status: "running"})
			return
		}
		if appInstalled() {
			sendMessage(Response{OK: false, Error: appProductName + " is not running", Code: "NOT_RUNNING", Status: "installed"})
		} else {
			sendMessage(Response{OK: false, Error: appProductName + " is not installed", Code: "NOT_INSTALLED", Status: "not_installed"})
		}
	case "ensure_running":
		sendMessage(handleEnsureRunning())
	case "proxy_tool":
		sendMessage(handleProxyTool(req))
	case "ping":
		sendMessage(Response{
			OK:           true,
			Status:       "ok",
			Version:      hostVersion,
			Capabilities: []string{"get_connection", "ensure_running", "proxy_tool", "ping"},
		})
	default:
		sendMessage(Response{OK: false, Error: "Unknown action: " + req.Action, Code: "UNKNOWN_ACTION"})
	}
}
