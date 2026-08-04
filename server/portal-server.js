"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { recordUsageEvent, isAllowedUsageEvent, buildUserUsageCounter } = require("../monitor/user-usage-counter");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const NO_STORE_CACHE = "no-store, no-cache, must-revalidate, proxy-revalidate";
const SERVER_BUILD_ID =
  process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || process.env.GIT_COMMIT || "local";

const CACHE_CONTROL_PATHS = {
  "/index.html": NO_STORE_CACHE,
  "/data/public/phase1_updates.json": NO_STORE_CACHE,
  "/data/public/communication_status.json": NO_STORE_CACHE,
  "/data/public/status.json": NO_STORE_CACHE,
  "/data/public/x_feed_preview.json": NO_STORE_CACHE,
  "/data/public/disaster_locations.json": NO_STORE_CACHE,
  "/data/public/water_cross_view.json": NO_STORE_CACHE,
  "/data/public/water_search_index.json": NO_STORE_CACHE,
  "/data/public/disaster_search_index.json": NO_STORE_CACHE
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function normalizePathname(pathname) {
  if (!pathname) {
    return "/";
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function shouldApplyNoStore(urlPath) {
  return urlPath.indexOf("/api/") === 0 || urlPath.indexOf("/data/operation_monitor/") === 0;
}

function applyNoStoreHeaders(res) {
  res.setHeader("Cache-Control", NO_STORE_CACHE);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function sendJson(res, statusCode, payload) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": NO_STORE_CACHE,
    "Pragma": "no-cache",
    "Expires": "0"
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    let data = "";
    req.on("data", function (chunk) {
      data += chunk;
      if (data.length > 1024) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", function () {
      resolve(data);
    });
    req.on("error", reject);
  });
}

function resolveFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/" || decoded === "") {
    return path.join(ROOT, "index.html");
  }
  const candidate = path.normalize(path.join(ROOT, decoded.replace(/^\//, "")));
  if (!candidate.startsWith(ROOT)) {
    return null;
  }
  return candidate;
}

function serveStatic(req, res, urlPath) {
  const filePath = resolveFilePath(urlPath);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
  };
  const cacheControl = CACHE_CONTROL_PATHS[urlPath];
  if (cacheControl) {
    headers["Cache-Control"] = cacheControl;
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  } else if (shouldApplyNoStore(urlPath)) {
    headers["Cache-Control"] = NO_STORE_CACHE;
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

async function handleUsageEvent(req, res) {
  try {
    const raw = await readRequestBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const eventName = payload && payload.event;

    if (!isAllowedUsageEvent(eventName)) {
      sendJson(res, 400, { ok: false, error: "invalid event" });
      return;
    }

    const result = recordUsageEvent(eventName);
    if (!result.ok) {
      sendJson(res, 500, { ok: false, error: result.error || "record failed" });
      return;
    }
    sendJson(res, 200, { ok: true, event: result.event, recorded_at: result.recorded_at });
  } catch (err) {
    console.error("[usage-event] request failed:", err && err.message || err);
    sendJson(res, 400, { ok: false, error: "invalid request" });
  }
}

function handleUsageCounter(req, res) {
  try {
    const report = buildUserUsageCounter();
    sendJson(res, 200, report);
  } catch (err) {
    console.error("[usage-counter] read failed:", err && err.message || err);
    sendJson(res, 500, { ok: false, error: "counter read failed" });
  }
}

function handleHealth(req, res) {
  sendJson(res, 200, {
    ok: true,
    service: "portal-server",
    runtime: "node",
    build_id: SERVER_BUILD_ID,
    routes: ["/api/health", "/api/usage-counter", "/api/usage-event"]
  });
}

function createPortalServer() {
  return http.createServer(function (req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = normalizePathname(url.pathname);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (shouldApplyNoStore(pathname)) {
      applyNoStoreHeaders(res);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      handleHealth(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/usage-event") {
      handleUsageEvent(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/usage-counter") {
      handleUsageCounter(req, res);
      return;
    }

    if (pathname.indexOf("/api/") === 0) {
      sendJson(res, 404, { ok: false, error: "api route not found", path: pathname });
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res, pathname);
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  });
}

function startPortalServer(options) {
  options = options || {};
  const server = createPortalServer();
  const port = options.port || PORT;
  return new Promise(function (resolve) {
    server.listen(port, function () {
      console.log(
        "[portal-server] listening on port " +
          port +
          " build_id=" +
          SERVER_BUILD_ID +
          " routes=/api/health,/api/usage-counter,/api/usage-event"
      );
      resolve({ server: server, port: port });
    });
  });
}

if (require.main === module) {
  startPortalServer().then(function (info) {
    console.log("Portal server listening on port " + info.port);
  });
}

module.exports = {
  createPortalServer,
  startPortalServer,
  ROOT,
  PORT,
  NO_STORE_CACHE,
  normalizePathname
};
