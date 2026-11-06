import './style.css';
import { MAX_FILE_SIZE, MAX_TOTAL_SIZE, TOOL_VERSION, RULE_VERSION, type Summary, type Category, type Change, type Issue } from './engine';

const icons: Record<string,string> = {
 book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>',
 file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 down:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 tune:'<path d="M4 7h16M4 17h16M9 3v8m6 2v8"/>',
 code:'<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1"/>',
 box:'<path d="m3 7 9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10M7 5l10 4"/>'
};
const icon=(name:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.file}</svg>`;
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const formatSize=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${Math.ceil(n/1024)} KiB`;
const names:Record<Category,string>={valid:'有效书源',pending:'待处理','non-source':'非书源',placeholder:'空占位'};
type Task={id:number;file:File;status:'queued'|'running'|'done'|'cancelled'|'error';progress:number;worker?:Worker;summary?:Summary;error?:string;confirmed:boolean;batchSize:string;deviceVersion:string;deviceResult:string};
let tasks:Task[]=[], currentId:number|null=null, nextId=1, running=false, filter='all', search='', page=0, requestId=0, generation=0;
let downloadUrl:string|undefined;
function releaseDownload(){if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=undefined;}}
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;taskId:number}>();
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
<aside class="sidebar"><a class="brand" href="#" aria-label="源序首页"><span class="brand-icon">${icon('book')}</span><span>源序<span class="brand-en">SOURCE STUDIO</span></span></a>
<div class="nav-label">工作空间</div><a class="nav-item active" href="#workspace">${icon('grid')}书源修正<span class="nav-dot"></span></a>
<button class="nav-item" id="help-button">${icon('help')}使用说明</button>
<div class="sidebar-bottom"><div class="local-icon">${icon('shield')}</div><strong>文件只留在你的设备</strong><p>所有诊断与修正均在浏览器内完成，无上传，无历史记录。</p><span class="version">v${TOOL_VERSION} <span>· 浏览器本地处理</span></span></div></aside>
<div class="shell"><header class="topbar"><div class="breadcrumb">工作空间<span>/</span><b>书源修正</b></div><span class="privacy-pill"><i></i>本地处理模式</span></header>
<main id="workspace"><section class="page-heading"><div><div class="eyebrow">LEGADO · HARMONYOS</div><h1>让书源，重新有序。</h1><p>识别、诊断并修正 JSON 书源，让每一次导入更从容。</p></div><span class="heading-tag">${icon('shield')}文件不上传服务器</span></section>
<section class="upload-card" id="dropzone"><div class="upload-icon">${icon('upload')}</div><h2>把书源文件放在这里</h2><p>拖入 JSON 文件，或从设备中选择。支持多个文件独立诊断。</p><button class="primary" id="choose">${icon('file')}选择 JSON 文件</button><input id="file-input" type="file" accept=".json,.jsonc,application/json" multiple hidden><div class="upload-meta">UTF-8 / UTF-16 <span>·</span> 单文件 ≤ 50 MiB <span>·</span> 合计 ≤ 100 MiB</div></section>
<div class="feature-strip"><span>${icon('check')}保留非空解析规则</span><span>${icon('code')}识别非书源 JSON</span><span>${icon('box')}支持完整与分批导出</span></div>
<section class="workbench" aria-label="文件诊断工作区"><div class="file-panel"><div class="panel-heading"><h2>文件队列 <span id="file-count">0</span></h2><button class="text-button" id="clear">清空</button></div><div id="file-list"></div><div class="queue-note">${icon('info')}依次处理，互不覆盖原文件。</div></div>
<div class="result-panel"><div id="result"></div></div></section>
<footer><span>源序 · 书源修正工具</span><span>兼容配置 ${RULE_VERSION} <span class="footer-dot">/</span> 格式通过 ≠ 设备实测通过</span></footer></main></div>
<div id="toast" role="status" aria-live="polite"></div>
<dialog id="detail-dialog"><div id="detail-content"></div></dialog>
<dialog id="help-dialog"><div class="dialog-heading"><h2>使用说明</h2><button class="icon-button" data-close="help-dialog" aria-label="关闭">${icon('close')}</button></div><div class="help-body"><ol><li>选择 JSON 文件，等待本地诊断。</li><li>查看书源分类、问题及改动明细。</li><li>混合内容需要勾选“仅提取有效书源”后才能导出修正版。</li><li>下载完整 JSON，或下载结果 ZIP 获取分批文件与报告。</li></ol><p>只清理已验证的空扩展字段，未知字段保留并提示。注释与末尾逗号可修复；截断、引号损坏和重复键需要手动处理。</p><p>文件不会上传，也不会执行书源中的 JavaScript。不支持任意嵌套 JSON、旧版或其他阅读器格式转换。</p><p>格式校验不代表书源网站仍能访问或能在所有应用版本中运行。设备测试结果由你实际导入后填写，仅记录在下载报告内。</p><p>部署说明请查看随程序交付的 README。</p></div></dialog>`;
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const current=()=>tasks.find(t=>t.id===currentId);
function toast(message:string){$('#toast').textContent=message;$('#toast').classList.add('visible');window.setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function renderFiles(){
  $('#file-count').textContent=String(tasks.length);
  $('#file-list').innerHTML=tasks.length?tasks.map(t=>`<div class="file-row ${t.id===currentId?'selected':''}"><button class="file-select" data-select="${t.id}" title="${escape(t.file.name)}"><span class="file-symbol">${icon('file')}</span><span><strong>${escape(t.file.name)}</strong><small>${formatSize(t.file.size)} <span>·</span> ${t.status==='done'?(t.summary?.fatal?'无法解析':'诊断完成'):t.status==='running'?'正在诊断…':t.status==='queued'?'等待处理':t.status==='cancelled'?'已取消':'处理失败'}</small></span></button>${['running','queued'].includes(t.status)?`<button class="icon-button" data-cancel="${t.id}" aria-label="取消 ${escape(t.file.name)}">${icon('close')}</button>`:`<span class="status-dot ${t.status==='done'&&!t.summary?.fatal?'green':'gray'}"></span>`}</div>`).join(''):'<div class="file-empty">还没有文件<br><span>选择文件后会显示在这里</span></div>';
}
function issueHtml(i:Issue){return `<div class="issue ${i.severity}"><b>${escape(i.path||i.code)}${i.line?` · 第 ${i.line} 行，第 ${i.column} 列`:''}</b><p>${escape(i.message)}</p></div>`;}
function renderResult(){
  const t=current();
  if(!t){$('#result').innerHTML=`<div class="result-empty"><div class="empty-art">${icon('tune')}<span>${icon('check')}</span></div><h2>每一个改动，都有依据</h2><p>添加文件后，在这里查看诊断结果、<br>修正详情和可下载的书源。</p><div class="empty-steps"><span>01 识别内容</span><i></i><span>02 查看诊断</span><i></i><span>03 导出书源</span></div></div>`;return;}
  if(!t.summary){$('#result').innerHTML=`<div class="result-empty"><div class="${t.status==='running'?'spinner':'empty-art'}">${t.status==='running'?'':icon('file')}</div><h2>${t.status==='running'?'正在诊断文件':t.status==='queued'?'等待前一个文件完成':t.status==='cancelled'?'处理已取消':'处理失败'}</h2><p>${escape(t.error||t.file.name)}</p>${t.status==='running'?`<progress max="100" value="${t.progress}"></progress><button class="secondary" data-cancel="${t.id}">取消处理</button>`:''}</div>`;return;}
  const s=t.summary, excluded=s.counts.pending+s.counts['non-source']+s.counts.placeholder;
  const mixed=!!(s.counts.valid&&excluded);
  $('#result').innerHTML=`<div class="result-heading"><div><span class="eyebrow">诊断结果</span><h2>${escape(t.file.name)}</h2></div><span class="badge ${s.fatal?'pending':s.counts.valid?'valid':'neutral'}">${s.fatal?'解析失败':s.counts.valid?'格式校验通过':'未识别到有效书源'}</span></div>
  <div class="stats"><div><span>有效书源</span><strong>${s.counts.valid.toLocaleString()}</strong><small>可导出记录</small></div><div><span>修正项</span><strong>${s.changeCount.toLocaleString()}</strong><small>含文件格式修复</small></div><div><span>待处理 / 排除</span><strong>${excluded.toLocaleString()}</strong><small>保留原始记录</small></div><div><span>问题提示</span><strong>${s.issueCount.toLocaleString()}</strong><small>查看明细了解原因</small></div></div>
  ${s.issues.map(issueHtml).join('')}${s.changes.length?`<details class="file-changes"><summary>文件级修正 · ${s.changes.length} 项</summary>${changeHtml(s.changes)}</details>`:''}
  ${!s.fatal&&!s.counts.valid?'<div class="notice">这份 JSON 中没有可直接导出的有效书源。可查看分类原因、下载报告及原始排除项。</div>':''}
  <div class="filters"><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索书源名称或标识" value="${escape(search)}" aria-label="搜索书源名称或标识"></label><select id="category" aria-label="记录分类"><option value="all">全部记录</option>${Object.entries(names).map(([v,n])=>`<option value="${v}" ${filter===v?'selected':''}>${n}</option>`).join('')}<option value="changed" ${filter==='changed'?'selected':''}>有修正</option></select><select id="issue-filter" aria-label="问题类型"><option value="">全部问题类型</option>${[...new Set(s.entries.flatMap(e=>e.issues.map(i=>i.code)))].map(c=>`<option value="${escape(c)}">${escape(issueNames[c]||c)}</option>`).join('')}</select></div>
  <div id="records"></div>
  <div class="export-area"><div class="export-settings"><label>每批数量<input id="batch-size" type="number" min="1" max="10000" step="1" value="${escape(t.batchSize)}"></label><span>分批文件包含在结果 ZIP 中</span></div>
  ${mixed?`<label class="confirm"><input id="confirm" type="checkbox" ${t.confirmed?'checked':''}>我已查看分类，仅提取 ${s.counts.valid} 条有效书源；${excluded} 条其他记录保留在排除项中。</label>`:''}
  <div class="export-buttons"><button class="primary" data-export="full" ${s.fatal||!s.counts.valid||mixed&&!t.confirmed?'disabled':''}>${icon('down')}下载修正版</button><button class="secondary" data-export="zip" ${mixed&&!t.confirmed?'disabled':''}>${icon('box')}下载结果 ZIP</button><button class="text-button" data-export="report">诊断报告</button><button class="text-button" data-export="excluded" ${excluded?'':'disabled'}>排除项</button></div><div id="download-ready"></div>
  <details class="device-test"><summary>记录鸿蒙设备实测结果（可选）</summary><div><label>阅读版本<input id="device-version" value="${escape(t.deviceVersion)}" placeholder="例如 1.0.6.xxx"></label><label>实测结果<select id="device-result">${['未实测','导入成功（用户记录）','导入失败（用户记录）'].map(value=>`<option ${t.deviceResult===value?'selected':''}>${value}</option>`).join('')}</select></label></div></details>
  <p class="export-note">${icon('info')}当前仅完成本地格式校验，未在鸿蒙设备实测。不验证网站可访问性或规则运行结果。</p></div>`;
  renderRows();
}
const issueNames:Record<string,string>={'field-type':'字段类型或取值','required-field':'必填字段缺失','not-booksource':'非书源内容','unknown-field':'未知字段','extension-content':'扩展字段待确认','duplicate-source':'书源标识重复','empty-placeholder':'空占位记录'};
function renderRows(){
  const s=current()?.summary;if(!s||!document.querySelector('#records'))return;
  const problem=$<HTMLSelectElement>('#issue-filter').value;
  const entries=s.entries.filter(e=>(filter==='all'||filter==='changed'&&e.changeCount>0||e.category===filter)&&(!problem||e.issues.some(i=>i.code===problem))&&(`${e.name} ${e.url}`).toLowerCase().includes(search.toLowerCase()));
  const maxPage=Math.max(0,Math.ceil(entries.length/50)-1);page=Math.min(page,maxPage);
  $('#records').innerHTML=`<div class="table-scroll"><table><thead><tr><th>书源 / 标识</th><th>分类</th><th>诊断</th><th></th></tr></thead><tbody>${entries.slice(page*50,page*50+50).map(e=>`<tr><td><div class="source-name"><span class="source-index">${e.index}</span><div><strong>${escape(e.name||'未命名记录')}</strong><small title="${escape(e.url)}">${escape(e.url||'无书源标识')}</small></div></div></td><td><span class="badge ${e.category==='valid'?'valid':e.category==='pending'?'pending':'neutral'}">${names[e.category]}</span></td><td><span class="diagnosis">${e.changeCount?`${e.changeCount} 项修正`:e.issues.length?`${e.issues.length} 项提示`:'无需修正'}</span></td><td><button class="text-button detail-link" data-detail="${e.index}">详情 ${icon('arrow')}</button></td></tr>`).join('')||'<tr><td colspan="4" class="no-records">没有符合条件的记录</td></tr>'}</tbody></table></div><div class="pagination"><span>共 ${entries.length.toLocaleString()} 条 · 每页 50 条</span><div><button class="text-button" id="prev" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${maxPage+1}</span><button class="text-button" id="next" ${page===maxPage?'disabled':''}>下一页</button></div></div>`;
}
function changeHtml(changes:Change[]){return changes.map(c=>`<div class="change"><div><code>${escape(c.path)}</code><span>${escape(c.reason)}</span></div><div class="change-values"><pre>${escape(c.before)}</pre><span>→</span><pre>${escape(c.after)}</pre></div></div>`).join('');}
function render(){renderFiles();renderResult();}
function rejectRequests(taskId:number){for(const [id,p] of pending)if(p.taskId===taskId){p.reject(new Error('操作已取消'));pending.delete(id);}}
function cancel(id:number){const t=tasks.find(x=>x.id===id);if(!t||!['queued','running'].includes(t.status))return;t.status='cancelled';t.worker?.terminate();rejectRequests(id);render();}
async function addFiles(files:File[]){
  if(tasks.reduce((n,t)=>n+t.file.size,0)+files.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_SIZE){toast('文件合计超过 100 MiB；请减少文件或先清空队列。');return;}
  for(const file of files){if(file.size>MAX_FILE_SIZE){toast(`${file.name} 超过单文件 50 MiB 上限，未加入队列。`);continue;}tasks.push({id:nextId++,file,status:'queued',progress:0,confirmed:false,batchSize:'500',deviceVersion:'',deviceResult:'未实测'});}
  if(currentId===null&&tasks.length)currentId=tasks[0].id;
  render();void processQueue();
}
async function processQueue(){
  if(running)return;running=true;const myGeneration=generation;
  try {
    for(const task of tasks){
      if(myGeneration!==generation)break;
      if(task.status!=='queued')continue;
      task.status='running';task.progress=5;render();
      try {
        const bytes=await task.file.arrayBuffer();
        if((task.status as string)==='cancelled'||myGeneration!==generation)continue;
        const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});task.worker=worker;
        await new Promise<void>(resolve=>{
          const originalTerminate=worker.terminate.bind(worker);
          worker.terminate=()=>{originalTerminate();resolve();};
          worker.onmessage=event=>{
            const data=event.data;
            if(data.type==='progress'){task.progress=data.value;if(currentId===task.id)renderResult();}
            if(data.type==='done'){task.summary=data.summary;task.status='done';task.progress=100;render();resolve();}
            if(data.type==='failed'){task.status='error';task.error=data.error;render();resolve();}
            if(data.type==='response'){const p=pending.get(data.requestId);if(p){pending.delete(data.requestId);if(data.error)p.reject(Error(data.error));else p.resolve(data.value);}}
          };
          worker.onerror=event=>{task.status='error';task.error=event.message||'浏览器无法启动处理线程';rejectRequests(task.id);render();resolve();};
          worker.postMessage({type:'analyze',bytes,filename:task.file.name},[bytes]);
        });
      } catch(error){task.status='error';task.error=String(error);render();}
    }
  } finally {if(myGeneration===generation){running=false;if(tasks.some(t=>t.status==='queued'))void processQueue();}}
}
function rpc(task:Task,payload:object):Promise<any>{return new Promise((resolve,reject)=>{if(!task.worker)return reject(Error('处理线程不可用'));const id=++requestId;pending.set(id,{resolve,reject,taskId:task.id});task.worker.postMessage({...payload,requestId:id});});}
function download(name:string,bytes:ArrayBuffer){releaseDownload();downloadUrl=URL.createObjectURL(new Blob([bytes],{type:name.endsWith('.zip')?'application/zip':'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=downloadUrl;a.download=name;a.className='download-ready';a.textContent=`${name} 已生成；如果下载未开始，点击这里保存。`;$('#download-ready').replaceChildren(a);a.click();toast(`已生成 ${name}，请查看浏览器下载列表。`);}
app.addEventListener('click',async event=>{
  const button=(event.target as HTMLElement).closest<HTMLElement>('button,[data-select]');if(!button)return;
  try{
    if(button.id==='choose')$<HTMLInputElement>('#file-input').click();
    if(button.id==='help-button')$<HTMLDialogElement>('#help-dialog').showModal();
    if(button.dataset.close)$<HTMLDialogElement>(`#${button.dataset.close}`).close();
    if(button.id==='clear'){releaseDownload();generation++;tasks.forEach(t=>{t.worker?.terminate();rejectRequests(t.id);});tasks=[];currentId=null;running=false;page=0;search='';filter='all';$<HTMLInputElement>('#file-input').value='';$<HTMLDialogElement>('#detail-dialog').close();$('#detail-content').replaceChildren();render();}
    if(button.dataset.select){releaseDownload();currentId=Number(button.dataset.select);page=0;search='';filter='all';render();}
    if(button.dataset.cancel)cancel(Number(button.dataset.cancel));
    if(button.id==='prev'){page--;renderRows();}if(button.id==='next'){page++;renderRows();}
    if(button.dataset.detail){
      const task=current();if(!task)return;
      const d=await rpc(task,{type:'detail',index:Number(button.dataset.detail)});
      if(currentId!==task.id||!tasks.includes(task))return;
      $('#detail-content').innerHTML=`<div class="dialog-heading"><div><span class="eyebrow">第 ${d.index} 条 · ${names[d.category as Category]}</span><h2>${escape(d.name||'未命名记录')}</h2></div><button class="icon-button" data-close="detail-dialog" aria-label="关闭">${icon('close')}</button></div><div class="detail-body">${d.issues.map(issueHtml).join('')}<h3>改动明细 <span>${d.changes.length} 项${d.category!=='valid'?' · 待处理记录不应用这些改动':''}</span></h3>${d.changes.length?changeHtml(d.changes):'<p class="muted">没有字段改动。</p>'}<details><summary>查看原始记录</summary><pre class="record-code">${escape(d.original)}</pre></details>${d.fixed?`<details><summary>查看修正后记录</summary><pre class="record-code">${escape(d.fixed)}</pre></details>`:''}</div>`;
      $<HTMLDialogElement>('#detail-dialog').showModal();
    }
    if(button.dataset.export){
      const task=current();if(!task)return;
      const batchSize=Number($<HTMLInputElement>('#batch-size').value);
      if(!Number.isInteger(batchSize)||batchSize<1||batchSize>10000){toast('每批数量应为 1–10000 的整数');return;}
      const device={version:document.querySelector<HTMLInputElement>('#device-version')?.value||'',result:document.querySelector<HTMLSelectElement>('#device-result')?.value||'未实测'};
      const disabled=button.hasAttribute('disabled');button.setAttribute('disabled','');toast('正在浏览器内生成下载文件…');
      try{const result=await rpc(task,{type:'export',kind:button.dataset.export,batchSize,confirmed:task.confirmed,device});if(tasks.includes(task))download(result.filename,result.bytes);}finally{if(!disabled)button.removeAttribute('disabled');}
    }
  }catch(error){toast(error instanceof Error?error.message:String(error));}
});
document.addEventListener('change',event=>{
  const el=event.target as HTMLInputElement;
  if(el.id==='file-input'){void addFiles([...el.files||[]]);el.value='';}
  if(el.id==='category'){filter=el.value;page=0;renderRows();}
  if(el.id==='issue-filter'){page=0;renderRows();}
  if(el.id==='device-result'){const t=current();if(t)t.deviceResult=el.value;}
  if(el.id==='confirm'){
    const t=current();if(t){t.confirmed=el.checked;document.querySelectorAll<HTMLButtonElement>('[data-export="full"],[data-export="zip"]').forEach(b=>b.disabled=!el.checked);}
  }
});
document.addEventListener('input',event=>{const el=event.target as HTMLInputElement;if(el.id==='search'){search=el.value;page=0;renderRows();}const t=current();if(t&&el.id==='batch-size')t.batchSize=el.value;if(t&&el.id==='device-version')t.deviceVersion=el.value;});
let dragDepth=0;
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('#dropzone').classList.remove('dragover');if(event.dataTransfer?.files.length)void addFiles([...event.dataTransfer.files]);});
$('#dropzone').addEventListener('dragenter',()=>{dragDepth++;$('#dropzone').classList.add('dragover');});
$('#dropzone').addEventListener('dragleave',()=>{if(--dragDepth<=0)$('#dropzone').classList.remove('dragover');});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
render();
