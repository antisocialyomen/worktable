// functions/api/proxy.js
export async function onRequest(context) {
  const url = new URL(context.request.url);
  // 从 URL 参数中获取目标地址
  const target = url.searchParams.get('url');
  
  if (!target) {
    return new Response(JSON.stringify({ error: '缺少 url 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 由 Cloudflare 服务器去请求目标，不存在跨域问题
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    const body = await res.text();
    
    // 返回数据，并加上允许跨域的头
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '请求失败: ' + e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}