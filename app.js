const $=id=>document.getElementById(id);
const STORAGE='nestmap-nests-v5';
const OBS=['para','zaniepokojone dorosłe','dorosły noszący materiał gniazdowy','ptak latający w pobliżu gniazda','krążący ptak','ptak zlatujący z gniazda','dorosłe ze skorupkami jaj','dorosły z pokarmem','inkubacja','pisklęta w gnieździe','świeże gałązki','napuszone gniazdo','puch na gnieździe','pióra na gnieździe','pióra pod drzewem','odchody','skorupki jaj','wypluwki','ofiary w okolicy gniazda','brak śladów użytkowania','nocujące ptaki na lub przy gnieździe'];
let nests=JSON.parse(localStorage.getItem(STORAGE)||'[]');
let map,currentNestId=null,currentControl=0,markersVisible=true,speciesQuery='',selectedSpeciesCodes=new Set(),filterVisibility='all',filterYear='',editing=false,watchId=null,userPos=null,bdlEnabled=false,bdlLayer=null,bdlBusy=false,bdlRequestSeq=0;
const blankControl=()=>({criterion:'',observations:[],count:'',chicks:'',tree:'',treeCode:'',date:'',time:'',notes:'',});
const now=()=>{const d=new Date();return {date:d.toLocaleDateString('en-CA'),time:d.toTimeString().slice(0,5)}};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function save(){localStorage.setItem(STORAGE,JSON.stringify(nests))}
function nextNumber(code){let max=0;nests.filter(n=>n.birdCode===code).forEach(n=>max=Math.max(max,parseInt(n.number)||0));return String(max+1).padStart(2,'0')}
const TILE_DB='nestmap-tiles-v4';
// Widoczne kafelki mapy są automatycznie zapamiętywane przez Service Worker (MAP cache).
function openTileDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(TILE_DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('tiles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function putCachedTile(key,blob){try{const db=await openTileDB();await new Promise((res,rej)=>{const q=db.transaction('tiles','readwrite').objectStore('tiles').put(blob,key);q.onsuccess=res;q.onerror=()=>rej(q.error)})}catch{}}
async function cacheTileUrl(url){try{const r=await fetch(url,{mode:'cors',cache:'reload'});if(!r.ok)return false;const cache=await caches.open('nestmap-map-tiles-v2');await cache.put(url,r.clone());return true}catch{return false}}
function initMap(){
 map=L.map('map',{zoomControl:false,scrollWheelZoom:true,doubleClickZoom:true,touchZoom:true,boxZoom:true,keyboard:true,minZoom:2,maxZoom:19,worldCopyJump:false,zoomSnap:1,zoomDelta:1,zoomAnimation:true,fadeAnimation:true,markerZoomAnimation:true,preferCanvas:true,attributionControl:true}).setView([52.1,19.4],6);
 const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,maxNativeZoom:19,tileSize:256,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true,crossOrigin:true,attribution:'Tiles © Esri'}).addTo(map); window.__nmImagery=imagery;
 const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true,attribution:'© OpenStreetMap'}); window.__nmStreets=streets;
 bdlLayer=L.tileLayer.wms('https://mapserver.bdl.lasy.gov.pl/arcgis/services/WMS_BDL_mapa_drzewostanow/MapServer/WMSServer',{layers:'5,11',format:'image/png',transparent:true,version:'1.3.0',opacity:0.72,attribution:'BDL Lasy Państwowe',uppercase:true});
 const cross=document.createElement('div');cross.className='crosshair';cross.textContent='＋';$('map').appendChild(cross);
 map.on('load moveend zoomend',()=>setTimeout(()=>map.invalidateSize(false),50));
 map.on('click',e=>{if(bdlEnabled)showBDLAtPoint(e.latlng)});
 setTimeout(()=>map.invalidateSize(true),300);
 if(navigator.geolocation&&!nests.length) navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],15),()=>{},{enableHighAccuracy:true,timeout:8000,maximumAge:60000});
 renderMarkers();
}
function locatePhone(){if(!window.isSecureContext||!navigator.geolocation)return alert('Lokalizacja jest niedostępna. Otwórz NestMap przez https://dostrowskii-svg.github.io/NestMap/.');$('mapStatus').textContent='Pobieram dokładną lokalizację telefonu…';let done=false;const apply=p=>{if(done)return;done=true;userPos=[p.coords.latitude,p.coords.longitude];map.setView(userPos,17,{animate:true});$('mapStatus').textContent='Mapa ustawiona na lokalizacji telefonu.';renderMarkers()};const fail=e=>{if(done)return;let msg='Nie udało się pobrać lokalizacji telefonu.';if(e&&e.code===1)msg='Safari nie udostępniło lokalizacji. Sprawdź: Ustawienia → Prywatność i ochrona → Usługi lokalizacji → Witryny Safari → „Gdy używam aplikacji”.';else if(e&&e.code===2)msg='Telefon nie może teraz ustalić pozycji. Wyjdź na otwartą przestrzeń i spróbuj ponownie.';else if(e&&e.code===3)msg='Pobieranie lokalizacji trwało zbyt długo. Spróbuj ponownie.';$('mapStatus').textContent=msg;alert(msg)};navigator.geolocation.getCurrentPosition(apply,fail,{enableHighAccuracy:true,timeout:20000,maximumAge:0})}
function toggleBDL(){
 if(!bdlLayer)return;
 bdlEnabled=!bdlEnabled;
 const btn=$('bdlBtn');
 if(bdlEnabled){
   bdlLayer.addTo(map);
   if(btn){btn.classList.add('active');btn.textContent='🌲 Drzewostany BDL ✓'}
   $('mapStatus').textContent='Drzewostany BDL są dostępne online. Kliknij wydzielenie, aby zobaczyć opis.';
 }else{
   map.removeLayer(bdlLayer);
   if(btn){btn.classList.remove('active');btn.textContent='🌲 Drzewostany BDL'}
   $('mapStatus').textContent='Przesuń mapę tak, aby krzyżyk wskazywał miejsce gniazda.';
 }
}
function webMercator(lat,lon){
 const x=lon*20037508.34/180;
 const y=Math.log(Math.tan((90+lat)*Math.PI/360))/(Math.PI/180);
 return [x,y*20037508.34/180];
}
async function bdlQuery(layerId,lat,lon){
 const [x,y]=webMercator(lat,lon);
 const params=new URLSearchParams({where:'1=1',geometry:`${x},${y}`,geometryType:'esriGeometryPoint',inSR:'3857',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false',f:'json'});
 const u=`https://mapserver.bdl.lasy.gov.pl/arcgis/rest/services/WMS_BDL_mapa_drzewostanow/MapServer/${layerId}/query?${params}`;
 const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('BDL HTTP '+r.status);return r.json();
}
function bdlVal(v){return v===null||v===undefined||v===''?'—':String(v)}
function bdlPopup(g,species){
 const a=g||{};
 const addr=bdlVal(a.adress_forest);
 const area=bdlVal(a.sub_area);
 const rows=[
  ['Adres leśny',addr],['Rodzaj powierzchni',bdlVal(a.area_type_cd)],['TSL',bdlVal(a.site_type_cd)],['Gospodarstwo',bdlVal(a.silviculture_cd)],['Funkcja lasu',bdlVal(a.forest_func_cd)],['Budowa pionowa',bdlVal(a.stand_struct_cd)],['Wiek rębności',bdlVal(a.rotation_age)],['Powierzchnia (ha)',area],['Kategoria ochronności',bdlVal(a.prot_category_cd)]
 ];
 const general=rows.map(r=>`<div class="bdlRow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');
 const speciesRows=(species||[]).map(x=>{const p=x.attributes||x;return `<div class="bdlSpeciesRow"><b>${esc(bdlVal(p.species_cd))}</b><span>Udział: ${esc(bdlVal(p.part_cd))}</span><span>Wiek: ${esc(bdlVal(p.species_age))}</span>${p.storey_cd?`<span>Warstwa: ${esc(bdlVal(p.storey_cd))}</span>`:''}</div>`}).join('');
 return `<div class="bdlPopup"><h3>Opis taksacyjny</h3><div class="bdlSectionTitle">ADRES</div><div class="bdlRows">${general}</div><div class="bdlSectionTitle">GATUNKI</div>${speciesRows||'<div class="muted">Brak szczegółowych danych o gatunkach.</div>'}<div class="bdlSource">Źródło: Bank Danych o Lasach · dane online</div></div>`;
}
async function showBDLAtPoint(latlng){
 if(!bdlEnabled||bdlBusy)return;
 const seq=++bdlRequestSeq;bdlBusy=true;
 $('mapStatus').textContent='Pobieram opis wydzielenia z BDL…';
 try{
  const [g,s]=await Promise.all([bdlQuery(5,latlng.lat,latlng.lng),bdlQuery(11,latlng.lat,latlng.lng)]);
  if(seq!==bdlRequestSeq)return;
  const general=g.features?.[0]?.attributes||null;
  const species=s.features||[];
  if(!general){$('mapStatus').textContent='W tym miejscu nie znaleziono wydzielenia BDL.';return;}
  const popup=L.popup({maxWidth:360,closeButton:true}).setLatLng(latlng).setContent(bdlPopup(general,species));
  popup.openOn(map);
  $('mapStatus').textContent=`BDL: ${general.adress_forest||'wydzielenie'}`;
 }catch(e){
  console.warn(e);$('mapStatus').textContent='Nie udało się pobrać danych BDL. Sprawdź połączenie z internetem.';
 }finally{bdlBusy=false}
}
function startContinuousLocation(){if(!navigator.geolocation)return;watchId=navigator.geolocation.watchPosition(p=>{userPos=[p.coords.latitude,p.coords.longitude];renderMarkers()},()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:15000})}
function distMeters(a,b){const R=6371000,rad=Math.PI/180,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad;const x=Math.sin(dLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
async function prepareOfflineMap(){if(!map)return;const z0=Math.max(8,Math.floor(map.getZoom())-2),z1=Math.min(17,Math.floor(map.getZoom())+2),b=map.getBounds();let jobs=[];for(let z=z0;z<=z1;z++){const n=2**z,x1=Math.floor((b.getWest()+180)/360*n),x2=Math.floor((b.getEast()+180)/360*n),y1=Math.floor((1-Math.asinh(Math.tan(b.getNorth()*Math.PI/180))/Math.PI)/2*n),y2=Math.floor((1-Math.asinh(Math.tan(b.getSouth()*Math.PI/180))/Math.PI)/2*n);for(let x=x1;x<=x2;x++){const xx=((x%n)+n)%n;for(let y=y1;y<=y2;y++)if(y>=0&&y<n)jobs.push({z,x:xx,y})}}if(jobs.length>500)return alert(`Obszar za duży (${jobs.length} kafelków). Przybliż mapę.`);let done=0;for(const j of jobs){try{const u=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${j.z}/${j.y}/${j.x}`,r=await fetch(u);if(r.ok)await putCachedTile(`imagery/${j.z}/${j.x}/${j.y}`,await r.blob())}catch{}$('mapStatus').textContent=`Mapa offline: ${++done}/${jobs.length}`}alert('Gotowe. Przygotowano mapę offline dla widocznego obszaru.')}
function nestYears(n){const ys=new Set();(n.controls||[]).forEach(c=>{if(c&&c.date){const y=String(c.date).slice(0,4);if(/^\d{4}$/.test(y))ys.add(y)}});Object.keys(n.seasons||{}).forEach(y=>ys.add(String(y)));return [...ys]}
function nestHasYear(n,y){return nestYears(n).includes(String(y))}
function renderYearFilter(){const sel=$('yearFilter');if(!sel)return;const years=[...new Set(nests.flatMap(n=>nestYears(n)))].sort((a,b)=>b.localeCompare(a));sel.innerHTML='<option value="">Wszystkie lata</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');sel.value=filterYear}
function nestMatches(n){if(filterVisibility==='visible'&&n.hidden)return false;if(filterVisibility==='hidden'&&!n.hidden)return false;if(filterYear&&!nestHasYear(n,filterYear))return false;if(selectedSpeciesCodes.size&&!selectedSpeciesCodes.has(String(n.birdCode||'')))return false;const q=speciesQuery.trim().toLocaleLowerCase('pl-PL');if(!q)return true;return [n.bird,n.birdCode,n.label,n.id].some(v=>String(v??'').toLocaleLowerCase('pl-PL').includes(q))}
function renderMarkers(){if(!map)return;map.eachLayer(l=>{if(l instanceof L.Marker)map.removeLayer(l)});if(!markersVisible)return;nests.filter(n=>n.lat&&n.lon&&!n.hidden&&nestMatches(n)).forEach(n=>{const m=L.marker([n.lat,n.lon]).addTo(map);let tip=n.label||'gniazdo';m.bindTooltip(esc(tip),{permanent:true,direction:'top',className:'marker-label'});m.on('click',()=>openNest(n.id,false));})}
function renderSpeciesFilter(){const box=$('speciesFilterList');if(!box)return;const q=speciesQuery.trim();const mapSpecies=new Map();nests.forEach(n=>{const code=String(n.birdCode||''),name=String(n.bird||'');if(code||name)mapSpecies.set(code,{code,name})});const items=[...mapSpecies.values()].filter(x=>!q||(x.name+' '+x.code).toLocaleLowerCase('pl-PL').includes(q.toLocaleLowerCase('pl-PL'))).sort((a,b)=>a.name.localeCompare(b.name,'pl'));box.hidden=!q;box.innerHTML=q?(items.length?items.map(x=>`<label class="speciesFilterItem"><input type="checkbox" data-species-filter="${esc(x.code)}" ${selectedSpeciesCodes.has(x.code)?'checked':''}> ${esc(x.name||'bez nazwy')} — <span>${esc(x.code)}</span> <button type="button" data-show-species="${esc(x.code)}" class="secondary">Pokaż</button></label>`).join(''):'<div class="muted">Brak pasującego gatunku.</div>'):'';box.querySelectorAll('[data-species-filter]').forEach(cb=>cb.addEventListener('change',()=>{if(cb.checked)selectedSpeciesCodes.add(cb.dataset.speciesFilter);else selectedSpeciesCodes.delete(cb.dataset.speciesFilter);renderMarkers()}));box.querySelectorAll('[data-show-species]').forEach(b=>b.onclick=()=>{selectedSpeciesCodes.clear();selectedSpeciesCodes.add(b.dataset.showSpecies);$('menuPanel').hidden=true;renderMarkers()})}
function hasLegacySavedControl(n,i,c){
 if(!c)return false;
 if(c.saved===true)return true;
 const meaningful=!!(c.date||c.time||c.criterion||c.count||c.chicks||c.tree||c.treeCode||c.notes||(c.observations&&c.observations.length));
 if(!meaningful)return false;
 const seasons=n.seasons||{};
 for(const y of Object.keys(seasons)){const arr=seasons[y]||[];const snap=arr[i];if(snap&&((snap.date&&c.date&&snap.date===c.date)||(snap.time&&c.time&&snap.time===c.time)||snap.notes===c.notes))return true}
 return !!(c.date&&c.time);
}
function renderControl(){const n=nests.find(x=>x.id===currentNestId);if(!n)return;const c=n.controls[currentControl]||blankControl();if(!n.controls[currentControl])n.controls[currentControl]=c;const savedControl=!!c.saved||hasLegacySavedControl(n,currentControl,c);const displayDate=c.date||'';const displayTime=c.time||'';let html='';if(currentControl===0&&!n.bird){html+=`<label><strong>Nazwa gatunku</strong><div class="autocomplete"><input id="birdInput" placeholder="polska nazwa lub kod"><div id="birdSug" class="suggestions" hidden></div></div></label><div class="hint" id="birdHint">Wybierz gatunek z listy.</div>`}
 html+=`<div class="inlinePair emphFields"><label><strong>Liczebność</strong> <span class="hint">(opcjonalne)</span><select id="count"><option value="">Nie podano</option>${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${String(c.count)===String(i+1)?'selected':''}>${i+1}</option>`).join('')}</select></label><label><strong>Liczba piskląt</strong><select id="chicks"><option value="">Nie podano</option>${Array.from({length:21},(_,i)=>`<option value="${i}" ${String(c.chicks)===String(i)?'selected':''}>${i}</option>`).join('')}</select></label></div>`;
 html+=`<label class="emphField"><strong>Kryterium lęgowości</strong> <span class="hint">(opcjonalne)</span><select id="criterion"><option value="">Nie wybrano</option>${CRITERIA.map(x=>`<option value="${esc(x.code)}" ${x.code===c.criterion?'selected':''}>${esc(x.code)}</option>`).join('')}</select><div class="criterionDesc hint" id="criterionDesc">${c.criterion?esc((CRITERIA.find(x=>x.code===c.criterion)||{}).desc||''):'Wybierz kryterium, aby zobaczyć opis.'}</div></label>`;
 html+=`<label class="emphField"><strong>Obserwacje</strong> <button type="button" class="secondary obsPickerBtn" id="obsPickerBtn">Wybierz obserwacje</button><div class="selectedObs" id="selectedObs">${(c.observations||[]).length?c.observations.map(esc).join(', '):'Nie wybrano'}</div><div id="obsPicker" class="obsPicker" hidden><div class="obsPickerBox"><div class="obsPickerHead"><span>Wybierz obserwacje</span><button type="button" class="secondary" id="obsClose">Gotowe</button></div><div class="obsChoices">${OBS.map((x,i)=>`<label><input type="checkbox" data-obs="${i}" ${c.observations?.includes(x)?'checked':''}>${esc(x)}</label>`).join('')}</div></div></div></label>`;
 html+=`<label><strong>Drzewo</strong> <span class="hint">(opcjonalne)</span><div class="autocomplete"><input id="treeInput" placeholder="nazwa lub kod" value="${esc(c.tree||'')}"><div id="treeSug" class="suggestions" hidden></div></div></label><div class="hint strongLabel" id="treeHint">${c.treeCode?`Kod drzewa: ${esc(c.treeCode)}`:'Kod drzewa pojawi się po wyborze.'}</div>`;
 html+=`<div class="dateTimeRow"><input id="date" type="date" value="${esc(displayDate)}" readonly><input id="time" type="time" value="${esc(displayTime)}" readonly></div></label>`;
 const d=userPos&&n.lat?distMeters(userPos,[n.lat,n.lon]):null;html+=`<label><strong>Odległość</strong><input id="distanceValue" value="${d==null?'—':(d<1000?Math.round(d)+' m':(d/1000).toFixed(2)+' km')}" readonly></label>`;
 html+=`<label class="emphField"><strong>Uwagi</strong><textarea id="notes" rows="3">${esc(c.notes)}</textarea></label>`;
 $('controlPanel').innerHTML=html;bindInputs(n,c);editing=editing||!!n.draft||!savedControl;setEditable(editing);}
function hideMobileKeyboard(input){const a=input||document.activeElement;if(!a)return;try{a.setAttribute('readonly','readonly');a.blur();document.body.setAttribute('tabindex','-1');document.body.focus({preventScroll:true});}catch(e){try{a.blur()}catch(_){}}setTimeout(()=>{try{document.body.blur();document.activeElement?.blur?.()}catch(e){};a.removeAttribute('readonly')},700)}
function bindInputs(n,c){const crit=$('criterion'),desc=$('criterionDesc');crit.onchange=()=>{const x=CRITERIA.find(v=>v.code===crit.value);desc.textContent=x?x.desc:'Wybierz kryterium, aby zobaczyć opis.'};
 if(currentControl===0&&!n.bird){const input=$('birdInput'),box=$('birdSug');input.oninput=()=>{const q=input.value.toLocaleLowerCase('pl-PL').trim();const m=BIRDS.filter(x=>x.name.toLocaleLowerCase('pl-PL').includes(q)||x.code.toLocaleLowerCase('pl-PL').includes(q)).slice(0,25);box.innerHTML=m.map((x,i)=>`<div class="suggestion" data-i="${i}">${esc(x.name)} <span>${esc(x.code)}</span></div>`).join('');box.hidden=!m.length;box.querySelectorAll('.suggestion').forEach(el=>el.onclick=()=>{const x=m[+el.dataset.i];input.value=x.name;input.dataset.code=x.code;box.hidden=true;$('birdHint').textContent=`Kod gatunku: ${x.code}`;hideMobileKeyboard(input)})};input.onfocus=()=>input.dispatchEvent(new Event('input'))}
 const ob=$('obsPickerBtn'),modal=$('obsPicker');ob.onclick=()=>modal.hidden=false;$('obsClose').onclick=()=>modal.hidden=true;modal.querySelectorAll('[data-obs]').forEach(x=>x.onchange=()=>{$('selectedObs').textContent=[...modal.querySelectorAll('[data-obs]:checked')].map(x=>OBS[+x.dataset.obs]).join(', ')||'Nie wybrano'});
 const tree=$('treeInput'),tb=$('treeSug');tree.oninput=()=>{const q=tree.value.toLocaleLowerCase('pl-PL').trim(),m=TREES.filter(x=>x.name.toLocaleLowerCase('pl-PL').includes(q)||x.code.toLocaleLowerCase('pl-PL').includes(q)).slice(0,25);tb.innerHTML=m.map((x,i)=>`<div class="suggestion" data-i="${i}">${esc(x.name)} <span>${esc(x.code)}</span></div>`).join('');tb.hidden=!m.length;tb.querySelectorAll('.suggestion').forEach(el=>el.onclick=()=>{const x=m[+el.dataset.i];tree.value=x.name;tree.dataset.code=x.code;tb.hidden=true;$('treeHint').textContent=`Kod drzewa: ${x.code}`;hideMobileKeyboard(tree)})};
}
function setEditable(v){const n=nests.find(x=>x.id===currentNestId);const c=n?.controls?.[currentControl];const saved=!!c&& (c.saved===true||hasLegacySavedControl(n,currentControl,c));editing=saved?!(!v):true; if(saved && !v) editing=false; if(!saved) editing=true; const canEdit=editing;['birdInput','criterion','obsPickerBtn','treeInput','count','chicks','notes'].forEach(id=>{const e=$(id);if(e)e.disabled=!canEdit});const d=$('date'),t=$('time');if(d)d.readOnly=true;if(t)t.readOnly=true;const saveBtn=$('saveControl');if(saveBtn)saveBtn.hidden=!canEdit;const eb=$('editNestBtn');if(eb){eb.hidden=canEdit||!saved;eb.textContent=`✏️ Edytuj kontrolę ${currentControl+1}`}}
function saveCurrent(){const n=nests.find(x=>x.id===currentNestId);if(!n)return;const c=n.controls[currentControl]||blankControl();if(currentControl===0&&!n.bird){const q=$('birdInput')?.value.trim().toLocaleLowerCase('pl-PL'),b=BIRDS.find(x=>x.name.toLocaleLowerCase('pl-PL')===q||x.code.toLocaleLowerCase('pl-PL')===q);if(!b)return alert('Wybierz gatunek z listy.');n.bird=b.name;n.birdCode=b.code;n.number=n.number||nextNumber(b.code);n.label=`${b.code}-${n.number}`}
c.count=$('count').value;c.chicks=$('chicks').value;c.criterion=$('criterion').value;c.observations=[...document.querySelectorAll('[data-obs]:checked')].map(x=>OBS[+x.dataset.obs]);c.tree=$('treeInput').value.trim();const t=TREES.find(x=>x.name.toLocaleLowerCase('pl-PL')===c.tree.toLocaleLowerCase('pl-PL')||x.code.toLocaleLowerCase('pl-PL')===c.tree.toLocaleLowerCase('pl-PL'));c.treeCode=t?t.code:($('treeInput').dataset.code||'');const x=now();if(!c.saved){c.date=x.date;c.time=x.time}c.notes=$('notes').value;c.saved=true;n.controls[currentControl]=c;n.draft=false;n.seasons=n.seasons||{};const year=c.date.slice(0,4);n.seasons[year]=n.seasons[year]||[];n.seasons[year][currentControl]=JSON.parse(JSON.stringify(c));save();$('nestCode').textContent=n.label;editing=false;closeNest()}
function openNest(id){const n=nests.find(x=>x.id===id);if(!n)return;currentNestId=id;currentControl=0;editing=!!n.draft;$('nestCard').hidden=false;$('nestCode').textContent=n.label||'nie nadano';$('birdFixed').innerHTML=n.bird?`<strong>Gatunek: ${esc(n.bird)} (${esc(n.birdCode)})</strong>`:'Gatunek: jeszcze nie wybrano';$('nestVisibilityBtn').textContent='🙈 Ukryj gniazdo';$('nestVisibilityBtn').onclick=()=>{n.hidden=true;save();renderMarkers();closeNest()};$('editNestBtn').onclick=()=>{editing=true;renderControl()};$('deleteNestBtn').onclick=()=>{if(confirm('Usunąć to gniazdo wraz ze wszystkimi kontrolami?')){nests=nests.filter(x=>x.id!==id);save();closeNest()}};$('historyBtn').onclick=()=>renderHistory(n);renderTabs();renderControl();requestAnimationFrame(()=>{const card=$('nestCard');card.scrollIntoView({behavior:'smooth',block:'start'});const title=$('nestTitle');if(title)title.focus({preventScroll:true})})}
function renderHistory(n){const p=$('historyPanel');p.hidden=!p.hidden;if(p.hidden)return;const seasons=n.seasons||{};const years=Object.keys(seasons).sort((a,b)=>b.localeCompare(a));const val=v=>esc(v==null||v===''?'—':v);const obs=v=>(v||[]).length?esc(v.join(', ')):'—';const controls=arr=>[0,1,2,3].map(i=>{const c=arr[i]||blankControl();const crit=CRITERIA.find(x=>x.code===c.criterion);return `<div class="historyControl"><h4>Kontrola ${i+1}</h4><div><b>Data:</b> ${val(c.date)} &nbsp; <b>Czas:</b> ${val(c.time)}</div><div><b>Liczebność:</b> ${val(c.count)}</div><div><b>Liczba piskląt:</b> ${val(c.chicks)}</div><div><b>Kryterium lęgowości:</b> ${val(c.criterion)}</div><div class="historyDesc"><b>Opis kryterium:</b> ${val(crit&&crit.desc)}</div><div><b>Obserwacje:</b> ${obs(c.observations)}</div><div><b>Drzewo:</b> ${val(c.tree)}</div><div><b>Kod drzewa:</b> ${val(c.treeCode)}</div><div><b>Uwagi:</b> ${val(c.notes)}</div></div>`}).join('');p.innerHTML=years.length?`<h3>Historia gniazda ${esc(n.label)}</h3>`+years.map(y=>`<div class="historyYear"><button type="button" data-year="${y}">${y} ▸</button><div class="historyBody" data-body="${y}" hidden>${controls(seasons[y]||[])}</div></div>`).join(''):'<div class="muted">Brak zapisanej historii.</div>';p.querySelectorAll('[data-year]').forEach(b=>b.onclick=()=>{const body=p.querySelector(`[data-body="${b.dataset.year}"]`);body.hidden=!body.hidden;b.textContent=body.hidden?`${b.dataset.year} ▸`:`${b.dataset.year} ▾`})}
function renderTabs(){document.querySelectorAll('.tab').forEach((b,i)=>{b.classList.toggle('active',i===currentControl);b.onclick=()=>{currentControl=i;const n=nests.find(x=>x.id===currentNestId);const c=n?.controls?.[i]||blankControl();editing=!!n?.draft || !c.saved;renderTabs();renderControl()}})}
function cancelCurrentNest(){const n=nests.find(x=>x.id===currentNestId);if(!n)return;if(n.draft&&!n.bird){nests=nests.filter(x=>x.id!==currentNestId);save();$('mapMode').hidden=false;closeNest();return}editing=false;renderControl()}
function closeNest(){currentNestId=null;$('nestCard').hidden=true;$('historyPanel').hidden=true;renderMarkers();map.invalidateSize();window.scrollTo({top:0,behavior:'smooth'})}
function registerNest(){const c=map.getCenter(),id=crypto.randomUUID?crypto.randomUUID():String(Date.now());const n={id,lat:Number(c.lat.toFixed(6)),lon:Number(c.lng.toFixed(6)),bird:'',birdCode:'',label:'',number:'',controls:[blankControl(),blankControl(),blankControl(),blankControl()],seasons:{},draft:true};nests.push(n);save();currentNestId=id;$('mapMode').hidden=true;openNest(id);requestAnimationFrame(()=>{const card=$('nestCard');if(card){card.hidden=false;card.scrollIntoView({behavior:'smooth',block:'start'})}})}
function deleteVisibleNests(){const b=map.getBounds();const candidates=nests.filter(n=>n.lat&&n.lon&&b.contains([n.lat,n.lon])&&!n.hidden);if(!candidates.length)return alert('W widocznym fragmencie mapy nie ma widocznych gniazd.');if(!confirm(`Usunąć ${candidates.length} gniazd z widocznego fragmentu mapy? Tej operacji nie można cofnąć.`))return;nests=nests.filter(n=>!(n.lat&&n.lon&&b.contains([n.lat,n.lon])&&!n.hidden));save();renderMarkers();alert(`Usunięto ${candidates.length} gniazd.`)}
function countSpecies(){const box=$('speciesCountBox');if(!box)return;if(!box.hidden){box.hidden=true;return}const m={};nests.forEach(n=>{const k=n.bird||'bez gatunku';m[k]=(m[k]||0)+1});box.hidden=false;box.innerHTML=Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="speciesCountRow"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('')}
function getFilteredNests(){return nests.filter(n=>nestMatches(n))}
function csvEscape(v){return '"'+String(v??'').replaceAll('"','""')+'"'}
async function reverseGeocode(lat,lon){try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,{headers:{'Accept-Language':'pl'}});const j=await r.json(),a=j.address||{};return {miejscowosc:a.village||a.town||a.city||a.hamlet||'',gmina:a.municipality||a.city_district||'',wojewodztwo:a.state||''}}catch{return {miejscowosc:'',gmina:'',wojewodztwo:''}}}
async function fetchBDLExportData(n){
 try{
  const [g,s]=await Promise.all([bdlQuery(5,n.lat,n.lon),bdlQuery(11,n.lat,n.lon)]);
  const general=g.features?.[0]?.attributes||{};
  const species=(s.features||[]).map(x=>x.attributes||x).filter(x=>x.species_cd||x.species_age!=null);
  const dominant=species.slice().sort((a,b)=>(Number(b.part_cd)||0)-(Number(a.part_cd)||0))[0]||{};
  const address=bdlVal(general.adress_forest)==='—'?'':String(general.adress_forest||'');
  const parts=address.split('-').map(x=>x.trim()).filter(Boolean);
  return {
   bdlAddress:address,
   bdlCompartment:parts.length?parts[parts.length-1]:'',
   bdlAge:dominant.species_age!=null?dominant.species_age:'',
   bdlSpecies:dominant.species_cd||'',
   bdlTSL:general.site_type_cd||''
  };
 }catch{return {bdlAddress:'',bdlCompartment:'',bdlAge:'',bdlSpecies:'',bdlTSL:''}}
}
async function exportCSV(){
 const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));
 if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');
 const h=['kod_gniazda','gatunek','kod_gatunku','GPS_lat','GPS_lon','najblizsza_miejscowosc','gmina','wojewodztwo','BDL_adres_wydzielenia','BDL_numer_wydzielenia','BDL_wiek_drzewostanu','BDL_TSL'];
 for(let i=1;i<=4;i++)h.push(`K${i}_kryterium`,`K${i}_obserwacje`,`K${i}_liczebnosc`,`K${i}_liczba_pisklat`,`K${i}_drzewo`,`K${i}_kod_drzewa`,`K${i}_data`,`K${i}_czas`,`K${i}_uwagi`);
 const rows=[];
 for(const n of list){
  const [g,bdl]=await Promise.all([reverseGeocode(n.lat,n.lon),fetchBDLExportData(n)]);
  const r=[n.label,n.bird,n.birdCode,n.lat,n.lon,g.miejscowosc,g.gmina,g.wojewodztwo,bdl.bdlAddress,bdl.bdlCompartment,bdl.bdlAge,bdl.bdlTSL];
  for(let i=0;i<4;i++){const c=n.controls[i]||blankControl();r.push(c.criterion,(c.observations||[]).join(' | '),c.count,c.chicks,c.tree,c.treeCode,c.date,c.time,c.notes)}
  rows.push(r)
 }
 const csv='\uFEFF'+[h,...rows].map(r=>r.map(csvEscape).join(';')).join('\n');
 downloadBlob(csv,'NestMap.csv','text/csv;charset=utf-8')
}
function exportGeoJSON(){const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));return {type:'FeatureCollection',features:list.map(n=>({type:'Feature',geometry:{type:'Point',coordinates:[n.lon,n.lat]},properties:{kod:n.label,gatunek:n.bird,kod_gatunku:n.birdCode,rok:nestYears(n).join(',')}}))}}
function kmzValue(v){return v==null||v===''?'—':String(v)}
function kmzControlHtml(c,i){const obs=(c.observations||[]).join(', ');return `<h3>Kontrola ${i+1}</h3><table><tr><td>Data</td><td>${esc(kmzValue(c.date))}</td></tr><tr><td>Czas</td><td>${esc(kmzValue(c.time))}</td></tr><tr><td>Kryterium lęgowości</td><td>${esc(kmzValue(c.criterion))}</td></tr><tr><td>Obserwacje</td><td>${esc(kmzValue(obs))}</td></tr><tr><td>Liczebność</td><td>${esc(kmzValue(c.count))}</td></tr><tr><td>Liczba piskląt</td><td>${esc(kmzValue(c.chicks))}</td></tr><tr><td>Drzewo</td><td>${esc(kmzValue(c.tree))}</td></tr><tr><td>Kod drzewa</td><td>${esc(kmzValue(c.treeCode))}</td></tr><tr><td>Uwagi</td><td>${esc(kmzValue(c.notes))}</td></tr></table>`}
function exportKMZ(){const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');const k=list.map(n=>{const controls=(n.controls||[blankControl(),blankControl(),blankControl(),blankControl()]).map((c,i)=>kmzControlHtml(c||blankControl(),i)).join('');const desc=`<![CDATA[<div><h2>NestMap — ${esc(n.label||'gniazdo')}</h2><p><b>Gatunek:</b> ${esc(kmzValue(n.bird))}<br><b>Kod gatunku:</b> ${esc(kmzValue(n.birdCode))}<br><b>Numer:</b> ${esc(kmzValue(n.number))}<br><b>GPS:</b> ${esc(kmzValue(n.lat))}, ${esc(kmzValue(n.lon))}</p>${controls}</div>]]>`;return `<Placemark><name>${esc(n.label||'gniazdo')}</name><description>${desc}</description><Point><coordinates>${Number(n.lon)},${Number(n.lat)},0</coordinates></Point></Placemark>`}).join('');const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>NestMap</name>${k}</Document></kml>`;const zip=zipStore([{name:'doc.kml',data:new TextEncoder().encode(kml)}]);downloadBlob(zip,'NestMap.kmz','application/vnd.google-earth.kmz')}
function u16le(v){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);return a}function u32le(v){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v>>>0,true);return a}function f64le(v){const a=new Uint8Array(8);new DataView(a.buffer).setFloat64(0,v,true);return a}function u32be(v){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v>>>0,false);return a}function ascii(s,n){const a=new Uint8Array(n);const b=new TextEncoder().encode(String(s??''));a.set(b.slice(0,n));return a}function concatBytes(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length}return o}function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}function zipStore(files){const parts=[],central=[];let offset=0;for(const f of files){const name=ascii(f.name,f.name.length),d=f.data,crc=crc32(d),lh=concatBytes(u32le(0x04034b50),u16le(20),u16le(0),u16le(0),u16le(0),u16le(0),u32le(crc),u32le(d.length),u32le(d.length),u16le(name.length),u16le(0),name,d);parts.push(lh);central.push(concatBytes(u32le(0x02014b50),u16le(20),u16le(20),u16le(0),u16le(0),u16le(0),u16le(0),u32le(crc),u32le(d.length),u32le(d.length),u16le(name.length),u16le(0),u16le(0),u16le(0),u16le(0),u32le(0),u32le(offset),name));offset+=lh.length}const cd=concatBytes(...central),body=concatBytes(...parts),end=concatBytes(u32le(0x06054b50),u16le(0),u16le(0),u16le(files.length),u16le(files.length),u32le(cd.length),u32le(body.length),u16le(0));return concatBytes(body,cd,end)}
function dbfField(name,type,len,dec=0){return concatBytes(ascii(name,11),ascii(type,1),new Uint8Array(4),new Uint8Array([len,dec]),new Uint8Array(14))}function dbfText(v,len){const a=new TextEncoder().encode(String(v??'')),o=new Uint8Array(len);o.fill(32);o.set(a.slice(0,len));return o}
function buildShapefile(list,bdlDataMap={}){
 const n=list.length;if(!n)return null;
 const bb=list.reduce((b,x)=>[Math.min(b[0],x.lon),Math.min(b[1],x.lat),Math.max(b[2],x.lon),Math.max(b[3],x.lat)],[Infinity,Infinity,-Infinity,-Infinity]);
 const shpLen=100+n*28,shxLen=100+n*8;
 const header=len=>concatBytes(u32be(9994),new Uint8Array(20),u32be(len/2),u32le(1000),u32le(1),f64le(bb[0]),f64le(bb[1]),f64le(bb[2]),f64le(bb[3]),new Uint8Array(32));
 const shp=[header(shpLen)],shx=[header(shxLen)];let off=50;
 list.forEach((x,i)=>{shp.push(u32be(i+1),u32be(10),u32le(1),f64le(Number(x.lon)),f64le(Number(x.lat)));shx.push(u32be(off),u32be(10));off+=14});
 const fields=[
  ['KOD_GNIAZD','C',30,0],['GATUNEK','C',60,0],['KOD_GAT','C',10,0],['GPS_LAT','N',18,6],['GPS_LON','N',18,6],
  ['MIEJSC','C',80,0],['GMINA','C',80,0],['WOJEW','C',60,0],['BDL_ADRES','C',25,0],['BDL_WYDZ','C',12,0],['BDL_WIEK','N',6,0],['BDL_TSL','C',7,0]
 ];
 for(let i=1;i<=4;i++) fields.push([`K${i}_KRYT`,'C',20,0],[`K${i}_OBS`,'C',254,0],[`K${i}_LICZ`,'C',20,0],[`K${i}_PISKL`,'C',20,0],[`K${i}_DRZEWO`,'C',60,0],[`K${i}_KODDRZ`,'C',15,0],[`K${i}_DATA`,'C',12,0],[`K${i}_CZAS`,'C',8,0],[`K${i}_UWAGI`,'C',254,0]);
 const hlen=32+fields.length*32+1,rlen=1+fields.reduce((a,f)=>a+f[2],0),dbf=new Uint8Array(hlen+n*rlen);dbf.fill(32);dbf[0]=3;
 const d=new Date();dbf[1]=d.getFullYear()-1900;dbf[2]=d.getMonth()+1;dbf[3]=d.getDate();
 const dv=new DataView(dbf.buffer);dv.setUint32(4,n,true);dv.setUint16(8,hlen,true);dv.setUint16(10,rlen,true);
 let fp=32;for(const f of fields){dbf.set(dbfField(...f),fp);fp+=32}dbf[fp]=13;
 for(let i=0;i<n;i++){
  const x=list[i],b=bdlDataMap[x.id]||{},row=hlen+i*rlen;dbf[row]=32;let q=row+1;
  const vals=[x.label,x.bird,x.birdCode,Number(x.lat).toFixed(6),Number(x.lon).toFixed(6),x._exportPlace||'',x._exportGmina||'',x._exportWoj||'',b.bdlAddress||'',b.bdlCompartment||'',b.bdlAge??'',b.bdlTSL||''];
  for(let cidx=0;cidx<4;cidx++){const c=x.controls[cidx]||blankControl();vals.push(c.criterion||'',(c.observations||[]).join(' | '),c.count??'',c.chicks??'',c.tree||'',c.treeCode||'',c.date||'',c.time||'',c.notes||'')}
  for(let j=0;j<fields.length;j++){dbf.set(dbfText(vals[j],fields[j][2]),q);q+=fields[j][2]}
 }
 dbf[dbf.length-1]=26;
 const prj=new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]');
 return [{name:'NestMap.shp',data:concatBytes(...shp)},{name:'NestMap.shx',data:concatBytes(...shx)},{name:'NestMap.dbf',data:dbf},{name:'NestMap.prj',data:prj}]
}
async function exportSHP(){
 const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));
 if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');
 $('mapStatus').textContent='Przygotowuję dane do SHP…';
 const bdlDataMap={};
 for(const n of list)bdlDataMap[n.id]=await fetchBDLExportData(n);
 for(const n of list){try{const g=await reverseGeocode(n.lat,n.lon);n._exportPlace=g.miejscowosc||'';n._exportGmina=g.gmina||'';n._exportWoj=g.wojewodztwo||''}catch{n._exportPlace='';n._exportGmina='';n._exportWoj=''}}
 const files=buildShapefile(list,bdlDataMap);list.forEach(n=>{delete n._exportPlace;delete n._exportGmina;delete n._exportWoj});
 if(!files)return alert('Brak gniazd spełniających wybrane filtry.');
 $('mapStatus').textContent='';downloadBlob(zipStore(files),'NestMap_SHP.zip','application/zip')
}
function downloadBlob(data,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function applyAreaExport(){window.__nmExportBounds=map.getBounds();alert('Ustawiono eksport dla obecnie widocznego fragmentu mapy. CSV, KMZ i SHP będą ograniczone do tego obszaru.')}
$('menuBtn').onclick=()=>{$('menuPanel').hidden=false};$('closeMenu').onclick=()=>{$('menuPanel').hidden=true};$('mapTypeBtn').onclick=()=>{const b=$('mapTypeBtn');if(map.hasLayer(window.__nmImagery)){map.removeLayer(window.__nmImagery);window.__nmStreets.addTo(map);b.textContent='🗺️ Mapa ulic'}else{map.removeLayer(window.__nmStreets);window.__nmImagery.addTo(map);b.textContent='🛰️ Ortofotomapa'}};$('bdlBtn').onclick=toggleBDL;$('locateBtn').onclick=locatePhone;$('offlineBtn').onclick=prepareOfflineMap;$('registerBtn').onclick=registerNest;$('closeNest').onclick=closeNest;$('saveControl').onclick=saveCurrent;$('cancelNest').onclick=cancelCurrentNest;$('exportCsv').onclick=exportCSV;$('exportKmz').onclick=exportKMZ;$('exportShp').onclick=exportSHP;$('exportCurrentArea').onclick=applyAreaExport;$('deleteVisibleBtn').onclick=deleteVisibleNests;$('countSpeciesBtn').onclick=countSpecies;$('toggleNestsBtn').onclick=()=>{markersVisible=false;renderMarkers()};$('revealNestsBtn').onclick=()=>{markersVisible=true;nests.forEach(n=>n.hidden=false);save();renderMarkers();if(currentNestId){const b=$('nestVisibilityBtn');if(b)b.textContent='🙈 Ukryj gniazdo'}};$('nestSearch').oninput=e=>{speciesQuery=e.target.value;renderSpeciesFilter();renderMarkers()};$('showAllNests').onclick=()=>{$('nestSearch').value='';speciesQuery='';selectedSpeciesCodes.clear();filterYear='';renderYearFilter();renderSpeciesFilter();renderMarkers()};$('clearNestFilter').onclick=()=>{$('nestSearch').value='';speciesQuery='';selectedSpeciesCodes.clear();filterYear='';renderYearFilter();renderSpeciesFilter();renderMarkers()};if($('yearFilter'))$('yearFilter').onchange=e=>{filterYear=e.target.value;renderMarkers()};
initMap();startContinuousLocation();renderYearFilter();renderSpeciesFilter();
