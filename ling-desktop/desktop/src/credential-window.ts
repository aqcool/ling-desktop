import { themeStylesheet, palettes, parseWindowAppearance, type WindowAppearance, type ResolvedTheme } from 'ling-desktop/theme'

/** Static, isolated credential view. No DSH scripts, network resources or injected server text. */
export const CREDENTIAL_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; connect-src 'none'">
<title>服务器认证</title><style>
${themeStylesheet()}
*{box-sizing:border-box}
body{font-family:var(--font-ui);font-size:var(--font-size-compact);line-height:var(--line-body);color:var(--foreground);background:var(--surface);margin:0;padding:calc(var(--space-unit) * 5.5) calc(var(--space-unit) * 6)}
h1,h2,p{margin:0}
h1{max-width:445px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--font-size-lg);font-weight:650;letter-spacing:-.02em}
h2{font-size:var(--font-size-compact);font-weight:650}
.header,.section-head,.actions,.footer,.entry-row{display:flex;align-items:center;justify-content:space-between;gap:calc(var(--space-unit) * 3)}
.header{align-items:flex-start}
.server{max-width:445px;margin-top:calc(var(--space-unit) * 1.25);color:var(--text-secondary);font-size:var(--font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section{border-top:1px solid var(--panel-border);margin-top:calc(var(--space-unit) * 4.25);padding-top:15px}
.section-head{min-height:calc(var(--space-unit) * 6.25)}
.status{color:var(--text-secondary);font-size:var(--font-size-caption)}
.status--ok{color:var(--success)}
.status--warning{color:var(--danger)}
.head-actions{display:flex;align-items:center;gap:calc(var(--space-unit) * 2.25)}
.fingerprint-box{margin-top:calc(var(--space-unit) * 2.25);padding:calc(var(--space-unit) * 2.25) calc(var(--space-unit) * 2.75);border:1px solid var(--panel-border);border-radius:var(--corner-lg);background:var(--surface-secondary)}
.algorithm{color:var(--text-secondary);font-size:var(--font-size-micro);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.mono{margin-top:calc(var(--space-unit) * 0.75);font:var(--font-size-caption)/var(--line-body) var(--font-code);white-space:nowrap;overflow-x:auto;user-select:text}
.actions{justify-content:flex-end;margin-top:calc(var(--space-unit) * 1.75)}
.mode-switch{display:inline-flex;gap:calc(var(--space-unit) * 0.5);margin-top:calc(var(--space-unit) * 3);padding:calc(var(--space-unit) * 0.5);border-radius:var(--corner-lg);background:var(--surface-secondary)}
.mode-switch button{border:0;background:transparent;color:var(--text-secondary);min-height:calc(var(--space-unit) * 6.75);padding:calc(var(--space-unit) * 1) calc(var(--space-unit) * 2.75)}
.mode-switch button[aria-pressed=true]{background:var(--surface);color:inherit;box-shadow:var(--surface-shadow)}
.field{display:block;margin-top:calc(var(--space-unit) * 3);font-size:var(--font-size-xs);font-weight:550}
.entry-row{margin-top:calc(var(--space-unit) * 1.5)}
.entry-row input{flex:1;width:0}
.key-file{flex:1;min-width:0;color:var(--text-secondary);font-size:var(--font-size-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
input{height:var(--control-md);padding:calc(var(--space-unit) * 1.5) calc(var(--space-unit) * 2.25);border:1px solid var(--panel-border);border-radius:var(--corner-lg);background:var(--field-background);color:inherit;font:inherit}
button{min-height:calc(var(--space-unit) * 7.5);padding:calc(var(--space-unit) * 1.25) calc(var(--space-unit) * 2.5);border:1px solid var(--panel-border);border-radius:var(--corner-lg);background:var(--surface-secondary);color:inherit;font:inherit;white-space:nowrap;cursor:pointer}
button:hover:not(:disabled){filter:brightness(.97)}
button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
button:disabled{opacity:var(--disabled-opacity);cursor:default}
.icon-button{width:28px;min-height:calc(var(--space-unit) * 7);padding:0;border:0;background:transparent;color:var(--text-secondary);font-size:var(--font-size-xl);line-height:1}
.subtle{border:0;background:transparent;color:var(--text-secondary);padding:calc(var(--space-unit) * 0.75) calc(var(--space-unit) * 1.25);min-height:calc(var(--space-unit) * 6.25);font-size:var(--font-size-caption)}
.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-foreground)}
.danger{display:block;margin-top:calc(var(--space-unit) * 2.75);border:0;background:transparent;color:var(--danger);padding-left:0}
.footer{justify-content:flex-end;margin-top:calc(var(--space-unit) * 3.25)}
.feedback{margin-top:calc(var(--space-unit) * 2.5);color:var(--danger);font-size:var(--font-size-caption);line-height:1.5}
.feedback--ok{color:var(--success)}
.feedback:empty,.hidden{display:none!important}

</style></head><body>
<main id="sheet"><header class="header"><div><h1 id="server-title">服务器认证</h1><div id="server" class="server"></div></div><button id="close" class="icon-button" aria-label="关闭认证窗口" title="关闭">×</button></header>
<section class="section" aria-labelledby="fingerprint-title"><div class="section-head"><h2 id="fingerprint-title">主机指纹</h2><div class="head-actions"><span id="trust-state" class="status"></span><button id="rescan" class="subtle">重新读取</button></div></div><div class="fingerprint-box"><div id="algorithm" class="algorithm"></div><div id="fingerprint" class="mono">正在读取…</div></div><div id="trust-actions" class="actions hidden"><button id="trust" class="primary">确认指纹</button></div></section>
<section class="section" aria-labelledby="credential-title"><div class="section-head"><h2 id="credential-title">登录凭证</h2><div class="head-actions"><span id="credential-state" class="status"></span><button id="change" class="subtle hidden">更换</button></div></div>
<div id="credential-editor"><div class="mode-switch" aria-label="认证方式"><button id="password-mode" aria-pressed="true">密码</button><button id="key-mode" aria-pressed="false">私钥文件</button></div>
<div id="password-form"><label class="field" for="password">密码</label><div class="entry-row"><input id="password" type="password" autocomplete="new-password" spellcheck="false"><button id="save-password" class="primary">保存密码</button></div></div>
<div id="key-form" class="hidden"><div class="entry-row"><button id="choose-key">选择私钥文件</button><span id="key-file" class="key-file">未选择文件</span></div><label class="field" for="passphrase">私钥口令（可选）</label><div class="entry-row"><input id="passphrase" type="password" autocomplete="new-password" spellcheck="false"><button id="save-key" class="primary">保存私钥</button></div></div><button id="clear" class="danger">移除已存凭证</button></div></section>
<div id="message" class="feedback" role="status" aria-live="polite"></div><footer class="footer"><button id="test" class="primary">测试连接</button></footer></main>
<script>
const api=window.lingCredentials;
function applyTheme(value){if(!value||!${JSON.stringify(palettes.map(palette => palette.id))}.includes(value.palette)||!['light','dark'].includes(value.resolved))return;document.documentElement.dataset.palette=value.palette;document.documentElement.dataset.theme=value.resolved}
const stopTheme=api.onTheme(applyTheme);api.theme().then(applyTheme).catch(()=>{});window.addEventListener('unload',stopTheme,{once:true});
const $=id=>document.getElementById(id);let observed=null,trusted=false,busy=false,credential='none',editing=false,currentMode='password';
function message(value,ok=false){$('message').textContent=value;$('message').className=ok?'feedback feedback--ok':'feedback'}
function mode(value){currentMode=value;$('password-mode').setAttribute('aria-pressed',String(value==='password'));$('key-mode').setAttribute('aria-pressed',String(value==='key'));$('password-form').classList.toggle('hidden',value!=='password');$('key-form').classList.toggle('hidden',value!=='key')}
function credentialView(){$('credential-state').textContent=credential==='none'?'未设置':credential==='key'?'已保存私钥':'已保存密码';$('change').classList.toggle('hidden',credential==='none');$('change').textContent=editing?'取消':'更换';$('credential-editor').classList.toggle('hidden',credential!=='none'&&!editing);$('clear').classList.toggle('hidden',credential==='none');mode(currentMode)}
async function run(action){if(busy)return;busy=true;message('');try{await action()}catch(error){message(error?.message||'操作失败，请重试。')}finally{busy=false}}
async function refresh(){const data=await api.info();$('server-title').textContent=data.name;$('server').textContent=data.user+'@'+data.address+(data.port===22?'':':'+data.port);trusted=data.status.trusted;credential=data.status.credential;if(!editing&&credential!=='none')currentMode=credential==='key'?'key':'password';$('trust-state').textContent=trusted?'已信任':'待确认';$('trust-state').className=trusted?'status status--ok':'status';credentialView();$('save-password').disabled=!trusted;$('save-key').disabled=!trusted;$('choose-key').disabled=!trusted;$('test').disabled=!trusted||credential==='none';if(data.status.fingerprint&&!observed){$('algorithm').textContent=data.status.fingerprint.algorithm;$('fingerprint').textContent=data.status.fingerprint.sha256}}
async function inspect(){observed=null;$('trust-actions').classList.add('hidden');const data=await api.info();$('save-password').disabled=true;$('save-key').disabled=true;$('choose-key').disabled=true;$('test').disabled=true;$('algorithm').textContent='';$('fingerprint').textContent='正在读取…';try{observed=await api.inspect()}catch(error){$('algorithm').textContent=data.status.fingerprint?.algorithm||'';$('fingerprint').textContent=data.status.fingerprint?.sha256||'读取失败';throw error}$('algorithm').textContent=observed.algorithm;$('fingerprint').textContent=observed.sha256;const same=data.status.fingerprint?.sha256===observed.sha256&&data.status.fingerprint?.algorithm===observed.algorithm;$('trust-actions').classList.toggle('hidden',same);$('trust-state').textContent=same?'已信任':data.status.trusted?'指纹已变化':'待确认';$('trust-state').className=same?'status status--ok':data.status.trusted?'status status--warning':'status';$('save-password').disabled=!same;$('save-key').disabled=!same;$('choose-key').disabled=!same;$('test').disabled=!same||data.status.credential==='none';if(data.status.trusted&&!same)message('主机指纹已变化，连接已阻断。')}
$('password-mode').onclick=()=>mode('password');$('key-mode').onclick=()=>mode('key');
$('change').onclick=()=>{editing=!editing;credentialView()};
$('close').onclick=()=>api.close();document.addEventListener('keydown',event=>{if(event.key==='Escape')api.close()});
$('rescan').onclick=()=>run(inspect);
$('trust').onclick=()=>run(async()=>{if(!observed)return;await api.trust(observed);$('trust-actions').classList.add('hidden');await refresh();message('已固定主机指纹。',true)});
$('save-password').onclick=()=>run(async()=>{const value=$('password').value;await api.password(value);$('password').value='';editing=false;await refresh();message('密码已保存。',true)});
$('choose-key').onclick=()=>run(async()=>{const name=await api.chooseKey();if(name)$('key-file').textContent=name});
$('save-key').onclick=()=>run(async()=>{await api.saveKey($('passphrase').value);$('passphrase').value='';editing=false;await refresh();message('私钥已保存。',true)});
$('clear').onclick=()=>run(async()=>{await api.clear();editing=false;await refresh();message('凭证已移除。',true)});
$('test').onclick=()=>run(async()=>{const result=await api.info();if(!result.status.trusted)throw Error('请先确认主机指纹。');message('正在连接…');const home=await api.test();message('连接成功 · '+home.home,true)});
run(async()=>{await refresh();await inspect()});
new ResizeObserver(()=>{void api.resize($('sheet').getBoundingClientRect().height+44)}).observe($('sheet'));
</script></body></html>`

/** Only validated appearance enums enter the document; no server or credential data. */
export function credentialDocument(appearance: WindowAppearance, resolved: ResolvedTheme): string {
  const safe = parseWindowAppearance(appearance) ?? { mode: 'system', palette: 'default' }
  return CREDENTIAL_HTML.replace('<html lang="zh-CN">', `<html lang="zh-CN" data-theme="${resolved === 'dark' ? 'dark' : 'light'}" data-palette="${safe.palette}">`)
}
