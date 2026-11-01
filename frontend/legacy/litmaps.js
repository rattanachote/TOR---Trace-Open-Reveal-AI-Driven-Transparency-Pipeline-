/* Search cards, selectable source inspector, sparse network map and figure export. */
(() => {
 const baseDraw=drawGraph,baseTransform=transform;
 let layout='map',mapBox={x:500,y:360},mapBounds={left:0,top:0,right:1000,bottom:720};
 let showAllMapNodes=false,selectedResult=null,detailOpen=false,rowsNow=[],typeNow='projects',dataNow={},pageNextFn=null,pageFirstFn=null,pageNumber=0;
 const hiddenResults=new Set(),filterState=window.TOR_FILTERS||{};
 window.TOR_FILTERS=filterState;
 const mapColors={project:'#3f70f5',company:'#d17818',person:'#7749dc',agency:'#078f83',item:'#b08512',unknown:'#63738a'};
 const categoryMeta={projects:{title:'โครงการจัดซื้อจัดจ้าง',className:'project',kind:'โครงการ'},companies:{title:'นิติบุคคลในทะเบียน',className:'company',kind:'นิติบุคคล'},people:{title:'ผู้เกี่ยวข้องตามทะเบียน',className:'person',kind:'ผู้เกี่ยวข้อง'},agencies:{title:'หน่วยงาน',className:'agency',kind:'หน่วยงาน'},quality:{title:'ประเด็นที่ต้องตรวจสอบ',className:'unknown',kind:'ข้อมูลตรวจสอบ'}};
 const graphemes=s=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(String(s||''))].map(x=>x.segment):[...String(s||'')];
 const words=s=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'word'}).segment(String(s||''))].map(x=>x.segment):(String(s||'').match(/\s+|[^\s]+/gu)||[]);
 const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
 const typeGroup=t=>t==='Project'?'project':t==='Agency'?'agency':t==='TenderItem'?'item':['PersonMention','OrganizationMention'].includes(t)?'person':['Organization','UnresolvedBidder'].includes(t)?'company':'unknown';
 const relationTitle=e=>e.relation_label||({PROCURES:'หน่วยงานเจ้าของโครงการ',AWARDED_TO:'ได้รับสัญญา',BID_ON:'เสนอราคา',HAS_ITEM:'รายการพิจารณา',REPORTED_RELATED_PARTY:'ปรากฏในทะเบียน',IDENTIFIED_AS:'เชื่อมด้วยตัวระบุ'})[e.type]||e.type||'ความสัมพันธ์';
 const evidenceText=e=>{const v=e?.evidence||e?.dbd_source||'';if(typeof v==='string')return v;if(!v)return 'ไม่มีหลักฐานระดับแถว';return [v.archive,v.member,v.sequence?`แถว ${v.sequence}`:''].filter(Boolean).join(' · ')};
 const mapKindLabel=n=>(typeNames[n.type]||n.type||'ข้อมูล').replace('ผู้ชนะ / ','');
 const canvas=$('#canvas'),svg=$('#graph'),layer=$('#viewport');

 function syncResultsHeader(type,rows,data){
  const meta=categoryMeta[type]||categoryMeta.projects;
  $('#results-title').textContent=meta.title;
  $('#page-title').textContent=meta.title;
  $('#results-caption').textContent=state.search?`ผลจากคำค้น “${state.search}” · ค้นเฉพาะหมวดนี้`:'เลือกผลลัพธ์เพื่อเปิดแผนผัง พร้อมดูหลักฐานต้นทาง';
  $('#result-count').textContent=String(rows.length);
  $('#filter-year-wrap').hidden=type!=='projects';$('#filter-company-wrap').hidden=type!=='companies';$('#filter-people-wrap').hidden=type!=='people';$('#filter-agency-wrap').hidden=type!=='agencies';
  $('#filter-year').value=filterState.year||'';$('#filter-company-contracts').checked=!!filterState.withContracts;$('#filter-people-kind').value=filterState.peopleKind||'';$('#filter-agency-min').value=filterState.agencyMin||'0';
 }
 function resultKey(type,r){return type==='people'?(r.entity||r.entity_key||r.id):type==='agencies'?(r.agency||r.id||r.title):type==='companies'?(r.cid||r.id):type==='projects'?(r.pid||r.id):r.id||r.title}
 function resultCard(type,r,i){
  const meta=categoryMeta[type]||categoryMeta.projects,key=resultKey(type,r),identity=`${type}|${key}`,canOpen=!['quality'].includes(type),year=type==='projects'&&r.note?String(r.note).replace(/^ปี\s*/,''):'';
  const title=r.title||r.name||'ไม่มีชื่อในระเบียน',rid=r.id||r.pid||r.cid||key||'',note=r.note||r.kind||'';
  const tag=type==='projects'?(r.agency||r.kind||'ข้อมูลสัญญา'):type==='companies'?(r.kind||'ข้อมูลทะเบียน'):type==='people'?(r.kind||'บทบาทตามทะเบียน'):type==='agencies'?'ชื่อหน่วยงานที่จัดกลุ่มจากต้นทาง':r.kind||'แถวที่แยกไว้ตรวจสอบ';
  return `<article class="result-card${hiddenResults.has(identity)?' is-hidden':''}" data-result-id="${escapeHtml(identity)}">
   <div class="result-card-head"><span class="result-kind ${meta.className}"><i></i>${escapeHtml(meta.kind)}</span>${year?`<span>${escapeHtml(year)}</span>`:''}</div>
   <h3 class="result-title">${escapeHtml(title)}</h3><small class="result-id">${escapeHtml(rid)}</small>
   <p class="result-note">${escapeHtml(tag)}</p>
   ${note&&note!==tag?`<div class="result-meta"><span>${escapeHtml(note)}</span>${r.cid&&type==='people'?`<span>นิติบุคคล ${escapeHtml(r.cid)}</span>`:''}</div>`:''}
   <div class="result-actions">${canOpen?`<button class="result-open" type="button" data-open-result="${i}">สำรวจความสัมพันธ์ ↗</button>`:''}<button type="button" data-hide-result="${i}" aria-label="ซ่อนรายการนี้">ซ่อน</button></div>
  </article>`;
 }
 function drawResultCards(type,rows,data){
  rowsNow=rows||[];typeNow=type;dataNow=data||{};syncResultsHeader(typeNow,rowsNow,dataNow);
  const eligible=rowsNow.filter(r=>!hiddenResults.has(`${typeNow}|${resultKey(typeNow,r)}`));
  const list=$('#litmaps-results');
  list.innerHTML=rowsNow.length?`<div class="results-section-label"><span>${state.search?'ผลการค้นหา':'รายการล่าสุดจากชุดข้อมูล'}</span><span>${eligible.length} รายการที่แสดง</span></div>${rowsNow.map((r,i)=>resultCard(typeNow,r,i)).join('')}`:`<div class="result-empty">ไม่พบรายการในหมวดนี้<br>ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง</div>`;
  list.querySelectorAll('[data-open-result]').forEach(b=>b.onclick=()=>openResult(Number(b.dataset.openResult)));
  list.querySelectorAll('[data-hide-result]').forEach(b=>b.onclick=()=>{const r=rowsNow[Number(b.dataset.hideResult)];hiddenResults.add(`${typeNow}|${resultKey(typeNow,r)}`);drawResultCards(typeNow,rowsNow,dataNow)});
  const prev=$('#results-pagination'),hasNext=!!dataNow.next,hasPrev=pageNumber>0;prev.hidden=!(hasNext||hasPrev);$('#page-label').textContent=`หน้า ${pageNumber+1} · แสดง ${rowsNow.length} รายการ${hasNext?' · มีหน้าถัดไป':''}`;$('#page-prev').disabled=!hasPrev;$('#page-next').disabled=!hasNext;
 }
 function openResult(index){
  const row=rowsNow[index];if(!row)return;
  selectedResult=resultKey(typeNow,row);detailOpen=false;$('#entity-inspector').hidden=true;$('#results-pane').classList.remove('detail-mode');
  if(typeNow==='quality'){toast('แถวนี้อยู่ในรายการตรวจคุณภาพข้อมูล');return}
  if(window.TORViews?.openRow){window.TORViews.openRow(typeNow,row);return}
  if(row.pid&&window.openDatabaseProject)window.openDatabaseProject(row.pid);
 }
 function setRowsLoading(){if(!$('#list-view').hidden||state.view!=='graph')$('#litmaps-results').innerHTML='<div class="result-loading">กำลังค้นจากฐานข้อมูลในเครื่อง…</div>'}
 function refreshPage(){if(typeof renderList==='function'){pageNumber=0;setRowsLoading();renderList()}}
 window.TORViews.onRows=((original)=>function(type,rows,data){
  const next=$('#db-next'),first=$('#db-first');pageNextFn=next?.onclick||null;pageFirstFn=first?.onclick||null;
  if(type!==typeNow)pageNumber=0;
  drawResultCards(type,rows,data);
  if(original)original(type,rows,data);
  if(layout==='map'&&current()?.fullData)drawGraph();
 })(window.TORViews.onRows);
 const oldOpenRow=window.TORViews.openRow;
 window.TORViews.openRow=(type,row)=>{detailOpen=false;$('#entity-inspector').hidden=true;$('#results-pane').classList.remove('detail-mode');oldOpenRow(type,row);};
 $('#page-next').onclick=()=>{if(pageNextFn){pageNumber++;pageNextFn.call($('#db-next'))}};
 $('#page-prev').onclick=()=>{if(pageFirstFn){pageNumber=0;pageFirstFn.call($('#db-first'))}};
 $('#results-filter-toggle').onclick=()=>{const panel=$('#filter-panel'),show=panel.hidden;panel.hidden=!show;$('#results-filter-toggle').setAttribute('aria-expanded',String(show))};
 $('#filter-reset').onclick=()=>{filterState.year='';filterState.withContracts=false;filterState.peopleKind='';filterState.agencyMin='0';$('#filter-year').value='';$('#filter-company-contracts').checked=false;$('#filter-people-kind').value='';$('#filter-agency-min').value='0';refreshPage()};
 $('#apply-filters').onclick=()=>{filterState.year=$('#filter-year').value;filterState.withContracts=$('#filter-company-contracts').checked;filterState.peopleKind=$('#filter-people-kind').value;filterState.agencyMin=$('#filter-agency-min').value;pageNumber=0;refreshPage();$('#filter-panel').hidden=true;$('#results-filter-toggle').setAttribute('aria-expanded','false')};
 $('#refresh-results').onclick=refreshPage;
 $('#search').placeholder='ค้นหาในหมวดที่เลือก…';
 $('#search').addEventListener('input',()=>{pageNumber=0;setRowsLoading()});
 document.querySelectorAll('.nav').forEach(button=>button.addEventListener('click',()=>{pageNumber=0;detailOpen=false;$('#entity-inspector').hidden=true;$('#results-pane').classList.remove('detail-mode');setRowsLoading()}));
 $('#inspector-close').onclick=()=>{detailOpen=false;$('#entity-inspector').hidden=true;$('#results-pane').classList.remove('detail-mode')};
 function syncInspectorTitle(){
  const g=current();if(!g?.scope)return;
  const n=g.nodes?.find(x=>x.id===state.selected)||g.nodes?.find(x=>x.id===g.center_id);if(n){$('#inspector-title').textContent=n.label||'รายละเอียด';$('#entity-inspector').setAttribute('data-kind',mapKindLabel(n))}
 }
 function syncGraphSeedResult(){
  const g=current();if(!g?.scope)return;
  const category={project:'projects',company:'companies',person:'people',agency:'agencies'}[g.scope];if(!category)return;
  const n=g.nodes?.find(x=>x.id===g.center_id)||g.nodes?.[0];if(!n)return;
  const key=g.scope==='project'?(n.project_id||String(g.id||'').replace(/^project:/,'')):g.scope==='company'?(n.company_id||String(g.id||'').replace(/^company:/,'')):g.scope==='person'?(n.entity_key||n.id):n.agency_name||n.label;
  const present=typeNow===category&&rowsNow.some(r=>String(resultKey(typeNow,r))===String(key));if(present)return;
  const row={title:n.label||g.short||key,id:key,kind:mapKindLabel(n),note:g.scope==='project'?(n.agency||'ข้อมูลโครงการ'):g.scope==='company'?`${Number(g.coverage?.source_contract_rows||0).toLocaleString('th-TH')} แถวสัญญาในชุดข้อมูล`:g.scope==='person'?'เชื่อมจากตัวระบุบุคคลในทะเบียน':'ชื่อหน่วยงานตามต้นทาง'};
  if(g.scope==='project')row.pid=key;if(g.scope==='company')row.cid=key;if(g.scope==='person')row.entity=key;if(g.scope==='agency')row.agency=key;
  pageNumber=0;drawResultCards(category,[row],{});
 }
 const oldSelect=window.TORViews.selectNode;
 window.TORViews.selectNode=id=>{detailOpen=true;$('#entity-inspector').hidden=false;$('#results-pane').classList.add('detail-mode');if(oldSelect)oldSelect(id);syncInspectorTitle();};
 const previousDetail=renderDetail;
 renderDetail=function(){previousDetail();syncInspectorTitle();syncGraphSeedResult()};

 function connectedSubgraph(g){
  const candidates=(g.nodes||[]).filter(n=>n.id===g.center_id||((state.people||!['PersonMention','OrganizationMention'].includes(n.type))&&(state.items||n.type!=='TenderItem')));
  const ids=new Set(candidates.map(n=>n.id)),edges=(g.edges||[]).filter(e=>ids.has(e.source)&&ids.has(e.target)),adj=new Map(candidates.map(n=>[n.id,[]]));
  edges.forEach(e=>{adj.get(e.source)?.push(e.target);adj.get(e.target)?.push(e.source)});
  const center=candidates.find(n=>n.id===g.center_id)||candidates.find(n=>n.type==='Project')||candidates[0];if(!center)return{nodes:[],edges:[],dist:new Map(),center:null};
  const dist=new Map([[center.id,0]]),queue=[center.id];for(let i=0;i<queue.length;i++){const id=queue[i];for(const next of adj.get(id)||[])if(!dist.has(next)){dist.set(next,dist.get(id)+1);queue.push(next)}}
  const connected=candidates.filter(n=>dist.has(n.id)),rank={Agency:0,Organization:1,UnresolvedBidder:2,PersonMention:3,OrganizationMention:4,Project:5,TenderItem:6};
  connected.sort((a,b)=>(dist.get(a.id)-dist.get(b.id))||(rank[a.type]??9)-(rank[b.type]??9)||String(a.label||'').localeCompare(String(b.label||''),'th')||String(a.project_id||a.company_id||a.id).localeCompare(String(b.project_id||b.company_id||b.id),'en',{numeric:true}));
  return{nodes:connected,edges,dist,center};
 }
 function placeMapNodes(nodes,edges,dist,center,width,height){
  const cx=width/2,cy=height/2,positions=new Map([[center.id,{x:cx,y:cy}]]),byLayer=new Map();
  nodes.filter(n=>n.id!==center.id).forEach(n=>{const d=Math.min(3,dist.get(n.id)||1);if(!byLayer.has(d))byLayer.set(d,[]);byLayer.get(d).push(n)});
  for(const[d,list]of byLayer){const rotation=(hash(list.map(n=>n.id).sort().join('|'))%6283)/1000;list.forEach((n,i)=>{const angle=rotation+(i/list.length)*Math.PI*2,r=142+d*132+Math.max(0,list.length-8)*2.1;positions.set(n.id,{x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r*.73})})}
  const initial=new Map([...positions].map(([k,p])=>[k,{...p}])),byId=new Map(nodes.map(n=>[n.id,n]));
  const mobile=false;
  for(let step=0;step<115;step++){
   const force=new Map(nodes.map(n=>[n.id,{x:0,y:0}]));
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],pa=positions.get(a.id),pb=positions.get(b.id),dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.max(1,Math.hypot(dx,dy)),labelNeed=Math.min(190,44+(graphemes(a.label).length+graphemes(b.label).length)*2.2),min=Math.max(92,labelNeed);
    if(d<min){const push=(min-d)*.024,ux=dx/d,uy=dy/d,fa=force.get(a.id),fb=force.get(b.id);fa.x-=ux*push;fa.y-=uy*push;fb.x+=ux*push;fb.y+=uy*push}
   }
   for(const e of edges){const pa=positions.get(e.source),pb=positions.get(e.target);if(!pa||!pb)continue;const dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.max(1,Math.hypot(dx,dy)),ideal=dist.get(e.source)===0||dist.get(e.target)===0?218:170,pull=(d-ideal)*.0017,ux=dx/d,uy=dy/d,fa=force.get(e.source),fb=force.get(e.target);fa.x+=ux*pull;fa.y+=uy*pull;fb.x-=ux*pull;fb.y-=uy*pull}
   for(const n of nodes){if(n.id===center.id)continue;const p=positions.get(n.id),start=initial.get(n.id),f=force.get(n.id),d=Math.max(1,dist.get(n.id)||1);f.x+=(start.x-p.x)*.003+(cx-p.x)*.00055;f.y+=(start.y-p.y)*.003+(cy-p.y)*.00055;const cap=5,mag=Math.hypot(f.x,f.y)||1;if(mag>cap){f.x=f.x/mag*cap;f.y=f.y/mag*cap}p.x=Math.max(110,Math.min(width-110,p.x+f.x));p.y=Math.max(80,Math.min(height-86,p.y+f.y))}
  }
  return{positions,cx,cy,byId};
 }
 function mapTransform(){layer.setAttribute('transform',`translate(${mapBox.x+state.pan.x} ${mapBox.y+state.pan.y}) scale(${state.zoom}) translate(${-mapBox.x} ${-mapBox.y})`);$('#zoom-value').textContent=Math.round(state.zoom*100)+'%'}
 function makeMapGraph(){
  const g=current();if(!g?.fullData){return baseDraw()}
  const graph=connectedSubgraph(g);if(!graph.center)return;
  const total=graph.nodes.length,cap=showAllMapNodes?total:(graph.dist.get(graph.nodes.at(-1)?.id)||0)>=3?48:64,nodes=graph.nodes.slice(0,cap),ids=new Set(nodes.map(n=>n.id)),edges=graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  const width=Math.max(1000,Math.min(1320,920+nodes.length*5)),boxRatio=Math.max(.36,Math.min(1.05,(canvas.clientHeight||620)/(canvas.clientWidth||900))),height=Math.round(width*boxRatio),layoutData=placeMapNodes(nodes,edges,graph.dist,graph.center,width,height),positions=layoutData.positions;mapBox={x:width/2,y:height/2};
  const boundsPoints=nodes.map(n=>positions.get(n.id)).filter(Boolean);mapBounds={left:Math.min(...boundsPoints.map(p=>p.x)),right:Math.max(...boundsPoints.map(p=>p.x)),top:Math.min(...boundsPoints.map(p=>p.y)),bottom:Math.max(...boundsPoints.map(p=>p.y))};
  layer.replaceChildren();const defs=svg.querySelector('defs');defs.querySelectorAll('[data-lit-arrow]').forEach(n=>n.remove());const marker=svgElement('marker',{id:'lit-arrow',viewBox:'0 0 10 10',refX:'8',refY:'5',markerWidth:'6',markerHeight:'6',markerUnits:'userSpaceOnUse',orient:'auto','data-lit-arrow':'1'});marker.append(svgElement('path',{d:'M0 0 L9 5 L0 10 Z',fill:'#a9b4c2'}));defs.append(marker);
  const pairCounts=new Map();edges.forEach(e=>{const key=[e.source,e.target].sort().join('|');pairCounts.set(key,(pairCounts.get(key)||0)+1)});const pairIndex=new Map();
  edges.forEach(e=>{
   const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)return;const key=[e.source,e.target].sort().join('|'),count=pairCounts.get(key),index=pairIndex.get(key)||0;pairIndex.set(key,index+1);const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),ux=dx/d,uy=dy/d,na=layoutData.byId.get(e.source),nb=layoutData.byId.get(e.target),ra=na.id===graph.center.id?26:17,rb=nb.id===graph.center.id?26:17,sx=a.x+ux*ra,sy=a.y+uy*ra,tx=b.x-ux*rb,ty=b.y-uy*rb,mx=(sx+tx)/2,my=(sy+ty)/2,offset=(index-(count-1)/2)*18,nx=-uy*offset,ny=ux*offset,confidence=e.confidence||(e.identity_status==='unresolved_mention'?'low':'medium'),path=svgElement('path',{d:`M${sx} ${sy} Q${mx+nx} ${my+ny} ${tx} ${ty}`,class:`redesign-edge lm-edge${confidence==='low'?' low':''}`,'data-source':e.source,'data-target':e.target,'data-type':e.type,'marker-end':'url(#lit-arrow)'});
   const title=svgElement('title');title.textContent=`${relationTitle(e)} · ${e.identity_basis||'อ้างอิงข้อมูลต้นทาง'} · ${evidenceText(e)}`;path.append(title);layer.append(path);
  });
  nodes.forEach(n=>{
   const p=positions.get(n.id);if(!p)return;const group=typeGroup(n.type),color=mapColors[group],isCenter=n.id===graph.center.id,isSelected=n.id===state.selected,r=isCenter?25:16,el=svgElement('g',{class:`node redesign-node lit-node${isCenter?' center-node':''}${isSelected?' selected':''}`,transform:`translate(${p.x} ${p.y})`,role:'button',tabindex:'0','aria-label':`${n.label} · ${mapKindLabel(n)}`,'data-node-id':n.id});
   el.append(svgElement('circle',{class:'node-halo',r,fill:isCenter?'#344155':isSelected?'#edf2ff':'#fff',stroke:isCenter?'#344155':color,'stroke-width':isSelected?2.5:1.7}));
   if(!isCenter)el.append(svgElement('circle',{cx:0,cy:0,r:3.2,fill:color}));else{const centerMark=svgElement('text',{x:0,y:5,'text-anchor':'middle',fill:'#fff','font-size':13,'font-family':'Arial'});centerMark.textContent='•';el.append(centerMark)}
   const label=String(n.label||'ไม่ระบุชื่อ'),labelParts=wrapMapLabel(label,20,2),startY=r+15;labelParts.forEach((line,i)=>{const t=svgElement('text',{x:0,y:startY+i*12,'text-anchor':'middle',class:'redesign-label'});t.textContent=line;el.append(t)});
   const sub=n.project_id||n.company_id||mapKindLabel(n);const subText=svgElement('text',{x:0,y:startY+labelParts.length*12-1,'text-anchor':'middle',class:'redesign-sub'});subText.textContent=shortText(sub,19);el.append(subText);
   const tip=svgElement('title');tip.textContent=[label,mapKindLabel(n),n.project_id||n.company_id||'',evidenceText({evidence:n.evidence||n.dbd_source})].filter(Boolean).join(' · ');el.append(tip);
   el.onclick=()=>window.TORViews?.selectNode?window.TORViews.selectNode(n.id):(state.selected=n.id,drawGraph(),renderDetail());el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click()}};layer.append(el);
  });
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');const displayWidth=Math.max(320,canvas.clientWidth||900),displayHeight=Math.max(300,Math.min(canvas.clientHeight||820,Math.round(displayWidth*height/width)));svg.style.width='100%';svg.style.height=displayHeight+'px';svg.style.minWidth='0';svg.style.setProperty('--graph-width','100%');svg.style.setProperty('--graph-height',displayHeight+'px');svg.dataset.layout='map';canvas.dataset.layout='map';
  const hidden=Math.max(0,total-nodes.length),nodeToggle=$('#nodes-view-toggle');nodeToggle.hidden=total===nodes.length;nodeToggle.textContent=showAllMapNodes?'ย่อกราฟ':`ทุกจุด ${total}`;nodeToggle.setAttribute('aria-pressed',String(showAllMapNodes));nodeToggle.onclick=()=>{showAllMapNodes=!showAllMapNodes;state.zoom=1;state.pan={x:0,y:0};drawGraph()};
  $('#edge-view-toggle').hidden=true;$('#graph-count').textContent=`${nodes.length}/${total} จุด · ${edges.length}/${graph.edges.length} เส้น`;$('#graph-count').title='แสดงเฉพาะจุดที่เชื่อมถึงจุดตั้งต้น และเส้นทั้งหมดระหว่างจุดที่แสดง';$('#project-code').textContent=g.short||g.id;
  const unlinked=$('#unlinked-note');unlinked.hidden=graph.nodes.length===total;unlinked.textContent=graph.nodes.length>total?`ไม่นับ ${graph.nodes.length-total} จุดที่ถูกกรองออก`:(hidden?`กำลังแสดง ${nodes.length} จาก ${total} จุด`:'');
  const dup=$('#duplicate-note');dup.hidden=true;$('#graph-layout-hint').hidden=true;
  const categoryCounts={};nodes.filter(n=>n.id!==graph.center.id).forEach(n=>{const k=typeGroup(n.type);categoryCounts[k]=(categoryCounts[k]||0)+1});$('.legend').innerHTML=Object.entries(categoryCounts).map(([k,v])=>`<span><i class="dot ${k==='company'?'org':k}"></i>${({project:'โครงการ',company:'นิติบุคคล',person:'ผู้เกี่ยวข้อง',agency:'หน่วยงาน',item:'รายการ',unknown:'อื่นๆ'})[k]} ${v}</span>`).join('')+`<span class="map-edge-legend"><i></i>เส้นเชื่อม</span><span class="map-edge-legend uncertain"><i></i>ควรตรวจเพิ่ม</span>`;
  mapTransform();attachHover();syncLayoutSwitch();
 }
 function wrapMapLabel(value,max=20,maxLines=2){const out=[];let line='';for(const token of words(value)){if(!token.trim()&&!line)continue;if(line&&graphemes(line+token).length>max){out.push(line.trimEnd());line=token.trimStart()}else line+=token;if(graphemes(line).length>max){out.push(graphemes(line).slice(0,max).join(''));line=graphemes(line).slice(max).join('')}}if(line.trim()||!out.length)out.push(line.trim());if(out.length>maxLines){out.length=maxLines;out[maxLines-1]=shortText(out[maxLines-1],maxLines===1?max:max-1)}return out}
 function shortText(s,max){const chars=graphemes(s);return chars.length>max?chars.slice(0,max-1).join('')+'…':String(s||'')}
 function syncLayoutSwitch(){document.querySelectorAll('#layout-switch [data-layout]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.layout===layout));b.onclick=()=>{if(layout===b.dataset.layout)return;layout=b.dataset.layout;const url=new URL(location.href);url.searchParams.set('layout',layout);history.replaceState(null,'',url);state.zoom=1;state.pan={x:0,y:0};canvas.scrollTop=0;canvas.scrollLeft=0;drawGraph()}})}
 function attachHover(){
  svg.onpointerover=e=>{const node=e.target.closest?.('.lit-node'),edge=e.target.closest?.('.lm-edge');const id=node?.dataset.nodeId;if(!id&&!edge)return;layer.querySelectorAll('.lm-hover-edge,.lm-dim-edge,.lm-hover-node,.lm-neighbor-node,.lm-dim-node').forEach(el=>el.classList.remove('lm-hover-edge','lm-dim-edge','lm-hover-node','lm-neighbor-node','lm-dim-node'));
   const focus=id||edge?.dataset.source;if(!focus)return;const incident=[...layer.querySelectorAll('.lm-edge')].filter(line=>line.dataset.source===focus||line.dataset.target===focus);const neighbors=new Set([focus]);incident.forEach(line=>{line.classList.add('lm-hover-edge');neighbors.add(line.dataset.source);neighbors.add(line.dataset.target)});layer.querySelectorAll('.lit-node').forEach(el=>{if(neighbors.has(el.dataset.nodeId))el.classList.add(el.dataset.nodeId===focus?'lm-hover-node':'lm-neighbor-node');else el.classList.add('lm-dim-node')});layer.querySelectorAll('.lm-edge').forEach(line=>{if(!incident.includes(line))line.classList.add('lm-dim-edge')});
  };
  svg.onpointerleave=()=>layer.querySelectorAll('.lm-hover-edge,.lm-dim-edge,.lm-hover-node,.lm-neighbor-node,.lm-dim-node').forEach(el=>el.classList.remove('lm-hover-edge','lm-dim-edge','lm-hover-node','lm-neighbor-node','lm-dim-node'));
 }
 const oldDraw=drawGraph;
 drawGraph=function(){if(layout==='map'&&current()?.fullData)return makeMapGraph();oldDraw();syncLayoutSwitch()};
 transform=function(){if(layout==='map'&&current()?.fullData)return mapTransform();baseTransform()};
 function showFigure(){
  if(!current()?.fullData){toast('เปิดแผนผังจากฐานข้อมูลก่อนส่งออกภาพ');return}
  drawGraph();const preview=$('#figure-preview');preview.replaceChildren();const clone=svg.cloneNode(true);clone.removeAttribute('id');clone.setAttribute('xmlns','http://www.w3.org/2000/svg');const viewBox=svg.getAttribute('viewBox')||'0 0 1000 700',ratio=$('#figure-ratio').value.split(':').map(Number);const W=1800,H=Math.round(W*ratio[1]/ratio[0]);clone.setAttribute('width',W);clone.setAttribute('height',H);clone.style.width='100%';clone.style.height='100%';clone.style.maxWidth='100%';clone.style.maxHeight='100%';clone.style.background='#fff';const style=svgElement('style');style.textContent='.redesign-edge{fill:none;stroke:#c8d0db;stroke-width:1.25;stroke-opacity:.72}.redesign-edge.low{stroke-dasharray:3 5}.redesign-node .node-halo{fill:#fff;stroke-width:1.7}.redesign-node.center-node .node-halo{fill:#344155;stroke:#344155}.redesign-label{font:500 10px Tahoma,sans-serif;fill:#53647a;paint-order:stroke;stroke:#fff;stroke-width:3.5;stroke-linejoin:round}.redesign-sub{font:400 8px Tahoma,sans-serif;fill:#98a2b0;paint-order:stroke;stroke:#fff;stroke-width:2.5}.lm-edge{marker-end:url(#lit-arrow)}';clone.insertBefore(style,clone.firstChild);const bg=svgElement('rect',{x:0,y:0,width:'100%',height:'100%',fill:'#fff'});clone.insertBefore(bg,clone.querySelector('#viewport')||clone.lastChild);clone.setAttribute('viewBox',viewBox);preview.append(clone);$('#figure-frame').style.aspectRatio=`${ratio[0]} / ${ratio[1]}`;$('#figure-modal').hidden=false;document.body.classList.add('figure-open-state');$('#figure-close').focus();
 }
 function exportSvgString(){const clone=$('#figure-preview svg')?.cloneNode(true);if(!clone)return null;const ratio=$('#figure-ratio').value.split(':').map(Number),width=2400,height=Math.round(width*ratio[1]/ratio[0]);clone.setAttribute('width',width);clone.setAttribute('height',height);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');return new XMLSerializer().serializeToString(clone)}
 function download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1800)}
 function safeName(){return('tor-graph-'+(current()?.short||current()?.id||'export')).replace(/[^\p{L}\p{N}_.-]/gu,'_')}
 $('#figure-export').onclick=showFigure;$('#figure-export-inline').onclick=showFigure;$('#figure-ratio').onchange=showFigure;
 $('#figure-close').onclick=()=>{$('#figure-modal').hidden=true;document.body.classList.remove('figure-open-state')};$('#figure-modal').addEventListener('click',e=>{if(e.target===$('#figure-modal'))$('#figure-close').click()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#figure-modal').hidden)$('#figure-close').click()});
 $('#download-svg').onclick=()=>{const content=exportSvgString();if(content)download(safeName()+'.svg',new Blob([content],{type:'image/svg+xml;charset=utf-8'}))};
 $('#download-png').onclick=()=>{const content=exportSvgString();if(!content)return;const url=URL.createObjectURL(new Blob([content],{type:'image/svg+xml;charset=utf-8'})),img=new Image();img.onload=()=>{const ratio=$('#figure-ratio').value.split(':').map(Number),width=2400,height=Math.round(width*ratio[1]/ratio[0]),c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);const vb=svg.getAttribute('viewBox').split(/\s+/).map(Number);ctx.drawImage(img,0,0,width,height);c.toBlob(blob=>{if(blob)download(safeName()+'.png',blob);URL.revokeObjectURL(url)},'image/png')};img.onerror=()=>{URL.revokeObjectURL(url);toast('ส่งออก PNG ไม่สำเร็จ ลองใช้ SVG ได้')};img.src=url};
 $('#filter-toggle-graph').onclick=()=>$('#filter-toggle').click();
 const oldFit=$('#fit').onclick;$('#fit').onclick=()=>{if(layout!=='map'){oldFit?.();return}state.zoom=1;state.pan={x:0,y:0};canvas.scrollTop=0;canvas.scrollLeft=0;mapTransform()};
 $('#zoom-in').onclick=()=>{state.zoom=Math.min(2.5,(state.zoom||1)+.15);transform()};$('#zoom-out').onclick=()=>{state.zoom=Math.max(.45,(state.zoom||1)-.15);transform()};
 function initialFallback(){
  const g=current();if(!g)return;const r={title:g.contract?.['ชื่อโครงการจัดซื้อจัดจ้าง']||g.short||g.id,id:g.id,pid:g.id,agency:g.contract?.['ชื่อหน่วยงานย่อย']||'ตัวอย่างในเครื่อง',kind:'ตัวอย่างโครงการ',note:g.amount?`${money(g.amount)} บาท`:''};drawResultCards('projects',[r],{});
 }
 if(current()?.fullData)drawGraph();
 setTimeout(()=>{if(!rowsNow.length)initialFallback();syncLayoutSwitch()},0);
 window.addEventListener('resize',()=>{if(layout==='map'&&current()?.fullData)drawGraph()});
})();
