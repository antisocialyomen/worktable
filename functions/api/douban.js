// Cloudflare Pages Functions - 豆瓣API代理
// 路径：/api/douban/* → https://movie.douban.com/*
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace('/api/douban', '');
  const target = 'https://movie.douban.com' + path + url.search;

  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://movie.douban.com/'
      },
      redirect: 'follow'
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
    return new Response(JSON.stringify({ error: '豆瓣代理请求失败: ' + e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}