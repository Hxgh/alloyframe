import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import nextConfig from "../../../next.config";

const require = createRequire(import.meta.url);
const { blockCrossSiteDEV } = require("next/dist/server/lib/router-utils/block-cross-site-dev") as {
  blockCrossSiteDEV: (request: { url: string; headers: Record<string, string> }, response: { statusCode: number; end: (value: string) => void }, origins?: string[], hostname?: string) => boolean;
};

function devResource(host: string, url: string, mode = "cors", site = "same-origin") {
  const response = { statusCode: 200, end() {} };
  const blocked = blockCrossSiteDEV({
    url,
    headers: {
      host: `${host}:3000`,
      ...(mode === "no-cors" ? {} : { origin: `http://${host}:3000` }),
      referer: `http://${host}:3000/projects/standing-desk`,
      "sec-fetch-mode": mode,
      "sec-fetch-site": site,
    },
  }, response, nextConfig.allowedDevOrigins, "localhost");
  return { blocked, status: response.statusCode };
}

test("任意私有网段和 mDNS 开发地址都能加载客户端脚本、字体和热更新", () => {
  // 使用虚构地址覆盖 192.168、172.20、10.x、链路本地与 *.local。
  for (const host of ["192.168.254.101", "192.168.253.102", "10.254.253.101", "10.253.252.102", "172.20.254.103", "169.254.254.104", "example-device.local"]) {
    for (const url of ["/_next/static/chunks/scene.js", "/__nextjs_font/geist-latin.woff2", "/_next/hmr"]) {
      assert.deepEqual(devResource(host, url), { blocked: false, status: 200 }, `${host}${url}`);
      assert.deepEqual(devResource(host, url, "no-cors", "cross-site"), { blocked: false, status: 200 }, `${host}${url}`);
    }
  }
});

test("开发资源许可不写死个人地址，也不放行公网来源", (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  for (const entry of nextConfig.allowedDevOrigins ?? []) {
    assert.doesNotMatch(entry, /^\d+\.\d+\.\d+\.\d+$/, `不应写死具体 IP：${entry}`);
  }
  for (const host of ["untrusted.example", "203.0.113.9", "198.51.100.99"]) {
    assert.deepEqual(devResource(host, "/_next/static/chunks/scene.js"), { blocked: true, status: 403 }, host);
    assert.deepEqual(devResource(host, "/_next/static/chunks/scene.js", "no-cors", "cross-site"), { blocked: true, status: 403 }, host);
  }
  assert.ok(warning.mock.callCount() >= 1);
});
