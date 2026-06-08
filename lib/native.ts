// Native Messaging client for the Sanqian Notes clipper.
//
// The extension never speaks HTTP to the desktop app. It connects to the
// native host (com.sanqian-notes.native), which holds the bridge token and
// proxies tool calls. One connectNative per action (the host is one-shot).

import { browser } from 'wxt/browser';

const HOST_NAME = 'com.sanqian-notes.native';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface NativeOk<T> {
  ok: true;
  result?: T;
  version?: string;
  status?: string;
  capabilities?: string[];
}

export interface NativeErr {
  ok: false;
  error: string;
  code?: string;
}

export type NativeResponse<T = unknown> = NativeOk<T> | NativeErr;

function sendNative<T = unknown>(
  message: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NativeResponse<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: NativeResponse<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Native host timed out', code: 'TIMEOUT' }),
      timeoutMs,
    );

    let port: ReturnType<typeof browser.runtime.connectNative>;
    try {
      port = browser.runtime.connectNative(HOST_NAME);
    } catch (e) {
      finish({ ok: false, error: `connectNative failed: ${String(e)}`, code: 'NO_HOST' });
      return;
    }

    port.onMessage.addListener((resp: unknown) => {
      try {
        port.disconnect();
      } catch {
        // ignore
      }
      finish(resp as NativeResponse<T>);
    });

    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      finish({
        ok: false,
        error: err?.message ?? 'Native host disconnected (is it installed?)',
        code: 'DISCONNECTED',
      });
    });

    port.postMessage(message);
  });
}

export function pingHost(): Promise<NativeResponse> {
  return sendNative({ action: 'ping' }, 3_000);
}

export function getConnection(): Promise<NativeResponse> {
  return sendNative({ action: 'get_connection' }, 5_000);
}

export function callTool<T = unknown>(
  tool: string,
  args: Record<string, unknown>,
): Promise<NativeResponse<T>> {
  return sendNative<T>({ action: 'proxy_tool', tool, args });
}
