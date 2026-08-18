var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/douban/")) {
      return handleDoubanProxy(path, url.search);
    }
    if (path === "/api/webdav" || path.startsWith("/api/webdav/")) {
      return handleWebDAVProxy(request);
    }
    if (path === "/api/sync" || path === "/api/sync/status") {
      return handleSyncApi(request, env);
    }
    try {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) {
        return response;
      }
    } catch (e) {
    }
    const indexResponse = await env.ASSETS.fetch(new Request(new URL("/index.html", url)));
    if (indexResponse.status !== 404) {
      return new Response(indexResponse.body, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0"
        }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
async function handleWebDAVProxy(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  const wdUrl = request.headers.get("X-WD-URL");
  const wdUser = request.headers.get("X-WD-USER");
  const wdPass = request.headers.get("X-WD-PASS");
  const wdFile = request.headers.get("X-WD-FILE") || "workbench-data.json";
  if (!wdUrl || !wdUser || !wdPass) {
    return jsonError(400, "\u7F3A\u5C11 WebDAV \u51ED\u636E");
  }
  let targetUrl;
  try {
    targetUrl = new URL(wdFile, wdUrl.replace(/\/+$/, "") + "/").href;
  } catch (e) {
    return jsonError(400, "WebDAV \u5730\u5740\u683C\u5F0F\u9519\u8BEF\uFF1A" + e.message);
  }
  const auth = "Basic " + b64(wdUser + ":" + wdPass);
  let bodyText = null;
  if (request.method === "PUT") {
    try {
      bodyText = await request.text();
    } catch (e) {
      return jsonError(400, "\u8BFB\u53D6\u8BF7\u6C42\u4F53\u5931\u8D25\uFF1A" + e.message);
    }
  }
  let targetHost = "WebDAV";
  try {
    targetHost = new URL(wdUrl).host;
  } catch (e) {
  }
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25e3);
    const init = {
      method: request.method,
      headers: {
        "Authorization": auth,
        "User-Agent": "Mozilla/5.0 (compatible; WorkbenchSync/1.0)",
        "Content-Type": request.headers.get("Content-Type") || "application/json"
      },
      signal: controller.signal
    };
    if (bodyText !== null) init.body = bodyText;
    try {
      const response = await fetch(targetUrl, init);
      clearTimeout(timer);
      const status = response.status;
      if (status >= 500) {
        lastStatus = status;
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return jsonError(502, "\u4E91\u540C\u6B65\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF08" + targetHost + " \u8FD4\u56DE " + status + "\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF0C\u6216\u68C0\u67E5 WebDAV \u5730\u5740\u4E0E\u5BC6\u7801");
      }
      const text = await response.text();
      const ctype = response.headers.get("Content-Type") || "application/json; charset=utf-8";
      return new Response(text, {
        status,
        headers: {
          "Content-Type": ctype,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE"
        }
      });
    } catch (error) {
      clearTimeout(timer);
      if (error && error.name === "AbortError") {
        return jsonError(504, "\u8FDE\u63A5 WebDAV \u8D85\u65F6\uFF0825 \u79D2\uFF09\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u6216\u7F51\u7EDC\u662F\u5426\u53EF\u8FBE");
      }
      return jsonError(502, "WebDAV \u4EE3\u7406\u5931\u8D25\uFF1A" + (error ? error.message : "\u672A\u77E5\u9519\u8BEF"));
    }
  }
  return jsonError(502, "\u4E91\u540C\u6B65\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF08" + targetHost + " \u8FD4\u56DE " + lastStatus + "\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF0C\u6216\u68C0\u67E5 WebDAV \u5730\u5740\u4E0E\u5BC6\u7801");
}
__name(handleWebDAVProxy, "handleWebDAVProxy");
function jsonError(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
  });
}
__name(jsonError, "jsonError");
async function handleSyncApi(request, env) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  const url = new URL(request.url);
  const KV = env && (env.SYNC_KV || env["workbench-data"]);
  if (url.pathname === "/api/sync/status" && request.method === "GET") {
    return new Response(JSON.stringify({
      kv: !!KV,
      name: KV ? env.SYNC_KV ? "SYNC_KV" : "workbench-data" : null
    }), { status: 200, headers: cors });
  }
  const KEY = "workbench-sync-v1";
  if (KV) {
    if (request.method === "GET") {
      try {
        const data = await KV.get(KEY, "text");
        return new Response(data || "{}", { status: 200, headers: cors });
      } catch (e) {
        return jsonError(502, "\u8BFB\u53D6 KV \u5931\u8D25\uFF1A" + (e ? e.message : "\u672A\u77E5\u9519\u8BEF"));
      }
    }
    if (request.method === "PUT") {
      let body;
      try {
        body = await request.text();
      } catch (e) {
        return jsonError(400, "\u8BFB\u53D6\u8BF7\u6C42\u4F53\u5931\u8D25\uFF1A" + e.message);
      }
      try {
        JSON.parse(body);
      } catch (e) {
        return jsonError(400, "\u6570\u636E\u683C\u5F0F\u9519\u8BEF\uFF1A\u4E0D\u662F\u5408\u6CD5 JSON");
      }
      try {
        await KV.put(KEY, body);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      } catch (e) {
        return jsonError(502, "\u5199\u5165 KV \u5931\u8D25\uFF1A" + (e ? e.message : "\u672A\u77E5\u9519\u8BEF"));
      }
    }
    return jsonError(405, "\u4E0D\u652F\u6301\u7684\u65B9\u6CD5");
  }
  return handleWebDAVProxy(request);
}
__name(handleSyncApi, "handleSyncApi");
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
__name(b64, "b64");
async function handleDoubanProxy(path, search) {
  const doubanPath = path.replace("/api/douban", "");
  const doubanUrl = "https://movie.douban.com" + doubanPath + search;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://movie.douban.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Origin": "https://movie.douban.com"
  };
  try {
    const response = await fetch(doubanUrl, { headers });
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "\u8C46\u74E3API\u8BF7\u6C42\u5931\u8D25", status: response.status }), {
        status: response.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "\u4EE3\u7406\u8BF7\u6C42\u5931\u8D25", detail: error.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
__name(handleDoubanProxy, "handleDoubanProxy");

// C:/Users/Admin/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/Admin/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError2;

// .wrangler/tmp/bundle-PbBl89/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// C:/Users/Admin/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-PbBl89/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=bundledWorker-0.2809590402000448.mjs.map
