/* List/graph controls plus bounded multi-hop exploration for every category. */
(() => {
 const originalRender=render,originalDetail=renderDetail;
 const labels={projects:'โครงการ',companies:'บริษัท / นิติบุคคล',people:'บุคคล / ผู้เกี่ยวข้อง',agencies:'หน่วยงาน'};
 const kindFor={projects:'project',companies:'company',people:'person',agencies:'agency'};
 const categoryFor={project:'projects',company:'companies',person:'people',agency:'agencies'};
 const modes={projects:'graph',companies:'list',people:'list',agencies:'list'};
 const depths={projects:1,companies:1,people:1,agencies:1};
 const pages={},picked={},pickedQuery={},branches={};let graphRequest=0;
 const category=()=>state.view==='graph'?'projects':state.view;
 const rowKey=r=>r.pid||r.cid||r.entity||r.agency;
 const keyOf=(kind,key)=>kind+'|'+key;
 const api=async path=>{const r=await fetch(path);const d=await r.json();if(!r.ok)throw Error(d.error||'โหลดข้อมูลไม่สำเร็จ');return d};
 const relationNames={PROCURES:'หน่วยงานเจ้าของโครงการ',AWARDED_TO:'ได้รับสัญญา',REPORTED_RELATED_PARTY:'ปรากฏในทะเบียน',IDENTIFIED_AS:'ตัวระบุชี้ไปยังนิติบุคคล',BID_ON:'เสนอราคา',HAS_ITEM:'รายการพิจารณา'};
 const confidenceNames={high:'หลักฐานตรง',medium:'ควรตรวจเพิ่ม',low:'ยังไม่ยืนยัน'};
 const omittedNames={node_cap:'จุดเกินขีดจำกัด',contract_records:'ระเบียนสัญญา',bid_records:'ระเบียนผู้เสนอราคา',registry_roles:'ผู้เกี่ยวข้องในทะเบียน',awarded_projects:'โครงการที่ได้รับสัญญา',bid_projects:'โครงการที่เสนอราคา',related_companies:'บริษัทที่เกี่ยวข้อง',agency_projects:'โครงการของหน่วยงาน'};

 titles.agencies='หน่วยงาน';
 const agencyNav=document.createElement('button');agencyNav.className='nav';agencyNav.dataset.view='agencies';agencyNav.innerHTML='<span>▥</span>หน่วยงาน';document.querySelector('[data-view=quality]').before(agencyNav);
 agencyNav.onclick=()=>openCategory('agencies');

 const toolbar=document.createElement('section');toolbar.className='view-toolbar';toolbar.hidden=true;toolbar.setAttribute('aria-label','ตัวเลือกมุมมอง');toolbar.innerHTML=`
  <div class="view-heading"><span class="control-kicker">มุมมองข้อมูล</span><strong id="view-category"></strong><span id="view-context"></span></div>
  <div class="control-stack">
   <div class="mode-switch" role="group" aria-label="รูปแบบการแสดงผล">
    <button type="button" data-mode="list" aria-pressed="false"><span class="control-icon list-icon" aria-hidden="true"></span><span><b>รายการ</b><small>อ่านทีละรายการ</small></span></button>
    <button type="button" data-mode="graph" aria-pressed="true"><span class="control-icon graph-icon" aria-hidden="true"></span><span><b>กราฟความสัมพันธ์</b><small>เชื่อมโยงหลายมิติ</small></span></button>
   </div>
   <div class="depth-switch" role="group" aria-label="ระดับความลึกของกราฟ">
    <span class="depth-title">ระดับความลึก</span>
    <button type="button" data-depth="1" aria-pressed="true"><b>1</b><span>ภาพรวม</span></button>
    <button type="button" data-depth="2" aria-pressed="false"><b>2</b><span>เชิงลึก</span></button>
    <button type="button" data-depth="3" aria-pressed="false"><b>3</b><span>ละเอียดสุด</span></button>
   </div>
  </div>`;
 $('#graph-view').before(toolbar);

 const picker=document.createElement('div');picker.className='entity-picker';picker.hidden=true;picker.innerHTML=`
  <div class="picker-copy"><span class="control-kicker">จุดศูนย์กลาง</span><label for="entity-select">เลือกข้อมูลที่ต้องการไล่ความสัมพันธ์</label></div>
  <select id="entity-select" aria-label="เลือกจุดศูนย์กลาง"></select>
  <button class="branch-button" id="more-entity" hidden><span>＋</span><b>แสดงกิ่งเพิ่ม</b><small>ต่อหนึ่งจุด</small></button>`;
 $('#graph-view').prepend(picker);

 function openCategory(cat){
  ++graphRequest;state.view=cat;state.search='';$('#search').value='';render();
 }
 function activeKey(cat){
  if(picked[cat])return picked[cat];
  const g=current();
  if(cat==='projects')return g.scope==='project'?g.id.replace(/^project:/,''):(g.id||'').replace(/^project:/,'');
  return '';
 }
 function drawToolbar(){
  const cat=category();toolbar.hidden=!labels[cat];if(toolbar.hidden)return;
  $('#view-category').textContent=labels[cat];
  $('#view-context').textContent=modes[cat]==='graph'?'เลือกระดับเพื่อขยายความสัมพันธ์รอบจุดศูนย์กลาง':'ค้นหา เปรียบเทียบ และเลือกจุดที่จะสำรวจ';
  toolbar.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(modes[cat]===b.dataset.mode)));
  $('.depth-switch').hidden=modes[cat]!=='graph';
  toolbar.querySelectorAll('[data-depth]').forEach(b=>b.setAttribute('aria-pressed',String(depths[cat]===Number(b.dataset.depth))));
 }
 toolbar.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
  const cat=category();modes[cat]=button.dataset.mode;
  if(modes[cat]==='list'){
   ++graphRequest;state.view=cat;state.search=pickedQuery[cat]||'';$('#search').value=state.search;render();
  }else{
   const key=activeKey(cat)||rowKey(pages[cat]?.rows?.[0]||{});
   if(key)openEntity(kindFor[cat],key);
   else{state.view=cat;render()}
  }
 });
 toolbar.querySelectorAll('[data-depth]').forEach(button=>button.onclick=()=>{
  const cat=category(),next=Number(button.dataset.depth);if(depths[cat]===next)return;
  depths[cat]=next;drawToolbar();const key=activeKey(cat);if(key)openEntity(kindFor[cat],key);
 });

 function patchProjectTabs(){
  const entries=APP_DATA.map((g,i)=>({g,i})).filter(x=>!x.g.scope||x.g.scope==='project').slice(-8);
  $('#project-tabs').innerHTML=entries.map(x=>`<button class="project-tab ${state.index===x.i?'active':''}" aria-pressed="${state.index===x.i}" data-project-key="${escapeHtml((x.g.id||'').replace(/^project:/,''))}">${escapeHtml(x.g.short)}</button>`).join('');
  $('#project-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{modes.projects='graph';openEntity('project',b.dataset.projectKey,b.textContent)});
 }
 function showEntityCanvas(){
  $('#graph-view').hidden=false;$('#list-view').hidden=true;$('.project-picker').hidden=true;picker.hidden=false;
  $('.graph-toolbar strong').textContent='แผนที่ความสัมพันธ์ · '+labels[category()];
  $('#graph').setAttribute('aria-label','กราฟเชิงลึกที่มี '+current().short+' เป็นศูนย์กลาง');
  $('#graph-view').dataset.entity=current().scope;drawGraph();renderDetail();
 }
 async function openEntity(kind,key,name){
  if(!key)return;
  const turn=++graphRequest,cat=categoryFor[kind],depth=depths[cat]||1;
  picked[cat]=key;pickedQuery[cat]=state.search;modes[cat]='graph';state.view=cat==='projects'?'graph':cat;
  const branch=branches[keyOf(kind,key)]||6;
  $('#graph-view').hidden=true;$('#list-view').hidden=false;
  $('#list-view').innerHTML=`<div class="graph-loading"><span class="loading-orbit"></span><strong>กำลังสร้างกราฟ${depth===1?'ภาพรวม':depth===2?'เชิงลึก':'ละเอียดสุด'}</strong><small>${escapeHtml(name||key)}</small></div>`;
  drawToolbar();$('#page-title').textContent=titles[cat];document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',cat==='projects'?n.dataset.view==='graph':n.dataset.view===cat));
  try{
   const g=await api('/api/entity-graph?'+new URLSearchParams({kind,key,limit:String(branch),depth:String(depth)}));
   if(turn!==graphRequest||category()!==cat||modes[cat]!=='graph')return;
   const graphId=g.id+'|d'+depth+'|b'+branch;let ix=APP_DATA.findIndex(x=>x.cache_id===graphId);
   g.cache_id=graphId;if(ix<0){ix=APP_DATA.length;APP_DATA.push(g)}else APP_DATA[ix]=g;
   state.index=ix;state.selected=g.center_id;state.zoom=1;state.pan={x:0,y:0};
   fillPicker(cat);showEntityCanvas();drawToolbar();updateUrl(cat,key);
   $('#more-entity').hidden=!g.coverage.has_more;
   $('#more-entity').disabled=branch>=48;
   $('#more-entity').querySelector('b').textContent=branch>=48?'ถึงเพดานกราฟ':'แสดงกิ่งเพิ่ม';
   $('#more-entity').querySelector('small').textContent=branch>=48?'ยังมีข้อมูลที่ไม่ได้โหลด':`ต่อจุด · ${branch}/48`;
   $('#more-entity').onclick=()=>{if(branch>=48)return;branches[keyOf(kind,key)]=Math.min(48,branch+8);openEntity(kind,key,g.short)};
  }catch(e){if(turn!==graphRequest)return;$('#list-view').innerHTML='<div class="list-card"><div class="empty">'+escapeHtml(e.message)+'</div></div>'}
 }
 function updateUrl(cat,key){
  const url=new URL(location.href);url.searchParams.set('category',cat);url.searchParams.set('key',key);url.searchParams.set('mode','graph');url.searchParams.set('depth',String(depths[cat]));history.replaceState(null,'',url);
 }
 function fillPicker(cat){
  const rows=pages[cat]?.rows||[],select=$('#entity-select');
  select.innerHTML=rows.map(r=>`<option value="${escapeHtml(rowKey(r))}">${escapeHtml(r.title)}</option>`).join('');
  if(picked[cat]&&!rows.some(r=>rowKey(r)===picked[cat])){const o=document.createElement('option');o.value=picked[cat];o.textContent=current().scope?current().short:picked[cat];select.prepend(o)}
  select.value=picked[cat]||'';
  select.onchange=()=>{const r=rows.find(x=>rowKey(x)===select.value);openEntity(kindFor[cat],select.value,r?.title)};
 }
 function recenterNode(n){
  if(n.project_id)return openEntity('project',n.project_id,n.label);
  if(n.type==='Organization'&&n.company_id)return openEntity('company',n.company_id,n.label);
  if(['PersonMention','OrganizationMention'].includes(n.type))return openEntity('person',n.entity_key||n.id,n.label);
  if(n.type==='Agency'&&n.agency_name)return openEntity('agency',n.agency_name,n.label);
 }
 function selectNode(id){
  state.selected=id;
  document.querySelectorAll('#viewport .node').forEach(el=>el.classList.toggle('selected',el.dataset.nodeId===id));
  document.querySelectorAll('#viewport .edge').forEach(el=>el.classList.toggle('is-active',el.dataset.source===id||el.dataset.target===id));
  renderDetail();
 }
 window.TORViews={
  selectNode,
  openRow(type,row){const kind=kindFor[type];if(kind){picked[type]=rowKey(row);modes[type]='graph';openEntity(kind,rowKey(row),row.title)}},
  onRows(type,rows,data){
   pages[type]={rows,data,q:state.search};if(!kindFor[type])return;
   if(modes[type]==='graph'&&rows.length){const retained=picked[type]&&pickedQuery[type]===state.search;const r=rows.find(x=>rowKey(x)===picked[type])||rows[0];openEntity(kindFor[type],retained?picked[type]:rowKey(r),retained?current().short:r.title)}
   else{picker.hidden=true;$('#graph-view').hidden=true;$('#list-view').hidden=false}
   drawToolbar();
  }
 };

 render=function(){
  if(state.view==='graph'&&state.search)state.view='projects';if(state.view==='projects')modes.projects='list';
  const cat=category();if(state.view==='graph')modes.projects='graph';
  originalRender();patchProjectTabs();drawToolbar();
  if(!kindFor[cat]){picker.hidden=true;delete $('#graph-view').dataset.entity;$('.project-picker').hidden=false;$('.graph-toolbar strong').textContent='แผนผังความเชื่อมโยง';return}
  $('#page-title').textContent=titles[cat];
  if(current()?.scope&&categoryFor[current().scope]===cat&&modes[cat]==='graph'){fillPicker(cat);showEntityCanvas()}
  else if(cat!=='projects'){$('.project-picker').hidden=true;picker.hidden=true}
 };

 renderDetail=function(){
  const g=current();if(!g.scope)return originalDetail();
  const n=g.nodes.find(x=>x.id===state.selected)||g.nodes.find(x=>x.id===g.center_id);if(!n)return;
  const links=g.edges.filter(e=>e.source===n.id||e.target===n.id);
  const relationCount=links.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{});
  let details=field('ชื่อ',n.label,'strong');if(n.id===g.center_id)details+='<span class="badge green">จุดศูนย์กลาง</span>';
  if(n.company_id)details+=field('เลขทะเบียนตามต้นทาง',n.company_id);
  if(n.project_id)details+=field('รหัสโครงการ',n.project_id)+field('หน่วยงาน',n.agency||'ไม่พบข้อมูล')+field('วิธีจัดซื้อจัดจ้าง',n.method||'ไม่พบข้อมูล')+(n.amount!=null?field('มูลค่าตามระเบียน',money(n.amount)+' บาท'):'');
  if(n.investAmount!=null)details+=field('เงินลงทุนตามข้อมูล',money(n.investAmount)+' บาท');
  if(n.observed)details+=field('วันที่เก็บข้อมูลทะเบียน',n.observed);
  if(n.identity_status?.startsWith('temporary'))details+=field('สถานะตัวตน','จัดกลุ่มด้วยชื่อชั่วคราว ยังไม่มีรหัสหน่วยงานทางการ');
  if(n.identity_status==='unresolved_mention')details+=field('สถานะตัวตน','ไม่มีตัวระบุ จึงไม่รวมกับชื่อที่เหมือนกันจากแหล่งอื่น');
  const evidence=n.evidence||n.dbd_source;if(evidence)details+=field('หลักฐานของจุด',typeof evidence==='string'?evidence:JSON.stringify(evidence));
  const relationSummary=Object.entries(relationCount).map(([type,count])=>`<span class="relation-chip">${escapeHtml(relationNames[type]||type)} <b>${count}</b></span>`).join('');
  const edgeRows=links.slice(0,200).map((e,i)=>{const target=g.nodes.find(x=>x.id===(e.source===n.id?e.target:e.source));if(!target)return'';const proof=typeof e.evidence==='string'?e.evidence:e.evidence?`${e.evidence.member||e.evidence.archive||''} · แถว ${e.evidence.sequence||'-'}`:'ไม่มีหลักฐานระดับแถว';return `<button class="relation-row" data-edge-index="${i}"><span class="relation-line ${escapeHtml(e.confidence||'medium')}"></span><span class="related-copy"><strong>${escapeHtml(target.label)}</strong><small>${escapeHtml(e.relation_label||relationNames[e.type]||e.type)} · ${escapeHtml(confidenceNames[e.confidence]||'ควรตรวจเพิ่ม')}</small><em>${escapeHtml(e.identity_basis||'อ้างอิงจากข้อมูลต้นทาง')} · ${escapeHtml(proof)}</em></span><span class="relation-arrow">›</span></button>`}).join('');
  const omitted=Object.entries(g.coverage.omitted||{}).map(([k,v])=>`${omittedNames[k]||k} ${Number(v).toLocaleString('th-TH')}`).join(' · ');
  $('#detail').innerHTML=`
   <div class="detail-card entity-detail"><div class="detail-heading"><span class="detail-icon">${(colors[n.type]||colors.UnresolvedBidder)[2]}</span>${typeNames[n.type]||'ข้อมูล'}</div>${details}<div id="entity-actions"></div></div>
   <div class="detail-card relation-panel"><div class="detail-heading">ความสัมพันธ์ของจุดนี้ <span class="count">${links.length}</span></div><div class="relation-summary">${relationSummary||'<span class="detail-source">ยังไม่มีเส้นเชื่อมในขอบเขตที่โหลด</span>'}</div>${edgeRows}${links.length>200?'<p class="detail-source">แสดง 200 ความสัมพันธ์แรกในแผงนี้</p>':''}</div>
   <div class="coverage-card"><div><span class="coverage-level">${g.coverage.depth} ชั้น</span><strong>ขอบเขตกราฟ</strong></div><div class="coverage-stats"><span><b>${g.nodes.length}</b> จุด</span><span><b>${g.edges.length}</b> เส้น</span><span><b>${g.coverage.expanded_nodes}</b> จุดที่ขยาย</span></div><p>${escapeHtml(g.finding)}</p>${omitted?`<small>ยังไม่แสดง: ${escapeHtml(omitted)} — ใช้ปุ่ม “แสดงกิ่งเพิ่ม” หรือเลือกระดับที่ลึกขึ้น</small>`:''}</div>`;
  $('#detail').querySelectorAll('[data-edge-index]').forEach(b=>b.onclick=()=>{const e=links[Number(b.dataset.edgeIndex)],next=e.source===n.id?e.target:e.source;selectNode(next)});
  const action=(text,kind,fn)=>{const b=document.createElement('button');b.className='entity-action '+kind;b.textContent=text;b.onclick=fn;$('#entity-actions').append(b)};
  if(n.type==='OrganizationMention'&&n.related_cid&&g.nodes.some(x=>x.id==='organization:'+n.related_cid))action('เปิดนิติบุคคลที่ตรงกับรหัส','primary',()=>openEntity('company',n.related_cid,n.label));
  if(n.id!==g.center_id&&(['Project','Organization','PersonMention','OrganizationMention','Agency'].includes(n.type)))action('ตั้งจุดนี้เป็นศูนย์กลาง','primary',()=>recenterNode(n));
  if(n.id===g.center_id&&g.coverage.depth<3)action('ขยายลึกขึ้นอีก 1 ชั้น','primary',()=>{depths[category()]=g.coverage.depth+1;openEntity(g.scope,picked[category()]||g.id.split(':').slice(1).join(':'),g.short)});
  action('ส่งออก JSON','secondary',()=>$('#export').click());
 };

 $('#export').onclick=()=>{const g=current();const blob=new Blob([JSON.stringify(g,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=('tor-'+g.id).replace(/[^\p{L}\p{N}_.-]/gu,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('ส่งออกกราฟพร้อมความสัมพันธ์และหลักฐานแล้ว')};
 window.addEventListener('resize',()=>{if(!$('#graph-view').hidden&&current().scope)drawGraph()});
 const initial=new URLSearchParams(location.search),initialCategory=initial.get('category');
 if(kindFor[initialCategory]){state.view=initialCategory==='projects'?'graph':initialCategory;const key=initial.get('key')||'';state.search=initialCategory==='people'?'':key;$('#search').value=state.search;modes[initialCategory]=initial.get('mode')==='list'?'list':'graph';depths[initialCategory]=Math.max(1,Math.min(3,Number(initial.get('depth'))||1));if(key){picked[initialCategory]=key;pickedQuery[initialCategory]=state.search;setTimeout(()=>openEntity(kindFor[initialCategory],key),0)}}
 render();
})();
