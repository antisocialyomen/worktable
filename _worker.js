// Cloudflare Worker - 豆瓣 API 代理 + 静态文件托管
// 部署方式：将此文件放在 Cloudflare Pages 项目的根目录
// Cloudflare Pages 会自动识别并启用 Worker

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 处理 /api/douban/* 路径 → 代理到豆瓣 API
    if (path.startsWith('/api/douban/')) {
      return handleDoubanProxy(path, url.search);
    }

    // 处理 /img-proxy 路径 → 代理豆瓣图片，添加 Referer 绕过防盗链
    if (path === '/img-proxy') {
      return handleImageProxy(url);
    }

    // 处理 /api/webdav 路径 → 代理到用户 WebDAV 服务（解决浏览器 CORS 跨域）
    if (path === '/api/webdav' || path.startsWith('/api/webdav/')) {
      return handleWebDAVProxy(request);
    }

    // 处理 /api/sync 路径 → 优先 Cloudflare KV，未绑定则回退 WebDAV 代理
    if (path === '/api/sync' || path === '/api/sync/status') {
      return handleSyncApi(request, env);
    }

    // 处理 /api/ai 路径 → 记账智能分类（零样本，不依赖预置词库）；未绑定 AI 时优雅降级
    if (path === '/api/ai') {
      return handleAi(request, env);
    }

    // 其他路径 → 交给 Cloudflare Pages 托管静态文件
    // env.ASSETS.fetch 会从 Pages 的静态资源中查找并返回文件
    try {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) {
        return response;
      }
    } catch (e) {
      // 降级处理
    }

    // 如果没找到文件，返回 index.html（支持 SPA 路由）
    const indexResponse = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
    if (indexResponse.status !== 404) {
      return new Response(indexResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=0'
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleWebDAVProxy(request) {
  // 处理浏览器 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const wdUrl = request.headers.get('X-WD-URL');
  const wdUser = request.headers.get('X-WD-USER');
  const wdPass = request.headers.get('X-WD-PASS');
  const wdFile = request.headers.get('X-WD-FILE') || 'workbench-data.json';

  if (!wdUrl || !wdUser || !wdPass) {
    return jsonError(400, '缺少 WebDAV 凭据');
  }

  let targetUrl;
  try {
    targetUrl = new URL(wdFile, wdUrl.replace(/\/+$/, '') + '/').href;
  } catch (e) {
    return jsonError(400, 'WebDAV 地址格式错误：' + e.message);
  }

  const auth = 'Basic ' + b64(wdUser + ':' + wdPass);
  // PUT 请求体提前读取，避免在重试循环中重复消费请求流
  let bodyText = null;
  if (request.method === 'PUT') {
    try { bodyText = await request.text(); }
    catch (e) { return jsonError(400, '读取请求体失败：' + e.message); }
  }

  let targetHost = 'WebDAV';
  try { targetHost = new URL(wdUrl).host; } catch (e) {}

  // 上游偶发 5xx（含 Cloudflare 边缘把畸形/超时响应包装成的 520）时自动重试一次，
  // 不顺延过多以免拖慢同步；若仍失败则返回干净 JSON 502 并附上游主机名，便于定位。
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const init = {
      method: request.method,
      headers: {
        'Authorization': auth,
        'User-Agent': 'Mozilla/5.0 (compatible; WorkbenchSync/1.0)',
        'Content-Type': request.headers.get('Content-Type') || 'application/json'
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
        if (attempt < 1) { await new Promise(r => setTimeout(r, 800)); continue; }
        return jsonError(502, '云同步服务暂时不可用（' + targetHost + ' 返回 ' + status + '），请稍后重试，或检查 WebDAV 地址与密码');
      }
      const text = await response.text();
      const ctype = response.headers.get('Content-Type') || 'application/json; charset=utf-8';
      return new Response(text, {
        status,
        headers: {
          'Content-Type': ctype,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE'
        }
      });
    } catch (error) {
      clearTimeout(timer);
      if (error && error.name === 'AbortError') {
        return jsonError(504, '连接 WebDAV 超时（25 秒），请检查地址或网络是否可达');
      }
      return jsonError(502, 'WebDAV 代理失败：' + (error ? error.message : '未知错误'));
    }
  }
  return jsonError(502, '云同步服务暂时不可用（' + targetHost + ' 返回 ' + lastStatus + '），请稍后重试，或检查 WebDAV 地址与密码');
}

function jsonError(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

// 云同步统一入口：Cloudflare KV 优先；未绑定 KV 时回退到 WebDAV 代理。
// KV 是 Cloudflare 原生存储，不存在 CORS/520/超时问题，最适合本应用跨设备同步。
async function handleSyncApi(request, env) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // 浏览器 CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-WD-URL, X-WD-USER, X-WD-PASS, X-WD-FILE',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const url = new URL(request.url);

  // 兼容两种绑定写法：推荐 Variable name = SYNC_KV；旧/误填 workbench-data 也支持
  const KV = env && (env.SYNC_KV || env['workbench-data']);

  // 模式探测：KV 是否已绑定（前端据此决定是否要展示 WebDAV 配置）
  if (url.pathname === '/api/sync/status' && request.method === 'GET') {
    return new Response(JSON.stringify({
      kv: !!KV,
      name: KV ? (env.SYNC_KV ? 'SYNC_KV' : 'workbench-data') : null
    }), { status: 200, headers: cors });
  }

  const KEY = 'workbench-sync-v1';

  // 优先使用 Cloudflare KV（原生、无 CORS/超时问题）
  if (KV) {
    if (request.method === 'GET') {
      try {
        const data = await KV.get(KEY, 'text');
        return new Response(data || '{}', { status: 200, headers: cors });
      } catch (e) {
        return jsonError(502, '读取 KV 失败：' + (e ? e.message : '未知错误'));
      }
    }
    if (request.method === 'PUT') {
      let body;
      try { body = await request.text(); } catch (e) { return jsonError(400, '读取请求体失败：' + e.message); }
      try { JSON.parse(body); } catch (e) { return jsonError(400, '数据格式错误：不是合法 JSON'); }
      try {
        await KV.put(KEY, body);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      } catch (e) {
        return jsonError(502, '写入 KV 失败：' + (e ? e.message : '未知错误'));
      }
    }
    return jsonError(405, '不支持的方法');
  }

  // 未绑定 KV → 回退到 WebDAV 代理（老用户/其他 WebDAV 服务仍可工作）
  return handleWebDAVProxy(request);
}

// 记账智能分类：前端把消费名称 + 现有分类体系发来，Worker 调 Workers AI 做零样本分类。
// 不绑定 AI（env.AI 不存在）或调用失败 → 返回 ai:false，前端自动回退关键词逻辑，功能不中断。
async function handleAi(request, env) {
  const cors = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return jsonError(405, '仅支持 POST');
  }
  if (!env.AI) {
    return new Response(JSON.stringify({ ai: false, reason: 'AI 未绑定' }), { status: 200, headers: cors });
  }
  let body;
  try { body = await request.json(); } catch (e) { return jsonError(400, '请求体非合法 JSON'); }
  const text = (body.text || '').toString().slice(0, 200).trim();
  if (!text) return jsonError(400, '缺少 text 字段');
  const eCats = Array.isArray(body.eCats) ? body.eCats : [];
  const iCats = Array.isArray(body.iCats) ? body.iCats : [];
  const eSubs = (body.eSubs && typeof body.eSubs === 'object') ? body.eSubs : {};
  const iSubs = (body.iSubs && typeof body.iSubs === 'object') ? body.iSubs : {};

  const subsDesc = (obj) => Object.keys(obj).map(k => k + '：' + (obj[k] || []).join('/')).join('；');
  const schema =
    '【支出一级分类】' + eCats.join('、') + '\n' +
    '【收入一级分类】' + iCats.join('、') + '\n' +
    '【支出二级分类】' + subsDesc(eSubs) + '\n' +
    '【收入二级分类】' + subsDesc(iSubs);

  const sys = '你是记账分类助手。只依据给定分类体系对消费名称做零样本分类，严禁自造分类，不要解释。';
  const user =
    schema + '\n\n消费名称：' + text + '\n\n请严格只输出一个 JSON 对象（不要代码块、不要额外文字）：\n' +
    '{"type":"e 或 i（e=支出，i=收入）","cat":"一级分类名（必须来自上面体系，无匹配则空字符串）","sub":"二级分类名（必须来自该一级下的二级，无则空字符串）","reason":"10字内中文理由"}';

  try {
    const resp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      max_tokens: 200,
      temperature: 0.1,
      stream: false
    });
    const raw = (resp && resp.response) ? resp.response : '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return new Response(JSON.stringify({ ai: true, type: '', cat: '', sub: '', reason: '', raw }), { status: 200, headers: cors });
    let obj;
    try { obj = JSON.parse(m[0]); } catch (e) { return new Response(JSON.stringify({ ai: true, type: '', cat: '', sub: '', reason: '', raw }), { status: 200, headers: cors }); }
    let type = obj.type;
    if (type === '收入' || type === '收') type = 'i';
    if (type === '支出' || type === '支') type = 'e';
    if (type !== 'e' && type !== 'i') type = '';
    let cat = (typeof obj.cat === 'string') ? obj.cat.trim() : '';
    let sub = (typeof obj.sub === 'string') ? obj.sub.trim() : '';
    const validCats = type === 'i' ? iCats : eCats;
    if (cat && validCats.indexOf(cat) === -1) {
      const hit = validCats.find(c => c.indexOf(cat) > -1 || cat.indexOf(c) > -1);
      cat = hit || '';
    }
    const validSubs = type === 'i' ? (iSubs[cat] || []) : (eSubs[cat] || []);
    if (sub && validSubs.indexOf(sub) === -1) {
      const hit = validSubs.find(s => s.indexOf(sub) > -1 || sub.indexOf(s) > -1);
      sub = hit || '';
    }
    return new Response(JSON.stringify({ ai: true, type, cat, sub, reason: obj.reason || '', raw }), { status: 200, headers: cors });
  } catch (e) {
    return jsonError(502, 'AI 调用失败：' + (e ? e.message : '未知错误'));
  }
}

function b64(str) {
  // UTF-8 安全的 base64 编码，避免账号/密码含非 ASCII 字符时 btoa 抛错
  // 不用 unescape（Cloudflare Worker 某些环境可能不支持/会抛错）
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function handleDoubanProxy(path, search) {
  // 提取豆瓣 API 路径
  // /api/douban/j/search_subjects?type=movie&tag=热门
  const doubanPath = path.replace('/api/douban', '');
  const doubanUrl = 'https://movie.douban.com' + doubanPath + search;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://movie.douban.com/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': 'https://movie.douban.com'
  };

  try {
    const response = await fetch(doubanUrl, { headers });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: '豆瓣API请求失败', status: response.status }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: '代理请求失败', detail: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function handleImageProxy(url) {
  const imgUrl = url.searchParams.get('url');
  if (!imgUrl) return new Response('Missing url param', { status: 400 });
  try {
    const response = await fetch(imgUrl, {
      headers: {
        'Referer': 'https://movie.douban.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return new Response('Image proxy failed', { status: response.status });
    const contentType = response.headers.get('Content-Type') || 'image/jpeg';
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response('Image proxy error: ' + e.message, { status: 502 });
  }
}