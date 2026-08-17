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
      'Accept-Language': 'zh-CN,zh;q=0.9'
    };

    // 雪球需要 Cookie 认证：先访问首页获取 Cookie，再请求 API
    if (target.includes('xueqiu.com')) {
      const cookieRes = await fetch('https://xueqiu.com', {
        headers: { ...headers, 'Accept': 'text/html,application/xhtml+xml' }
      });
      const setCookie = cookieRes.headers.get('set-cookie');
      if (setCookie) {
        // 提取 xq_a_token 和 xq_r_token
        const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
        headers['Cookie'] = cookies;
      }
    }

    const res = await fetch(target, { headers });

    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
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