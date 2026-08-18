(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var accent3 = style.getPropertyValue('--accent3').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  var palette = [accent, accent2, accent3, warn, accent + '99', accent2 + '99'];

  // --- Chart: 模块功能点分布 ---
  var chart1 = echarts.init(document.getElementById('chart-modules'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true },
    grid: { left: '3%', right: '8%', bottom: '6%', top: '6%', containLabel: true },
    xAxis: {
      type: 'value',
      name: '功能点数',
      nameTextStyle: { color: muted },
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'category',
      data: [
        '日常管理', '吃啥', '首页', '任务', '日程', '设置', '学习',
        '热点', '创作', '热播', '数据', '倒数日', '笔记', '文件'
      ],
      axisLabel: { color: ink, fontSize: 12 },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'bar',
      data: [28, 16, 14, 10, 9, 8, 7, 6, 6, 5, 5, 5, 4, 3],
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: accent },
          { offset: 1, color: accent2 }
        ]),
        borderRadius: [0, 6, 6, 0]
      },
      label: { show: true, position: 'right', color: ink, fontSize: 11 }
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart: 代码行数分布 ---
  var chart2 = echarts.init(document.getElementById('chart-code'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: '{b}: {c} 行 ({d}%)'
    },
    series: [{
      type: 'pie',
      radius: ['45%', '75%'],
      center: ['50%', '50%'],
      roseType: 'area',
      itemStyle: { borderRadius: 6, borderColor: bg2, borderWidth: 3 },
      label: {
        color: ink,
        formatter: '{b}\n{d}%'
      },
      data: [
        { value: 2800, name: 'JavaScript 逻辑', itemStyle: { color: accent } },
        { value: 1400, name: 'HTML 结构', itemStyle: { color: accent2 } },
        { value: 600, name: 'CSS 样式', itemStyle: { color: accent3 } },
        { value: 264, name: 'Worker 代理', itemStyle: { color: warn } },
        { value: 58, name: 'SW 缓存', itemStyle: { color: accent + '99' } }
      ],
      emphasis: {
        label: { fontSize: 16, fontWeight: 'bold' }
      }
    }]
  });
  window.addEventListener('resize', function() { chart2.resize(); });
})();