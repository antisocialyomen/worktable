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

    // 处理 /api/webdav 路径 → 代理到用户 WebDAV 服务（解决浏览器 CORS 跨域）
    if (path === '/api/webdav' || path.startsWith('/api/webdav/')) {
      return handleWebDAVProxy(request);
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
  if (request.method === 'PUT') {
    try { init.body = await request.text(); }
    catch (e) { clearTimeout(timer); return jsonError(400, '读取请求体失败：' + e.message); }
  }

  try {
    const response = await fetch(targetUrl, init);
    clearTimeout(timer);
    const status = response.status;
    // 上游返回 5xx（含 Cloudflare 边缘把畸形/超时响应包装成的 520）时，
    // 不再原样透传给前端，否则前端会看到 520。统一返回干净 JSON 502。
    if (status >= 500) {
      return jsonError(502, '云同步服务暂时不可用（上游返回 ' + status + '），请稍后重试，或检查 WebDAV 地址与密码');
    }
    // 以文本读取后转发，避免直接透传上游二进制/畸形响应
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

function jsonError(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
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