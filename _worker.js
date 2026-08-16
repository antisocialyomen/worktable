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