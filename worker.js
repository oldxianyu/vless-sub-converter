/**
 * VLESS to Clash 订阅转换器 (KV 存储 + 安全防刷 + 自动重命名版)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === 1. 订阅下载接口 ===
    if (path.startsWith("/sub/")) {
      const key = path.split("/")[2];
      // 检查 KV 是否绑定
      if (!env.KV) return new Response("❌ 配置错误: KV 未绑定", { status: 500 });
      
      const vlessData = await env.KV.get(key);
      if (!vlessData) return new Response("❌ 订阅不存在或已过期", { status: 404, headers: { "Content-Type": "text/plain;charset=utf-8" } });

      try {
        const proxies = vlessData.split('\n').map(l => l.trim()).filter(l => l.startsWith('vless://')).map(parseVless).filter(p => p);
        return new Response(generateFullConfig(proxies), {
          headers: {
            "content-type": "text/yaml;charset=UTF-8",
            "subscription-userinfo": "upload=0; download=0; total=10737418240000000; expire=2546249531",
            "profile-update-interval": "24",
          }
        });
      } catch (e) { return new Response("Error: " + e.message, { status: 500 }); }
    }

    // === 2. API 保存接口 ===
    if (request.method === "POST" && path === "/save") {
      try {
        if (!env.KV) return new Response(JSON.stringify({ success: false, msg: "KV 未绑定，请检查 Cloudflare 设置" }), { status: 500 });

        // [1] 获取用户 IP
        const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
        const limitKey = `ratelimit:${clientIP}`;

        // [2] 读取当前 IP 频率限制
        const currentCountStr = await env.KV.get(limitKey);
        let currentCount = parseInt(currentCountStr || "0");

        if (currentCount >= 5) {
          return new Response(JSON.stringify({ success: false, msg: "⛔️ 操作太频繁！(60秒内限5次)" }), { status: 429 });
        }

        const { id, content } = await request.json();

        // [3] 基础参数检查
        if (!id || !content) return new Response(JSON.stringify({ success: false, msg: "缺少参数" }), { status: 400 });
        if (content.length > 50000) return new Response(JSON.stringify({ success: false, msg: "❌ 内容过长 (超过50KB)" }), { status: 413 });

        // [4] 🌟 智能重命名逻辑
        let finalId = id;
        let isDuplicate = await env.KV.get(finalId);
        let renamed = false;

        // 如果 ID 存在，循环生成后缀
        while (isDuplicate) {
           renamed = true;
           const randomSuffix = Math.random().toString(36).substring(2, 4);
           finalId = `${id}_${randomSuffix}`;
           isDuplicate = await env.KV.get(finalId);
        }

        // [5] 执行保存
        await env.KV.put(finalId, content); 
        
        // [6] 更新频率计数器
        await env.KV.put(limitKey, (currentCount + 1).toString(), { expirationTtl: 60 });

        // [7] 返回结果
        return new Response(JSON.stringify({ 
          success: true, 
          newId: finalId, 
          renamed: renamed 
        }));

      } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
    }

    // === 3. 返回 UI 界面 ===
    return new Response(html(url.origin), {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};

// --- 后端处理逻辑 ---
function generateFullConfig(proxies) {
  const nodeNames = proxies.map(p => p.name);
  let pSection = "proxies:\n";
  proxies.forEach(p => {
    pSection += `  - { name: "${p.name}", type: ${p.type}, server: ${p.server}, port: ${p.port}, uuid: ${p.uuid}, network: ${p.network}, tls: ${p.tls}, udp: ${p.udp}, servername: "${p.servername||''}", client-fingerprint: "${p['client-fingerprint']}"`;
    if(p.flow) pSection += `, flow: "${p.flow}"`;
    if(p['reality-opts']) pSection += `, reality-opts: { public-key: "${p['reality-opts']['public-key']}", short-id: "${p['reality-opts']['short-id']}" }`;
    if(p['ws-opts']) pSection += `, ws-opts: { path: "${p['ws-opts'].path}", headers: { Host: "${p['ws-opts'].headers.Host}" } }`;
    if(p['grpc-opts']) pSection += `, grpc-opts: { grpc-service-name: "${p['grpc-opts']['grpc-service-name']}" }`;
    pSection += " }\n";
  });

  const gSection = `
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
${nodeNames.map(n => `      - "${n}"`).join('\n')}
      - DIRECT
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    proxies:
${nodeNames.map(n => `      - "${n}"`).join('\n')}
  - name: 🍎 Apple
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择
  - name: 📢 Google
    type: select
    proxies:
      - 🚀 节点选择
      - DIRECT
  - name: 🛑 广告拦截
    type: select
    proxies:
      - REJECT
      - DIRECT
`;
  const staticConf = `port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
rule-providers:
  reject: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt", path: ./ruleset/reject.yaml, interval: 86400 }
  icloud: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt", path: ./ruleset/icloud.yaml, interval: 86400 }
  apple: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt", path: ./ruleset/apple.yaml, interval: 86400 }
  google: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt", path: ./ruleset/google.yaml, interval: 86400 }
  proxy: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt", path: ./ruleset/proxy.yaml, interval: 86400 }
  direct: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt", path: ./ruleset/direct.yaml, interval: 86400 }
  private: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt", path: ./ruleset/private.yaml, interval: 86400 }
  gfw: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt", path: ./ruleset/gfw.yaml, interval: 86400 }
  tld-not-cn: { type: http, behavior: domain, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt", path: ./ruleset/tld-not-cn.yaml, interval: 86400 }
  telegramcidr: { type: http, behavior: ipcidr, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt", path: ./ruleset/telegramcidr.yaml, interval: 86400 }
  cncidr: { type: http, behavior: ipcidr, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt", path: ./ruleset/cncidr.yaml, interval: 86400 }
  lancidr: { type: http, behavior: ipcidr, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt", path: ./ruleset/lancidr.yaml, interval: 86400 }
  applications: { type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt", path: ./ruleset/applications.yaml, interval: 86400 }
rules:
  - RULE-SET,applications,DIRECT
  - RULE-SET,private,DIRECT
  - RULE-SET,reject,🛑 广告拦截
  - RULE-SET,icloud,DIRECT
  - RULE-SET,apple,🍎 Apple
  - RULE-SET,google,📢 Google
  - RULE-SET,proxy,🚀 节点选择
  - RULE-SET,gfw,🚀 节点选择
  - RULE-SET,tld-not-cn,🚀 节点选择
  - RULE-SET,telegramcidr,🚀 节点选择
  - RULE-SET,direct,DIRECT
  - RULE-SET,lancidr,DIRECT
  - RULE-SET,cncidr,DIRECT
  - GEOIP,LAN,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,🚀 节点选择
`;
  return staticConf + pSection + gSection;
}

function parseVless(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams;
    const name = decodeURIComponent(u.hash.slice(1)) || u.hostname;
    const proxy = {
      name: name, type: "vless", server: u.hostname, port: parseInt(u.port||443), uuid: u.username,
      network: p.get("type")||"tcp", tls: true, udp: true, "client-fingerprint": p.get("fp")||"chrome"
    };
    if(p.get("flow")) proxy.flow = p.get("flow");
    if(p.get("security")==="reality") {
      proxy["reality-opts"] = { "public-key": p.get("pbk"), "short-id": p.get("sid")||"" };
      if(p.get("sni")) proxy.servername = p.get("sni");
    } else {
      if(p.get("security")==="tls") { proxy.tls=true; if(p.get("sni")) proxy.servername=p.get("sni"); }
      else if(!p.get("security")) proxy.tls=false;
    }
    if(proxy.network==="ws") proxy["ws-opts"]={path:p.get("path")||"/", headers:{Host:p.get("host")||p.get("sni")}};
    if(proxy.network==="grpc") proxy["grpc-opts"]={"grpc-service-name":p.get("serviceName")||""};
    return proxy;
  } catch(e) { return null; }
}

// --- 前端 UI (修复了换行符转义问题) ---
const html = (origin) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clash 订阅转换器</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
  <style>
    :root { --primary: #6366f1; --primary-hover: #4f46e5; --bg: #f3f4f6; --card-bg: #ffffff; --text-main: #1f2937; --text-sub: #6b7280; --border: #e5e7eb; }
    body { font-family: 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text-main); display: flex; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .container { width: 100%; max-width: 600px; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 24px; font-weight: 700; margin: 0; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header p { color: var(--text-sub); margin-top: 8px; font-size: 14px; }
    .card { background: var(--card-bg); border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); padding: 24px; margin-bottom: 20px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--text-main); }
    textarea, input { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; box-sizing: border-box; transition: all 0.2s; font-family: 'Menlo', monospace; }
    textarea:focus, input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2); }
    textarea { height: 150px; resize: vertical; }
    .row { display: flex; gap: 12px; }
    .btn { background: var(--primary); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; width: 100%; }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn:disabled { background: #9ca3af; cursor: not-allowed; }
    .result-card { display: none; background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 12px; padding: 16px; animation: fadeIn 0.3s ease; }
    .link-box { background: rgba(255,255,255,0.6); padding: 10px; border-radius: 6px; word-break: break-all; font-family: monospace; color: #065f46; font-size: 13px; border: 1px solid #a7f3d0; margin-bottom: 12px; }
    .btn-copy { background: #059669; color: white; padding: 8px 16px; border-radius: 6px; font-size: 13px; border: none; cursor: pointer; }
    .btn-copy:hover { background: #047857; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 40px; }
  </style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Clash 订阅转换器</h1><p>支持 VLESS Reality / Vision / GRPC 协议</p></div>
  <div class="card">
    <div class="form-group"><label>1. 粘贴节点链接 (每行一个)</label><textarea id="nodes" placeholder="vless://...&#10;vless://..."></textarea></div>
    <div class="row">
      <div style="flex: 2;"><label>2. 设置订阅 ID</label><input type="text" id="subId" placeholder="例如: my-iphone"></div>
      <div style="flex: 1; display: flex; align-items: flex-end;"><button class="btn" onclick="save()" id="submitBtn">生成订阅</button></div>
    </div>
  </div>
  <div id="result" class="result-card">
    <div style="color:#047857;font-weight:600;margin-bottom:8px">✅ 订阅创建成功</div>
    <div class="link-box" id="linkText"></div>
    <button class="btn-copy" onclick="copyLink()">复制订阅链接</button>
  </div>
  <div class="footer">Powered by Xyz</div>
</div>
<script>
async function save() {
  const content = document.getElementById('nodes').value.trim();
  const id = document.getElementById('subId').value.trim();
  
  if(!content) return alert("请先粘贴节点链接");
  if(!id) return alert("请设置一个订阅 ID");
  if(/[^a-zA-Z0-9-_]/.test(id)) return alert("ID 只能包含字母、数字、下划线");

  const btn = document.getElementById('submitBtn');
  const originalText = btn.innerText;
  btn.innerText = "处理中...";
  btn.disabled = true;

  try {
    const res = await fetch("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content })
    });
    const data = await res.json();
    
    if(data.success) {
      const finalId = data.newId; 
      const fullUrl = "${origin}/sub/" + finalId;
      
      document.getElementById('linkText').innerText = fullUrl;
      document.getElementById('result').style.display = 'block';

      if (data.renamed) {
          // ⚠️ 这里是修复的关键：将 \\n 换成了 \\\\n
          alert("⚠️ 提示：ID \\"" + id + "\\" 已被占用。\\\\n系统已自动为您更名为 \\"" + finalId + "\\"");
          document.getElementById('subId').value = finalId;
      }

      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else {
      alert(data.msg);
    }
  } catch(e) {
    alert("网络请求出错: " + e.message);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}
function copyLink() {
  const text = document.getElementById('linkText').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.btn-copy');
    btn.innerText = "已复制！";
    setTimeout(() => btn.innerText = "复制订阅链接", 2000);
  });
}
</script>
</body>
</html>
`;
