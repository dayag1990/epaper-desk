export const APP_CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171a;--mute:#5a6470;--line:#d9dde3;--green:#1a8d4a;--amber:#c27c00;--red:#c62828;--btn:#14171a;--btnink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#101316;--card:#1a1f24;--ink:#eef1f4;--mute:#9aa5b1;--line:#2b333b;--green:#3ec97a;--amber:#f0b429;--red:#ff6b6b;--btn:#eef1f4;--btnink:#101316}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px 80px}
h1{font-size:1.25rem;margin:8px 0}h2{font-size:1.05rem;margin:24px 0 8px}
.banner{padding:14px;border-radius:12px;font-weight:700;font-size:1.1rem;color:#fff;margin:8px 0}
.banner.green{background:var(--green)}.banner.amber{background:var(--amber)}.banner.red{background:var(--red)}
.card{background:var(--card);border:1px solid var(--line);border-left:8px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}
.card.green{border-left-color:var(--green)}.card.amber{border-left-color:var(--amber)}.card.red{border-left-color:var(--red)}
.card h3{margin:0;font-size:1.05rem;display:flex;gap:8px;align-items:center}
.dot{width:14px;height:14px;border-radius:50%;display:inline-block;background:var(--line)}
.dot.green{background:var(--green)}.dot.amber{background:var(--amber)}.dot.red{background:var(--red)}
.mute{color:var(--mute);font-size:.9rem}.todo{font-weight:600;margin:6px 0}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button,a.btn,input,select{font:inherit}
button,a.btn{min-height:48px;padding:10px 16px;border-radius:10px;border:0;background:var(--btn);color:var(--btnink);font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button.sec,a.btn.sec{background:transparent;color:var(--ink);border:2px solid var(--ink)}button.danger{background:var(--red);color:#fff}
button:disabled{opacity:.5}
input,select{min-height:48px;padding:8px 10px;border-radius:10px;border:2px solid var(--line);background:var(--card);color:var(--ink);width:100%;margin:4px 0}
label{display:block;margin-top:8px;font-weight:600}
pre{background:#0b0d0f;color:#d7e0e8;padding:10px;border-radius:10px;overflow:auto;font-size:.8rem;max-height:70vh;white-space:pre-wrap;word-break:break-all}
#toast{position:fixed;left:12px;right:12px;bottom:12px;padding:14px;border-radius:12px;background:var(--card);border:3px solid var(--green);font-weight:600;display:none;z-index:9;max-height:40vh;overflow:auto}
#toast.err{border-color:var(--red)}
dialog{border:3px solid var(--red);border-radius:14px;max-width:92vw;width:420px;background:var(--card);color:var(--ink)}
table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid var(--line);text-align:left;font-size:.9rem}
.tbl{overflow-x:auto}nav{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}nav a{color:var(--ink)}
.codes{font:700 1.1rem monospace;line-height:1.9}
`;

export const APP_JS = `
(function(){
var toast=document.getElementById('toast');
function say(t,err){if(!toast)return;toast.textContent=t;toast.className=err?'err':'';toast.style.display='block';clearTimeout(say.t);say.t=setTimeout(function(){toast.style.display='none'},err?30000:9000)}
function post(url,body,btn){
  if(btn){btn.disabled=true;}
  say('Working... please wait.',false);
  return fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-ops':'1'},body:JSON.stringify(body||{})})
   .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {r:r,j:j}})})
   .then(function(x){
     if(x.r.status===401){location.href='/login';return}
     var ok=x.r.ok&&x.j.ok!==false;
     var extra='';
     if(x.j.counts&&x.j.counts.length){extra=' Row counts (live / restored): '+x.j.counts.map(function(c){return c.table+' '+c.live+' / '+c.restored}).join(', ')+'.'}
     say((x.j.message||x.j.error||(ok?'Done.':'That did not work.'))+extra,!ok);
     if(x.j.id){var f=document.getElementById('restoreId');if(f)f.value=x.j.id}
     refresh();
   }).catch(function(){say('The desk could not be reached. If this is the first time, check your phone signal and try again.',true)})
   .then(function(){if(btn)btn.disabled=false});
}
var dlg=document.getElementById('confirmDlg');
document.addEventListener('submit',function(e){if(e.target.hasAttribute('data-nosubmit'))e.preventDefault()});
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-post]');if(!b)return;
  e.preventDefault();
  var url=b.getAttribute('data-post');if(b.id==='switchBtn'){url='/ops/db/restore/'+encodeURIComponent(document.getElementById('restoreId').value||'none')+'/switch'}var word=b.getAttribute('data-confirm'),extra=b.getAttribute('data-body');
  var body=extra?JSON.parse(extra):{};
  var fromForm=b.getAttribute('data-form');
  if(fromForm){var f=document.getElementById(fromForm);new FormData(f).forEach(function(v,k){if(v!=='')body[k]=v});if(body.to&&body.to.length===16)body.to=new Date(body.to).toISOString()}
  if(word){
    document.getElementById('confirmWhat').textContent=b.getAttribute('data-what')||'This changes things.';
    document.getElementById('confirmWord').textContent=word;
    var inp=document.getElementById('confirmInput');inp.value='';
    dlg.returnValue='';dlg.showModal();
    dlg.onclose=function(){if(dlg.returnValue==='go'){body.confirm=inp.value;post(url,body,b)}};
  } else post(url,body,b);
});
function refresh(){
  var el=document.getElementById('lights');if(!el)return;
  fetch('/ui/lights',{credentials:'same-origin'}).then(function(r){if(r.status===401){location.href='/login';return}return r.text()}).then(function(h){if(h)el.innerHTML=h}).catch(function(){});
}
if(document.getElementById('lights'))setInterval(refresh,10000);
})();
`;
