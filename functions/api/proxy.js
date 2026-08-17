// Cloudflare Pages Functions 代理中转
// 解决浏览器 CORS 跨域限制，让 Cloudflare 服务器帮你请求目标 API
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
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });

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