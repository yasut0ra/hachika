// Web UI は手元の個体へ直接書き込む。ブラウザで開いている別のサイトから
// リセットや発言を送り込まれないよう、リクエストの宛先と送信元を確かめる
export interface UiRequestLike {
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export type UiRequestCheck =
  | { ok: true }
  | { ok: false; status: 403 | 415; error: string };

export interface UiRequestGuard {
  check(request: UiRequestLike): UiRequestCheck;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function createUiRequestGuard(options: {
  host: string;
  port: number;
  allowedHosts?: readonly string[];
}): UiRequestGuard {
  const bindsLoopback = LOOPBACK_HOSTS.has(options.host.toLowerCase());
  const extraHosts = (options.allowedHosts ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
  // ループバックで待ち受けるときは、DNS rebinding で別名から届いた要求を断る。
  // 0.0.0.0 などで公開したときは、名前を列挙できないので HACHIKA_UI_ALLOWED_HOSTS があるときだけ絞る
  const allowedHosts =
    bindsLoopback || extraHosts.length > 0
      ? new Set(
          [
            ...(bindsLoopback ? ["127.0.0.1", "localhost", "[::1]"] : [options.host.toLowerCase()]),
            ...extraHosts,
          ].map((name) => (name.includes(":") && !name.startsWith("[") ? name : `${name}:${options.port}`)),
        )
      : null;

  return {
    check(request) {
      const hostHeader = readHeader(request.headers, "host")?.toLowerCase() ?? null;

      if (allowedHosts && (!hostHeader || !allowedHosts.has(hostHeader))) {
        return { ok: false, status: 403, error: "ui_host_not_allowed" };
      }

      if (readHeader(request.headers, "sec-fetch-site") === "cross-site") {
        return { ok: false, status: 403, error: "ui_cross_site_request" };
      }

      // Origin のない要求 (curl など) はブラウザ経由の偽装にならないので通す。
      // サンドボックスの "null" は URL として読めないので、ここで断られる
      const origin = readHeader(request.headers, "origin");
      if (origin !== null && !originMatchesHost(origin, hostHeader)) {
        return { ok: false, status: 403, error: "ui_origin_not_allowed" };
      }

      // JSON 以外の POST はフォームや text/plain の fetch で送れてしまう (CORS の事前確認が走らない)
      if (
        (request.method ?? "GET").toUpperCase() === "POST" &&
        !/^application\/json(?:\s*;|$)/iu.test(readHeader(request.headers, "content-type") ?? "")
      ) {
        return { ok: false, status: 415, error: "ui_json_required" };
      }

      return { ok: true };
    },
  };
}

export function parseAllowedUiHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function originMatchesHost(origin: string, hostHeader: string | null): boolean {
  if (!hostHeader) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.toLowerCase() === hostHeader
    );
  } catch {
    return false;
  }
}

function readHeader(
  headers: UiRequestLike["headers"],
  name: string,
): string | null {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}
