// Cloudflare Pages Functions 代理中转
// 解决浏览器 CORS 跨域限制，自动处理 Cookie 认证
// 调用方式：/api/proxy?url=目标地址

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: '缺少 url 参数，用法：/api/proxy?url=目标地址' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
    };

    // 雪球需要 Cookie 认证：先访问首页获取 Cookie，再请求 API
    if (target.includes('xueqiu.com')) {
      try {
        const cookieRes = await fetch('https://xueqiu.com', {
          headers: { ...headers, 'Accept': 'text/html,application/xhtml+xml' },
          redirect: 'follow'
        });
        const setCookie = cookieRes.headers.get('set-cookie');
        if (setCookie) {
          const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
          headers['Cookie'] = cookies;
        }
      } catch (e) {
        // Cookie 获取失败，继续尝试无 Cookie 请求
      }
    }

    // 财联社需要特定 Referer
    if (target.includes('cls.cn')) {
      headers['Referer'] = 'https://www.cls.cn/';
    }

    // 豆瓣需要 Referer 和特定 Accept
    if (target.includes('douban.com')) {
      headers['Referer'] = 'https://movie.douban.com/';
      headers['Accept'] = 'application/json, text/plain, */*';
    }

    const res = await fetch(target, { headers, redirect: 'follow' });

    const contentType = res.headers.get('Content-Type') || 'application/json';
    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': contentType.includes('text/html') ? 'application/json' : contentType,
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '代理请求失败: ' + e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}