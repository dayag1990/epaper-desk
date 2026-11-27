export const APP_CSS = `
/* The ops desk: the shared theme (/assets/theme.css) plus the desk's own layout. Colours only through the theme tokens. */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 var(--font)}
main{max-width:720px;margin:0 auto;padding:8px 16px 80px}
h1{font:700 1.5rem/1.2 var(--font-head);margin:14px 0 8px}h2{font:700 1.1rem/1.3 var(--font-head);margin:26px 0 8px;padding-top:10px;border-top:3px solid var(--press)}
.ep-tabs{margin:6px 0 4px}
.banner{padding:14px;border:3px solid var(--press);border-radius:var(--radius);font-weight:700;font-size:1.1rem;margin:12px 0;background:var(--paper)}
.banner.green{background:var(--ok);color:var(--paper);border-color:var(--ok)}
.banner.amber{border-color:var(--brass);box-shadow:inset 8px 0 0 var(--brass)}
.banner.red{background:var(--proof);color:var(--press)}
.card{background:var(--paper);border:1px solid var(--line);border-left:8px solid var(--line);border-radius:var(--radius);padding:12px;margin:10px 0}
.card.green{border-left-color:var(--ok)}.card.amber{border-left-color:var(--brass)}.card.red{border-left-color:var(--proof);border-color:var(--press);border-left-width:8px}
.card h3{margin:0;font-size:1.05rem;display:flex;gap:8px;align-items:center}
.dot{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:.75rem;line-height:1;background:var(--line);color:var(--press)}
.dot.green{background:var(--ok);color:var(--paper)}.dot.amber{background:var(--brass);color:var(--press)}.dot.red{background:var(--proof);color:var(--press)}
.mute{color:var(--text-2);font-size:.9rem}.todo{font-weight:600;margin:6px 0}.bad{color:var(--press);background:var(--proof);padding:0 .4em;border-radius:3px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.row.center{align-items:center;justify-content:space-between}
button,a.btn,input,select{font:inherit}
button,a.btn{min-height:48px;padding:10px 16px;border-radius:var(--radius);border:2px solid var(--press);background:var(--press);color:var(--cream);font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;transition:background var(--motion),transform var(--motion)}
button:hover,a.btn:hover{background:var(--grey)}button:active,a.btn:active{transform:translateY(1px)}
button.sec,a.btn.sec{background:transparent;color:var(--press)}button.sec:hover,a.btn.sec:hover{background:var(--cream-2)}
button.fix,a.btn.fix{background:var(--proof);color:var(--press)}button.fix:hover,a.btn.fix:hover{background:var(--proof-hover)}
button.danger{background:var(--paper);color:var(--press);box-shadow:inset 0 -5px 0 var(--proof)}button.danger:hover{background:var(--cream-2)}
button:disabled{opacity:.5}
.ep-top a.ep-btn,.ep-top button.ep-btn{border-color:transparent;background:transparent;color:var(--press);min-height:44px;padding:0 .6rem}
.ep-top a.ep-btn:hover,.ep-top button.ep-btn:hover{background:var(--cream-2)}
.ep-menu a.ep-btn{border:2px solid var(--press);background:var(--paper)}
input,select{min-height:48px;padding:8px 10px;border-radius:var(--radius);border:2px solid var(--press);background:var(--paper);color:var(--text);width:100%;margin:4px 0}
label{display:block;margin-top:8px;font-weight:600}
pre{background:var(--press);color:var(--cream);padding:10px;border-radius:var(--radius);overflow:auto;font-size:.8rem;max-height:70vh;white-space:pre-wrap;word-break:break-all}
#toast{position:fixed;left:12px;right:12px;bottom:12px;padding:14px;border-radius:var(--radius);background:var(--paper);border:3px solid var(--press);border-left-width:10px;font-weight:600;display:none;z-index:50;max-height:40vh;overflow:auto;animation:ep-slide var(--motion) both}
#toast.err{border-color:var(--press);border-left-color:var(--proof)}
dialog{border:3px solid var(--press);border-radius:var(--radius);max-width:92vw;width:420px;background:var(--paper);color:var(--text)}
dialog::backdrop{background:rgba(17,17,17,.6)}
table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid var(--line);text-align:left;font-size:.9rem;vertical-align:top}th{border-bottom:2px solid var(--press)}
.tbl{overflow-x:auto}
.codes{font:700 1.1rem ui-monospace,monospace;line-height:1.9;word-break:break-all}
@media (prefers-reduced-motion:reduce){button,a.btn{transition:none}#toast{animation:none}}
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
// signed out here: also tell the API (best effort, never waited for; the desk does not depend on it)
var so=document.body.getAttribute('data-signout');
if(so){try{fetch(so,{method:'POST',mode:'no-cors',credentials:'include',keepalive:true}).catch(function(){})}catch(e){}}
})();
`;

/** Starts the bell and the toasts on every signed-in desk page. The code itself comes from the theme package (served at /assets/theme/). */
export const BOOT_JS = `import { mountAlerts } from "/assets/theme/vanilla.js";
mountAlerts({ base: location.origin, opsHref: "/" });
`;
