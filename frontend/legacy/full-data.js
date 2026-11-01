/* Full local database adapter; the original examples remain available offline. */
(() => {
 let available=false,request=0,timer=null,pageState=null,layoutCenter={x:0,y:0};
 const baseRenderList=renderList,baseDetail=renderDetail,baseDraw=drawGraph;
 const fetchJSON=async path=>{const r=await fetch(path);const d=await r.json();if(!r.ok)throw Error(d.error||'โหลดข้อมูลไม่สำเร็จ');return d};
 const banner=document.createElement('div');banner.className='dataset-banner';banner.setAttribute('aria-live','polite');document.querySelector('.intro').after(banner);
 async function loadProject(pid,background=false){
  if(!background)toast('กำลังเปิดโครงการ '+pid);
  try{const g=await fetchJSON('/api/project?id='+encodeURIComponent(pid));g.fullData=true;const index=APP_DATA.findIndex(x=>x.id===pid);if(index>=0)g.short=APP_DATA[index].short;let ix=index;if(ix<0){APP_DATA.push(g);ix=APP_DATA.length-1}else APP_DATA[ix]=g;if(background&&(state.view!=='graph'||state.search))return;choose(ix);if(g.coverage.truncated)toast('กราฟนี้โหลดสูงสุด 2,000 สัญญาและ 2,000 ข้อเสนอ ดูขอบเขตที่รายละเอียด');}
  catch(e){toast(e.message)}
 }
 window.openDatabaseProject=loadProject;
 function resultRows(data,type){
  if(type==='agencies')return data.items.map(r=>({title:r.name,id:r.name,kind:'กลุ่มชื่อหน่วยงาน · ยังไม่มีรหัสทางการ',note:Number(r.source_rows).toLocaleString('th-TH')+' แถวสัญญา',agency:r.name}));
  if(type==='companies')return data.items.map(r=>({title:r.name,id:r.cid,kind:'นิติบุคคลในทะเบียน',note:Number(r.contract_rows).toLocaleString('th-TH')+' แถวสัญญาในชุดข้อมูล',cid:r.cid}));
  if(type==='people')return data.items.map(r=>({title:r.name,id:r.cid,kind:r.kind==='OrganizationMention'?'นิติบุคคลที่ปรากฏในทะเบียน':'บุคคลตามทะเบียน',note:'ยังต้องยืนยันบทบาท ณ วันจัดซื้อ',entity:r.entity_key}));
  if(type==='quality')return data.items.map(r=>({title:r.reason==='column_count_mismatch'?'จำนวนช่องข้อมูลไม่ตรงหัวตาราง':'รหัสโครงการไม่สมบูรณ์',id:r.member+' · ระเบียน '+r.record,kind:'แยกเก็บเพื่อทบทวน',note:r.path}));
  return data.items.map(r=>({title:r.title||'โครงการ '+r.pid,id:r.pid,kind:r.agency||'ไม่ระบุหน่วยงาน',note:'ปี '+r.year,pid:r.pid}));
 }
 async function showPage(cursor=null){
  if(!available)return baseRenderList();
  const turn=++request;const type=state.view==='graph'?'projects':state.view;const q=state.search;$('#search').placeholder=type==='people'?'ค้นหาชื่อผู้เกี่ยวข้อง':type==='companies'?'ค้นหาชื่อหรือเลขทะเบียน':'ค้นหารหัสโครงการ ชื่อโครงการ หรือบริษัท';
  const query=new URLSearchParams({q,limit:'30'});if(cursor)query.set(['companies','agencies'].includes(type)?'cursor':'after',cursor);
  const filters=window.TOR_FILTERS||{};if(type==='projects'&&filters.year)query.set('year',filters.year);if(type==='companies'&&filters.withContracts)query.set('with_contracts','1');if(type==='people'&&filters.peopleKind)query.set('kind',filters.peopleKind);if(type==='agencies'&&filters.agencyMin)query.set('min_rows',filters.agencyMin);
  $('#list-view').innerHTML='<div class="list-card"><div class="empty">กำลังค้นหาในข้อมูลทั้งหมด…</div></div>';
  try{const data=await fetchJSON('/api/'+type+'?'+query);if(turn!==request)return;pageState={type,q,cursor,next:data.next};const rows=resultRows(data,type);
   $('#list-view').innerHTML=`<div class="list-card"><div class="list-head"><h2>${escapeHtml(q?'ผลการค้นหา: '+q:titles[type])}</h2><span class="badge">ข้อมูลทั้งหมด · ${rows.length} รายการในหน้านี้</span></div><div class="table-wrap"><table><thead><tr><th>ชื่อ / รหัสอ้างอิง</th><th>ประเภท / หน่วยงาน</th><th>รายละเอียด</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${escapeHtml(r.title)}<small>${escapeHtml(r.id)}</small></td><td>${escapeHtml(r.kind)}</td><td>${escapeHtml(r.note)}</td><td>${type==='quality'?'':`<button class="open" data-result="${i}">${r.pid?'ดูกราฟ ↗':'ดูความเชื่อมโยง ↗'}</button>`}</td></tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty">ไม่พบข้อมูลที่ตรงกับคำค้นในชุดข้อมูลนี้</div>'}</div><div class="db-pagination"><span>แสดงครั้งละไม่เกิน 30 รายการ · เก็บข้อมูลซ้ำพร้อมหลักฐานต้นทาง</span><div><button class="button" id="db-first" ${cursor?'':'disabled'}>กลับหน้าแรก</button> <button class="button" id="db-next" ${data.next?'':'disabled'}>หน้าถัดไป →</button></div></div></div>`;
   $('#list-view').querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.result)];if(window.TORViews)return window.TORViews.openRow(type,r);if(r.pid)loadProject(r.pid);else if(r.cid)companyProjects(r.cid);else showEntity(r.entity,r.title)});
   $('#db-first').onclick=()=>showPage();$('#db-next').onclick=()=>showPage(data.next);window.TORViews?.onRows(type,rows,data);
  }catch(e){if(turn===request)$('#list-view').innerHTML=`<div class="list-card"><div class="empty">${escapeHtml(e.message)}<br>โปรดเปิดแอปผ่านเซิร์ฟเวอร์ข้อมูลในเครื่อง</div></div>`}
 }
 function companyProjects(cid){state.view='projects';state.search=cid;$('#search').value=cid;render()}
 async function showEntity(key,name){
  try{const d=await fetchJSON('/api/related?key='+encodeURIComponent(key));$('#list-view').innerHTML=`<div class="list-card"><div class="list-head"><h2>${escapeHtml(name)}</h2><span class="badge">นิติบุคคลที่เชื่อมผ่านตัวระบุ</span></div><div class="empty" style="text-align:left">${escapeHtml(d.identity_note)}${d.companies.map(r=>`<button class="related" data-company="${r.cid}"><span class="related-copy"><strong>${escapeHtml(r.name)}</strong><small>${r.cid}</small></span>ดูโครงการ →</button>`).join('')||'<p>ไม่พบความสัมพันธ์เพิ่มจากตัวระบุในชุดข้อมูลนี้</p>'}${d.truncated?'<p>แสดง 100 บริษัทแรก</p>':''}</div></div>`;$('#list-view').querySelectorAll('[data-company]').forEach(b=>b.onclick=()=>companyProjects(b.dataset.company));}catch(e){toast(e.message)}
 }
 renderList=function(){if(!available)return baseRenderList();++request;clearTimeout(timer);$('#list-view').innerHTML='<div class="list-card"><div class="empty">กำลังค้นหาในข้อมูลทั้งหมด…</div></div>';timer=setTimeout(()=>showPage(),180)};
 function databaseDetail(){
  const g=current(),n=g.nodes.find(x=>x.id===state.selected)||g.nodes.find(x=>x.type==='Project');
  const value=v=>v==null||v===''?'ไม่พบในข้อมูล':v;
  let body=field('ชื่อ',n.label,'strong');
  if(n.type==='Project')body+=field('รหัสโครงการ',g.id)+field('หน่วยงานในระเบียนที่เลือก',g.contract['ชื่อหน่วยงานย่อย'])+field('มูลค่าสัญญาในระเบียนที่เลือก',g.amount==null||String(g.amount).trim()===''||!Number.isFinite(Number(g.amount))?'ไม่พบจำนวนเงินที่อ่านได้':money(g.amount)+' บาท')+field('ข้อมูลสัญญา',g.contracts.length+' ระเบียนเนื้อหาไม่ซ้ำที่โหลด')+field('ผู้เสนอราคาที่พบในชุดนี้',g.bidderCount+' ชื่อ (ไม่ใช่การยืนยันความครบถ้วน)');
  if(n.company_id)body+=field('รหัสตามต้นทาง',n.company_id);
  if(n.identity_status)body+=field('สถานะการเชื่อม',({registry_id_match:'เชื่อมเลขทะเบียนตรงกับ DBD',registry_not_found:'ไม่พบทะเบียน DBD ที่ตรงกัน',unique_registry_name_unverified:'ชื่อทะเบียนตรงหนึ่งรายการ · ยังไม่ยืนยัน',same_project_winner_name:'ชื่อตรงผู้ชนะในโครงการเดียวกัน',unresolved_name:'ยังไม่พบตัวระบุสำหรับเชื่อม',unresolved_mention:'รายการไม่มีตัวระบุ · ไม่รวมด้วยชื่อเพียงอย่างเดียว',ambiguous_registry_name:'ชื่อตรงทะเบียนมากกว่าหนึ่งรายการ',identifier_matched_across_observations:'เชื่อมด้วยตัวระบุจากต้นทาง',temporary_name_key:'ใช้รหัสชั่วคราวจากชื่อหน่วยงาน'})[n.identity_status]||n.identity_status);
  if(n.investAmount!=null)body+=field('เงินลงทุนที่ต้นทางระบุ',money(n.investAmount)+' บาท');
  if(n.observed)body+=field('วันที่สังเกตทะเบียน',n.observed);
  if(n.type==='TenderItem')body+=field('ราคาเสนอที่พบ',g.bids.filter(b=>b['ลำดับรายการพิจารณา']===n.id.split(':').at(-1)).map(b=>b['ชื่อผู้เสนอราคา']+' — '+value(b['ราคาที่เสนอ (บาท)'])+' บาท').join('\n'));
  body+=field('หลักฐาน',n.dbd_source||((n.type==='TenderItem'||!n.is_winner)&&n.type==='UnresolvedBidder'?g.bidSource:g.contractSource));
  const neighbors=[...new Set(g.edges.filter(e=>e.source===n.id||e.target===n.id).map(e=>e.source===n.id?e.target:e.source))].map(id=>g.nodes.find(x=>x.id===id));
  $('#detail').innerHTML=`<div class="detail-card"><div class="detail-heading"><span class="detail-icon">${(colors[n.type]||colors.UnresolvedBidder)[2]}</span>${typeNames[n.type]||'ข้อมูลที่เชื่อมโยง'}</div>${body}</div><div class="detail-card"><div class="detail-heading">ข้อมูลที่เชื่อมโยง · ${neighbors.length}</div>${neighbors.map(x=>`<button class="related" data-db-node="${escapeHtml(x.id)}"><span class="related-copy"><strong>${escapeHtml(x.label)}</strong><small>${typeNames[x.type]}</small></span>›</button>`).join('')}</div><div class="finding"><strong>ข้อมูลที่ยังต้องตรวจ</strong>${escapeHtml(g.finding)}</div>`;
  $('#detail').querySelectorAll('[data-db-node]').forEach(b=>b.onclick=()=>{state.selected=b.dataset.dbNode;drawGraph();renderDetail()});
  if(n.is_winner&&g.signing_conditions?.length){const section=document.createElement('div');section.className='detail-card';section.innerHTML='<div class="detail-heading">เงื่อนไขลงนามตามต้นทาง</div>'+g.signing_conditions.filter(x=>x.cid===n.company_id).map(x=>`<p class="detail-source">${escapeHtml(x.description)}</p>`).join('');$('#detail').append(section)}
 }
 renderDetail=function(){
  if(current().fullData)databaseDetail();else baseDetail();if(!available)return;
  const g=current(),n=g.nodes.find(x=>x.id===state.selected);if(!n)return;
  const section=document.createElement('div');section.className='detail-card';section.innerHTML='<div class="detail-heading">สำรวจข้ามโครงการ</div>';const info=document.createElement('div');info.className='detail-source';section.append(info);$('#detail').append(section);
  if(n.type==='Organization'||(n.is_winner&&/^\d{13}$/.test(n.company_id||''))){
   const cid=n.company_id||g.companyId;info.textContent='เชื่อมด้วยเลขทะเบียนนิติบุคคล '+cid;
   const button=document.createElement('button');button.className='button';button.textContent='ดูโครงการทั้งหมดของนิติบุคคลนี้ →';button.onclick=()=>companyProjects(cid);section.append(button);
  }else if(['PersonMention','OrganizationMention'].includes(n.type)){
   info.textContent='ตรวจบริษัทอื่นที่มีตัวระบุเดียวกัน โดยไม่รวมคนจากชื่อเพียงอย่างเดียว';
   const button=document.createElement('button');button.className='button';button.textContent='ดูนิติบุคคลที่เกี่ยวข้อง →';button.onclick=()=>{state.view='people';$('#graph-view').hidden=true;$('#list-view').hidden=false;showEntity(n.entity_key||n.id,n.label)};section.append(button);
  }else info.textContent='เลือกผู้ชนะหรือผู้เกี่ยวข้องเพื่อสำรวจความสัมพันธ์ข้ามโครงการ';
  if(g.coverage){const text=document.createElement('p');text.className='detail-source';text.textContent=`พบ ${g.coverage.source_contract_rows} แถวสัญญาต้นทาง · เปิด ${g.coverage.distinct_contract_records_loaded} ระเบียนเนื้อหาไม่ซ้ำ${g.coverage.truncated?' · มีข้อมูลเกินขีดจำกัดที่แสดง':''}`;section.append(text)}
 };
 drawGraph=function(){
  const g=current();if(!g.fullData)return baseDraw();
  const shown=g.nodes.filter(n=>n.id===g.center_id||((state.people||!['PersonMention','OrganizationMention'].includes(n.type))&&(state.items||n.type!=='TenderItem')));
  const nodes=shown.slice(0,g.scope?180:90),ids=new Set(nodes.map(n=>n.id)),edges=g.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  const layer=$('#viewport');layer.replaceChildren();const mobile=innerWidth<=600,center=nodes.find(n=>n.id===g.center_id)||nodes.find(n=>n.type==='Project')||nodes[0];
  const adjacency=new Map(nodes.map(n=>[n.id,[]]));edges.forEach(e=>{adjacency.get(e.source)?.push(e.target);adjacency.get(e.target)?.push(e.source)});
  const distance=new Map(center?[[center.id,0]]:[]),queue=center?[center.id]:[];for(let i=0;i<queue.length;i++){const id=queue[i],d=distance.get(id);for(const next of adjacency.get(id)||[])if(!distance.has(next)){distance.set(next,d+1);queue.push(next)}}
  nodes.forEach(n=>{if(!distance.has(n.id))distance.set(n.id,Math.max(1,Number(n.layer)||1))});const columns=new Map();nodes.forEach(n=>{const d=Math.min(3,distance.get(n.id)||0);if(!columns.has(d))columns.set(d,[]);columns.get(d).push(n)});const typeOrder={Project:0,Agency:1,Organization:2,UnresolvedBidder:3,PersonMention:4,OrganizationMention:5,TenderItem:6};columns.forEach(list=>list.sort((a,b)=>(typeOrder[a.type]??9)-(typeOrder[b.type]??9)||a.label.localeCompare(b.label,'th')));
  const pts=new Map(),levels=[...columns.keys()].sort((a,b)=>a-b),levelNames=['จุดตั้งต้น','ความสัมพันธ์ชั้น 1','ความสัมพันธ์ชั้น 2','ความสัมพันธ์ชั้น 3'];let width,height;
  if(mobile){width=360;let cursor=70;levels.forEach(d=>{const list=columns.get(d);const heading=svgElement('text',{x:18,y:cursor,class:'layer-heading'});heading.textContent=levelNames[d]||`ความสัมพันธ์ชั้น ${d}`;layer.append(heading);cursor+=45;list.forEach(n=>{pts.set(n.id,{x:180,y:cursor});cursor+=74});cursor+=34});height=Math.max(560,cursor);}
  else{const maxCount=Math.max(...levels.map(d=>columns.get(d).length),1);width=Math.max(860,levels.length*220+20);height=Math.max(650,maxCount*74+120);levels.forEach(d=>{const x=110+d*220,list=columns.get(d),start=98;const band=svgElement('rect',{x:x-100,y:14,width:200,height:46,rx:10,class:'layer-band'});layer.append(band);const heading=svgElement('text',{x,y:42,'text-anchor':'middle',class:'layer-heading'});heading.textContent=levelNames[d]||`ความสัมพันธ์ชั้น ${d}`;layer.append(heading);list.forEach((n,i)=>pts.set(n.id,{x,y:start+i*74}))});}
  $('#graph').setAttribute('viewBox',`0 0 ${width} ${height}`);$('#graph').style.width=width+'px';$('#graph').style.height=height+'px';layoutCenter={x:width/2,y:height/2};
  edges.forEach(e=>{const a=pts.get(e.source),b=pts.get(e.target);if(!a||!b)return;const confidence=e.confidence||((e.type==='REPORTED_RELATED_PARTY'||e.link_method==='unique_registry_name_unverified')?'low':'medium'),forward=a.x<=b.x,[start,end]=forward?[a,b]:[b,a],sx=start.x+94,tx=end.x-94,mid=(sx+tx)/2;const d=Math.abs(start.x-end.x)<10?`M${start.x} ${start.y} C${start.x+36} ${start.y},${end.x+36} ${end.y},${end.x} ${end.y}`:`M${sx} ${start.y} C${mid} ${start.y},${mid} ${end.y},${tx} ${end.y}`;const path=svgElement('path',{d,class:`edge confidence-${confidence}${e.source===state.selected||e.target===state.selected?' is-active':''}`,'data-source':e.source,'data-target':e.target});const tip=svgElement('title');tip.textContent=(e.relation_label||e.type)+' · '+(e.identity_basis||'อ้างอิงข้อมูลต้นทาง');path.append(tip);layer.append(path)});
  const shorten=(text,max)=>[...String(text||'')].length>max?[...String(text)].slice(0,max-1).join('')+'…':String(text||'');
  nodes.forEach(n=>{const p=pts.get(n.id);if(!p)return;const [color,fill,icon]=colors[n.type]||colors.UnresolvedBidder,isCenter=n===center,el=svgElement('g',{class:'node node-card'+(n.id===state.selected?' selected':'')+(isCenter?' center-node':''),transform:`translate(${p.x} ${p.y})`,role:'button',tabindex:'0','aria-label':n.label,'data-node-id':n.id});el.append(svgElement('rect',{class:'node-card-bg',x:-94,y:-28,width:188,height:56,rx:10,fill:'#fff',stroke:isCenter?color:'#dce5f0','stroke-width':isCenter?2:1}));el.append(svgElement('rect',{x:-94,y:-28,width:5,height:56,rx:3,fill:color}));el.append(svgElement('circle',{cx:-69,cy:0,r:15,fill}));const glyph=svgElement('text',{x:-69,y:6,'text-anchor':'middle',fill:color,'font-size':16});glyph.textContent=icon;el.append(glyph);const title=svgElement('text',{x:-47,y:-5,class:'card-title'});title.textContent=shorten(n.label,22);el.append(title);const sub=svgElement('text',{x:-47,y:13,class:'card-sub'});sub.textContent=n.project_id||n.company_id||typeNames[n.type]||n.type;el.append(sub);const tip=svgElement('title');tip.textContent=n.label;el.append(tip);const select=()=>window.TORViews?.selectNode?window.TORViews.selectNode(n.id):(state.selected=n.id,renderDetail());el.onclick=select;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}};layer.append(el)});
  $('#graph-count').textContent=`${nodes.length} จุด · ${edges.length} เส้น · ${g.coverage?.depth||1} ชั้น`;$('#project-code').textContent=g.short||g.id;$('#zoom-value').textContent=Math.round(state.zoom*100)+'%';transform();
 };
 const oldTransform=transform;transform=function(){if(!current().fullData)return oldTransform();$('#viewport').setAttribute('transform',`translate(${layoutCenter.x+state.pan.x} ${layoutCenter.y+state.pan.y}) scale(${state.zoom}) translate(${-layoutCenter.x} ${-layoutCenter.y})`);$('#zoom-value').textContent=Math.round(state.zoom*100)+'%'};
 async function init(){
  if(location.protocol==='file:'){banner.textContent='โหมดตัวอย่าง 5 โครงการ · เปิดผ่าน Start Web App.cmd เพื่อสำรวจฐานข้อมูลทั้งหมด';return}
  try{const s=await fetchJSON('/api/stats');available=Boolean(s.complete);
   if(s.complete){const t=s.summary;banner.innerHTML=`<div class="dataset-banner__lead"><span class="status-dot"></span><strong>ข้อมูลทั้งหมดเชื่อมโยงแล้ว</strong></div><span class="dataset-metric"><b>${Number(t.projects).toLocaleString('th-TH')}</b><small>โครงการ</small></span><span class="dataset-metric"><b>${Number(t.companies).toLocaleString('th-TH')}</b><small>นิติบุคคลในทะเบียน</small></span><span class="dataset-metric"><b>${Number(t.bids).toLocaleString('th-TH')}</b><small>แถวข้อเสนอ</small></span><span class="dataset-metric"><b>${Number(t.rejected).toLocaleString('th-TH')}</b><small>แถวรอทบทวน</small></span>`;}
   else{banner.textContent='กำลังประมวลผลข้อมูลทั้งหมด · ขั้นตอน '+({parallel_csv_import:'อ่านข้อมูลจากทุกปี',registry_inventory:'ตรวจชุดทะเบียน',registry_import:'นำเข้าทะเบียน',indexing:'สร้างดัชนีค้นหา',project_catalog:'จัดกลุ่มโครงการ',linking_bidders:'เชื่อมผู้เสนอราคา',summarizing:'ตรวจยอดข้อมูล'}[s.progress.stage]||'จัดเก็บและเชื่อมโยงข้อมูล');setTimeout(init,10000)}
   titles.companies='นิติบุคคลในทะเบียน';document.querySelector('[data-view=companies]').lastChild.textContent='นิติบุคคลในทะเบียน';$('.workspace').innerHTML='ฐานข้อมูลทั้งหมด <span>LOCAL</span>';$('.sidebar-bottom').innerHTML='<span class="status-dot"></span> ข้อมูลจัดซื้อจัดจ้างปี 2565–2569<p>ค้นหาและเชื่อมข้ามโครงการในเครื่อง</p>';$('.project-picker h2').textContent='เริ่มจากตัวอย่าง หรือค้นหาข้อมูลทั้งหมด';$('footer span').textContent='สำรวจฐานข้อมูลทั้งหมดในเครื่อง';render();if(s.complete&&state.view==='graph'&&!state.search&&!current().fullData)loadProject(current().id,true);
  }catch(e){banner.textContent='โหมดตัวอย่าง 5 โครงการ · เซิร์ฟเวอร์ข้อมูลยังไม่พร้อม เปิดผ่าน Start Web App.cmd'}
 }
 init();
})();
