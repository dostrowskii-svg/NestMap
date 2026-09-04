const $=id=>document.getElementById(id);
const STORAGE='nestmap-nests-v5';
const OBS=['para','zaniepokojone dorosłe','dorosły noszący materiał gniazdowy','ptak latający w pobliżu gniazda','krążący ptak','ptak zlatujący z gniazda','dorosłe ze skorupkami jaj','dorosły z pokarmem','inkubacja','pisklęta w gnieździe','świeże gałązki','napuszone gniazdo','puch na gnieździe','pióra na gnieździe','pióra pod drzewem','odchody','skorupki jaj','wypluwki','ofiary w okolicy gniazda','brak śladów użytkowania','nocujące ptaki na lub przy gnieździe'];
let nests=JSON.parse(localStorage.getItem(STORAGE)||'[]').filter(n=>!n?.draft);
save();
let map,nestMarkerLayer=null,currentNestId=null,currentControl=0,markersVisible=true,speciesQuery='',selectedSpeciesCodes=new Set(),filterVisibility='all',filterYear='',editing=false,watchId=null,userPos=null,bdlEnabled=false,bdlLayer=null,bdlForestWms=null,bdlWmtsLayer=null,bdlBoundaryLayer=null,bdlCompartmentBoundaryLayer=null,bdlSubareaBoundaryLayer=null,bdlBusy=false,bdlRequestSeq=0,bdlInfoPanel=null,bdlVectorLayer=null,bdlLabelLayer=null,bdlLabelsVisible=true,bdlVectorBusy=false,bdlVectorSeq=0,baseMapMode='imagery';
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
 nestMarkerLayer=L.layerGroup().addTo(map);
 const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,maxNativeZoom:19,tileSize:256,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true,crossOrigin:true,attribution:'Tiles © Esri'}).addTo(map); window.__nmImagery=imagery;
 const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true,attribution:'© OpenStreetMap'}); window.__nmStreets=streets;
 const bdlWms='https://mapserver.bdl.lasy.gov.pl/arcgis/services/WMS_BDL_mapa_drzewostanow/MapServer/WMSServer';
 // IMPORTANT: use BDL's official WMTS mobile forest-stand map. It is the same
 // pre-rendered thematic map used for the mBDL-style display, including the
 // coloured stand polygons, compartment labels and subarea labels at their
 // intended scales. The previous WMS overlay rendered only outlines in Safari.
 const bdlWmts='https://mapserver.bdl.lasy.gov.pl/arcgis/rest/services/WMTS_BDL_mapa_drzewostanow/MapServer/tile/{z}/{y}/{x}';
 bdlWmtsLayer=L.tileLayer(bdlWmts,{minZoom:6,maxZoom:19,minNativeZoom:6,maxNativeZoom:17,tileSize:256,opacity:1,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true,crossOrigin:true,attribution:'BDL · Lasy Państwowe'}).setZIndex(400);
 // Official BDL WMS is used only for the permanent labels/boundaries above the coloured WMTS.
 bdlForestWms=L.tileLayer.wms(bdlWms,{layers:'11',styles:'',format:'image/png',transparent:true,version:'1.3.0',opacity:1,tileSize:256,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:true}).setZIndex(450);
 bdlCompartmentBoundaryLayer=null;
 bdlSubareaBoundaryLayer=null;
 // Keep a group variable for compatibility with the rest of the app.
 bdlLayer=L.layerGroup([bdlWmtsLayer]).setZIndex(200);
 bdlBoundaryLayer=bdlCompartmentBoundaryLayer;
 const cross=document.createElement('div');cross.className='crosshair';cross.textContent='＋';$('map').appendChild(cross);
 map.on('load moveend zoomend',()=>{setTimeout(()=>map.invalidateSize(false),50);if(bdlEnabled){setBDLBoundaryLayer();refreshBDLVectorOverlay();}});
 map.on('click',e=>{if(bdlEnabled)showBDLAtPoint(e.latlng)});
 setTimeout(()=>map.invalidateSize(true),300);
 if(navigator.geolocation&&!nests.length) navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],15),()=>{},{enableHighAccuracy:true,timeout:8000,maximumAge:60000});
 renderMarkers();
}
function locatePhone(){if(!window.isSecureContext||!navigator.geolocation)return alert('Lokalizacja jest niedostępna. Otwórz NestMap przez https://dostrowskii-svg.github.io/NestMap/.');$('mapStatus').textContent='Pobieram dokładną lokalizację telefonu…';let done=false;const apply=p=>{if(done)return;done=true;userPos=[p.coords.latitude,p.coords.longitude];map.setView(userPos,17,{animate:true});$('mapStatus').textContent='Mapa ustawiona na lokalizacji telefonu.';renderMarkers()};const fail=e=>{if(done)return;let msg='Nie udało się pobrać lokalizacji telefonu.';if(e&&e.code===1)msg='Safari nie udostępniło lokalizacji. Sprawdź: Ustawienia → Prywatność i ochrona → Usługi lokalizacji → Witryny Safari → „Gdy używam aplikacji”.';else if(e&&e.code===2)msg='Telefon nie może teraz ustalić pozycji. Wyjdź na otwartą przestrzeń i spróbuj ponownie.';else if(e&&e.code===3)msg='Pobieranie lokalizacji trwało zbyt długo. Spróbuj ponownie.';$('mapStatus').textContent=msg;alert(msg)};navigator.geolocation.getCurrentPosition(apply,fail,{enableHighAccuracy:true,timeout:20000,maximumAge:0})}
function closeBDLInfo(){if(bdlInfoPanel){bdlInfoPanel.remove();bdlInfoPanel=null}$('mapStatus').textContent=bdlEnabled?'Drzewostany BDL są dostępne online. Kliknij wydzielenie, aby zobaczyć opis.':'Przesuń mapę tak, aby krzyżyk wskazywał miejsce gniazda.'}
function ensureBDLInfoPanel(){
 if(bdlInfoPanel)return bdlInfoPanel;
 const el=document.createElement('div');
 el.id='bdlInfoPanel';el.className='bdlInfoPanel';el.hidden=true;
 $('map').appendChild(el);bdlInfoPanel=el;
 // On iPhone/Safari Leaflet can treat a vertical finger gesture inside the
 // panel as map panning. Stop only the map gesture; the panel keeps scrolling.
 ['touchstart','touchmove','touchend','touchcancel','wheel'].forEach(type=>el.addEventListener(type,e=>e.stopPropagation(),{passive:type!=='wheel'}));
 return el;
}
function toggleBDL(){
 if(!bdlLayer)return;
 bdlEnabled=!bdlEnabled;
 const btn=$('bdlBtn');
 if(bdlEnabled){
   if(map.hasLayer(window.__nmImagery))map.removeLayer(window.__nmImagery);
   if(map.hasLayer(window.__nmStreets))map.removeLayer(window.__nmStreets);
   bdlLayer.addTo(map);
   setBDLBoundaryLayer();
   if(btn){btn.classList.add('active');btn.textContent='🌲 Drzewostany BDL ✓'}
   $('mapStatus').textContent='Drzewostany BDL są dostępne online. Kliknij wydzielenie, aby zobaczyć opis.';
   ensureBDLInfoPanel();refreshBDLVectorOverlay();
 }else{
   if(bdlWmtsLayer&&map.hasLayer(bdlWmtsLayer))map.removeLayer(bdlWmtsLayer);
   if(bdlForestWms&&map.hasLayer(bdlForestWms))map.removeLayer(bdlForestWms);
   if(bdlLayer&&map.hasLayer(bdlLayer))map.removeLayer(bdlLayer);
   if(bdlCompartmentBoundaryLayer&&map.hasLayer(bdlCompartmentBoundaryLayer))map.removeLayer(bdlCompartmentBoundaryLayer);if(bdlSubareaBoundaryLayer&&map.hasLayer(bdlSubareaBoundaryLayer))map.removeLayer(bdlSubareaBoundaryLayer);
   closeBDLInfo();
   if(baseMapMode==='streets')window.__nmStreets.addTo(map);else window.__nmImagery.addTo(map);
   if(btn){btn.classList.remove('active');btn.textContent='🌲 Drzewostany BDL'}
   if(bdlVectorLayer){map.removeLayer(bdlVectorLayer);bdlVectorLayer=null}
   if(bdlLabelLayer){map.removeLayer(bdlLabelLayer);bdlLabelLayer=null}
   $('mapStatus').textContent='Przesuń mapę tak, aby krzyżyk wskazywał miejsce gniazda.';
 }
}
const BDL_VECTOR_URL='https://mapserver.bdl.lasy.gov.pl/arcgis/rest/services/Mobile/Opis_taksacyjny_mBDL/MapServer/0/query';
function geometryCenter(g){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 const walk=v=>{if(!Array.isArray(v))return;if(typeof v[0]==='number'){minX=Math.min(minX,v[0]);maxX=Math.max(maxX,v[0]);minY=Math.min(minY,v[1]);maxY=Math.max(maxY,v[1]);return}v.forEach(walk)};walk(g?.rings||g?.paths||[]);
 return isFinite(minX)?[(minY+maxY)/2,(minX+maxX)/2]:null;
}
function bdlVectorLabel(p,zoom){
 const a=String(p.adress_forest||'').split('-');
 const sub=a.length>=2 ? `${a[a.length-2]}-${a[a.length-1]}` : (p.subarea_cd||'');
 const comp=p.compartment_cd||'';
 if(zoom<14) return comp || (a.length>=3 ? a[a.length-3] : '');
 const sp=p.species_cd_d||p.species_cd||'';
 const age=p.species_age??'';
 return [sub,[sp,age].filter(v=>v!==''&&v!=null).join('')].filter(Boolean).join(' ');
}
function bdlQueryUrl(layerId, params){
 return `https://mapserver.bdl.lasy.gov.pl/arcgis/rest/services/WMS_BDL_mapa_drzewostanow/MapServer/${layerId}/query?${params}`;
}
function setBDLBoundaryLayer(){
 if(!bdlEnabled||!map)return;
 // The coloured WMTS is the map background. The official WMS layers 3 and 5
 // are a transparent label overlay: 3 = compartments, 5 = subarea labels.
 // They must never replace/remove the coloured WMTS.
 if(bdlWmtsLayer&&!map.hasLayer(bdlWmtsLayer))bdlWmtsLayer.addTo(map);
 if(bdlForestWms){
   bdlForestWms.setParams({layers:'3,5',styles:'',transparent:true,format:'image/png'},false);
   if(!map.hasLayer(bdlForestWms))bdlForestWms.addTo(map);
 }
 if(bdlLabelLayer&&map.hasLayer(bdlLabelLayer))map.removeLayer(bdlLabelLayer);
}

async function refreshBDLVectorOverlay(){
 // Labels and boundaries are rendered by the official BDL WMS layers.
 // Keeping a second client-side vector copy caused missing/duplicate labels
 // in Safari and was unnecessary for map display.
 if(bdlVectorLayer&&map&&map.hasLayer(bdlVectorLayer))map.removeLayer(bdlVectorLayer);
 if(bdlLabelLayer&&map&&map.hasLayer(bdlLabelLayer))map.removeLayer(bdlLabelLayer);
 bdlVectorLayer=null; bdlLabelLayer=null;
}

function bdlFeatureAttributes(f){return f?.attributes||f?.properties||{}}
function showBDLFeature(f,latlng){showBDLAtPoint(latlng)}
function parseBDLSpeciesDescription(raw){
 const text=String(raw??'').replace(/<br\s*\/?>(?=)/gi,'\n').replace(/<[^>]*>/g,' ').replace(/\r/g,'').trim();
 if(!text)return [];
 const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
 const rows=[];
 const add=(layer,species,part='',age='',d13='',h='',bon='',zas='',extra='')=>{
   species=clean(species); if(!species)return;
   rows.push({layer:clean(layer).toUpperCase(),speciesCode:species,part:clean(part),age:clean(age),d13:clean(d13),h:clean(h),bon:clean(bon),zas:clean(zas),extra:clean(extra)});
 };
 const field=(seg,names,nextNames)=>{
   const n=names.join('|'), next=nextNames.join('|');
   const lookahead=next?`(?=\\s+(?:${next})\\s*[:=]|$)`:'$';
   const re=new RegExp(`(?:${n})\\s*[:=]\\s*(.*?)${lookahead}`,'i');
   const m=seg.match(re); return m?clean(m[1]):'';
 };
 // 1) Human-readable BDL form, one species per line/semicolon.
 const lines=text.replace(/;/g,'\n').split(/\n+/).map(clean).filter(Boolean);
 for(const line of lines){
   if(!/\bWarstwa\s*[:=]/i.test(line) || !/\bGatunek\s*[:=]/i.test(line))continue;
   const layer=field(line,['Warstwa'],['Gatunek','Udział','Udz','Wiek','D13','H','Bonitacja','Zasobność']);
   const species=field(line,['Gatunek','Kod gatunku'],['Udział','Udz','Wiek','D13','H','Bonitacja','Zasobność']);
   if(species)add(layer,species,field(line,['Udział','Udz'],['Wiek','D13','H','Bonitacja','Zasobność']),field(line,['Wiek'],['D13','H','Bonitacja','Zasobność']),field(line,['D13','Pierśnica'],['H','Bonitacja','Zasobność']),field(line,['H','Wysokość'],['Bonitacja','Zasobność']),field(line,['Bonitacja','Bon'],['Zasobność']),field(line,['Zasobność','Zapas'],[]));
 }
 if(rows.length)return rows;

 // 2) Compact mBDL form. The real service returns the complete composition
 // in storey_species_desc. A layer is followed by several species records;
 // each record may omit fields, so we delimit records by known forestry
 // species codes instead of assuming every record has 6 values.
 const codes=(typeof TREES!=='undefined'?TREES.map(x=>x.code):[]).concat([
   'SO','DB','DB.B','DB.C','MD','DG','ŚW','GB','BRZ','OL','JS','AK','OS','TP','JD','BK','WZ','KL','JR','KP','LP','KS','TB','SO.C','SO. C','DB.C','DB.B','DB.CZ','OLSZ','LIP','JAW','LESZ','LSZ','JB','OS','WB','WB.','IWA','OL.S','BRZ','ŚW','SO','DB','MD','DG'
 ]);
 const unique=[...new Set(codes.map(x=>String(x).trim().toUpperCase()).filter(Boolean))].sort((a,b)=>b.length-a.length);
 const codeRe=new RegExp(`(?<![A-ZĄĆĘŁŃÓŚŹŻ])(${unique.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?![A-ZĄĆĘŁŃÓŚŹŻ])`,'gi');
 const layerRe=/\b(DRZEW|PODSZ|PODS|NAL|PRZESTR|PRZESTRZENNA)\b/gi;
 const layerHits=[...text.matchAll(layerRe)];
 const chunks=layerHits.length?layerHits.map((h,i)=>({layer:h[1],text:text.slice(h.index+h[0].length,layerHits[i+1]?.index??text.length)})):[{layer:'',text:text}];
 for(const ch of chunks){
   let seg=clean(ch.text).replace(/^[\s:;,|\-]+/,'');
   if(!seg)continue;
   // If this chunk contains explicit labels, use the labelled parser above.
   if(/\bGatunek\s*[:=]/i.test(seg)){
     const species=field(seg,['Gatunek','Kod gatunku'],['Udział','Udz','Wiek','D13','H','Bonitacja','Zasobność']);
     if(species)add(ch.layer,species,field(seg,['Udział','Udz'],['Wiek','D13','H','Bonitacja','Zasobność']),field(seg,['Wiek'],['D13','H','Bonitacja','Zasobność']),field(seg,['D13','Pierśnica'],['H','Bonitacja','Zasobność']),field(seg,['H','Wysokość'],['Bonitacja','Zasobność']),field(seg,['Bonitacja','Bon'],['Zasobność']),field(seg,['Zasobność','Zapas'],[]));
     continue;
   }
   const hits=[...seg.matchAll(codeRe)];
   if(!hits.length)continue;
   for(let i=0;i<hits.length;i++){
     const code=hits[i][1];
     const tail=seg.slice(hits[i].index+hits[i][0].length,hits[i+1]?.index??seg.length);
     const vals=clean(tail).replace(/^[\s:;,|()\[\]\-]+|[\s:;,|()\[\]\-]+$/g,'').split(/[\s,;|:/()\[\]]+/).filter(Boolean);
     // Standard BDL order: udział, wiek, D13, H, bonitacja, zasobność.
     add(ch.layer,code,vals[0]||'',vals[1]||'',vals[2]||'',vals[3]||'',vals[4]||'',vals[5]||'');
   }
 }
 return rows;
}

function bdlPopupHtml(g,species){
 const a=g||{}, val=bdlVal, row=(label,v)=>`<div class="bdlRow"><span>${esc(label)}</span><b>${esc(val(v))}</b></div>`;
 const general=[row('Adres leśny',a.adress_forest),row('Forma własności',a.owner_cat_name),row('RDLP',a.region_name),row('Nadleśnictwo',a.inspectorate_name),row('Obręb',a.forest_dist_name),row('Leśnictwo',a.forest_range_name),row('Województwo',a.county_name),row('Powiat',a.district_name),row('Gmina',a.municipality_name),row('Obręb ewidencyjny',a.community_name),row('Oddział i wydzielenie',[a.compartment_cd,a.subarea_cd].filter(Boolean).join('')),row('Stan na rok',a.a_year)].join('');
 const dane=[row('Powierzchnia (ha)',a.sub_area),row('Gospodarstwo',a.silviculture_cd),row('Wiek rębności',a.rotation_age),row('Rodzaj powierzchni',a.area_type_cd),row('Budowa pionowa',a.stand_struct_cd),row('TSL',a.site_type_cd),row('Stopień degradacji',a.degradation_cd),row('Uwodnienie',a.moisture_name),row('Typ gleby',a.soil_subtype_cd),row('Pokrywa',a.veg_cover_name),row('Zespół roślinny',a.plant_comm_name),row('Kategoria ochronności',a.prot_category_name),row('Funkcja lasu',a.forest_func_name),row('Siedlisko przyrodnicze',a.arod_prot_site_desc),row('Przyczyna uszkodzenia',a.cause_cd),row('Procent uszkodzenia',a.damage_degree)].join('');
 let speciesHtml='';
 const parsed=Array.isArray(species)?species:[];
 if(parsed.length){
   speciesHtml=parsed.map(x=>`<div class="bdlSpeciesBlock"><div class="bdlRows">${row('Warstwa',x.layer||'—')}${row('Gatunek',x.speciesCode)}${row('Udział',x.part)}${row('Wiek',x.age)}${row('D13',x.d13)}${row('H',x.h)}${row('Bonitacja',x.bon)}${row('Zasobność',x.zas)}</div></div>`).join('');
 }else{
   const mainSpecies=a.species_cd||'';
   if(mainSpecies || a.species_age!==null && a.species_age!==undefined){
     speciesHtml=`<div class="bdlSpeciesBlock"><div class="bdlRows">${row('Warstwa','DRZEW')}${row('Gatunek główny',mainSpecies)}${row('Wiek',a.species_age)}</div></div>`;
   }
 }
 if(!speciesHtml)speciesHtml='<div class="muted">Brak danych o gatunkach.</div>';
 const section=(title,id,body,open)=>`<button type="button" class="bdlSectionTitle bdlSectionToggle" data-bdl-section="${id}" aria-expanded="${open?'true':'false'}">${title}<span class="bdlChevron">${open?'▾':'▸'}</span></button><div id="${id}" class="bdlSectionBody" ${open?'':'hidden'}>${body}</div>`;
 return `<div class="bdlPanelHead"><h3>Opis taksacyjny</h3><button type="button" class="bdlClose" aria-label="Zamknij opis">×</button></div>${section('ADRES','bdlAdresBody',`<div class="bdlRows">${general}</div>`,true)}${section('DANE OGÓLNE','bdlDaneBody',`<div class="bdlRows">${dane}</div>`,false)}${section('DRZEWA','bdlGatunkiBody',speciesHtml,false)}<div class="bdlSource">Źródło: Bank Danych o Lasach · dane online</div>`;
}
function showBDLInfo(g,species){const p=ensureBDLInfoPanel();p.innerHTML=bdlPopupHtml(g,species);p.hidden=false;const c=p.querySelector('.bdlClose');if(c)c.onclick=e=>{e.stopPropagation();closeBDLInfo()};p.querySelectorAll('.bdlSectionToggle').forEach(b=>b.onclick=e=>{e.stopPropagation();const body=p.querySelector('#'+b.dataset.bdlSection);if(!body)return;const open=body.hidden;body.hidden=!open;b.setAttribute('aria-expanded',String(open));const ch=b.querySelector('.bdlChevron');if(ch)ch.textContent=open?'▾':'▸'});p.onclick=e=>e.stopPropagation();}
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
function bdlPopup(g,species){return bdlPopupHtml(g,species)}
async function showBDLAtPoint(latlng){
 if(!bdlEnabled||bdlBusy)return;
 const seq=++bdlRequestSeq;bdlBusy=true;$('mapStatus').textContent='Pobieram opis wydzielenia z BDL…';
 try{
  const p=new URLSearchParams({
   where:'1=1',
   geometry:`${latlng.lng},${latlng.lat}`,
   geometryType:'esriGeometryPoint',
   inSR:'4326',
   spatialRel:'esriSpatialRelIntersects',
   distance:'25',
   units:'esriSRUnit_Meter',
   outFields:'*',
   returnGeometry:'false',
   resultRecordCount:'1',
   f:'json'
  });
  const r=await fetch(`${BDL_VECTOR_URL}?${p}`,{cache:'no-store'});
  if(!r.ok)throw new Error('BDL HTTP');
  const j=await r.json(); if(seq!==bdlRequestSeq)return;
  const general=j.features?.[0]?.attributes||null;
  if(!general){$('mapStatus').textContent='W tym miejscu nie znaleziono wydzielenia BDL.';closeBDLInfo();return}

  // The mBDL description layer contains the complete species composition
  // in storey_species_desc. Parse it for the vertical DRZEW/PODSZ/NAL list.
  const species=parseBDLSpeciesDescription(general.storey_species_desc||'');

  if(seq!==bdlRequestSeq)return;
  showBDLInfo(general,species);
  $('mapStatus').textContent=`BDL: ${general.adress_forest||'wydzielenie'}`;
 }catch(e){console.warn(e);$('mapStatus').textContent='Nie udało się pobrać danych BDL. Sprawdź połączenie z internetem.'}
 finally{bdlBusy=false}
}

function startContinuousLocation(){if(!navigator.geolocation)return;watchId=navigator.geolocation.watchPosition(p=>{userPos=[p.coords.latitude,p.coords.longitude]},()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:15000})}
function distMeters(a,b){const R=6371000,rad=Math.PI/180,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad;const x=Math.sin(dLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
async function prepareOfflineMap(){if(!map)return;const z0=Math.max(8,Math.floor(map.getZoom())-2),z1=Math.min(17,Math.floor(map.getZoom())+2),b=map.getBounds();let jobs=[];for(let z=z0;z<=z1;z++){const n=2**z,x1=Math.floor((b.getWest()+180)/360*n),x2=Math.floor((b.getEast()+180)/360*n),y1=Math.floor((1-Math.asinh(Math.tan(b.getNorth()*Math.PI/180))/Math.PI)/2*n),y2=Math.floor((1-Math.asinh(Math.tan(b.getSouth()*Math.PI/180))/Math.PI)/2*n);for(let x=x1;x<=x2;x++){const xx=((x%n)+n)%n;for(let y=y1;y<=y2;y++)if(y>=0&&y<n)jobs.push({z,x:xx,y})}}if(jobs.length>500)return alert(`Obszar za duży (${jobs.length} kafelków). Przybliż mapę.`);let done=0;for(const j of jobs){try{const u=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${j.z}/${j.y}/${j.x}`,r=await fetch(u);if(r.ok)await putCachedTile(`imagery/${j.z}/${j.x}/${j.y}`,await r.blob())}catch{}$('mapStatus').textContent=`Mapa offline: ${++done}/${jobs.length}`}alert('Gotowe. Przygotowano mapę offline dla widocznego obszaru.')}
function nestYears(n){const ys=new Set();(n.controls||[]).forEach(c=>{if(c&&c.date){const y=String(c.date).slice(0,4);if(/^\d{4}$/.test(y))ys.add(y)}});Object.keys(n.seasons||{}).forEach(y=>ys.add(String(y)));return [...ys]}
function nestHasYear(n,y){return nestYears(n).includes(String(y))}
function renderYearFilter(){const sel=$('yearFilter');if(!sel)return;const years=[...new Set(nests.flatMap(n=>nestYears(n)))].sort((a,b)=>b.localeCompare(a));sel.innerHTML='<option value="">Wszystkie lata</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');sel.value=filterYear}
function nestMatches(n){if(filterVisibility==='visible'&&n.hidden)return false;if(filterVisibility==='hidden'&&!n.hidden)return false;if(filterYear&&!nestHasYear(n,filterYear))return false;if(selectedSpeciesCodes.size&&!selectedSpeciesCodes.has(String(n.birdCode||'')))return false;const q=speciesQuery.trim().toLocaleLowerCase('pl-PL');if(!q)return true;return [n.bird,n.birdCode,n.label,n.id].some(v=>String(v??'').toLocaleLowerCase('pl-PL').includes(q))}
function renderMarkers(){if(!map)return;if(!nestMarkerLayer)nestMarkerLayer=L.layerGroup().addTo(map);nestMarkerLayer.clearLayers();if(!markersVisible)return;nests.filter(n=>n.lat&&n.lon&&!n.hidden&&!n.draft&&nestMatches(n)).forEach(n=>{const m=L.marker([n.lat,n.lon]);let tip=n.label||'gniazdo';m.bindTooltip(esc(tip),{permanent:true,direction:'top',className:'marker-label'});m.on('click',()=>openNest(n.id,false));nestMarkerLayer.addLayer(m);})}
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
function setEditable(v){const n=nests.find(x=>x.id===currentNestId);const c=n?.controls?.[currentControl];const saved=!!c&& (c.saved===true||hasLegacySavedControl(n,currentControl,c));editing=saved?!(!v):true; if(saved && !v) editing=false; if(!saved) editing=true; const canEdit=editing;['birdInput','criterion','obsPickerBtn','treeInput','count','chicks','notes'].forEach(id=>{const e=$(id);if(e)e.disabled=!canEdit});const d=$('date'),t=$('time');if(d)d.readOnly=true;if(t)t.readOnly=true;const saveBtn=$('saveControl');if(saveBtn)saveBtn.hidden=!canEdit;const eb=$('editNestBtn');if(eb){eb.hidden=canEdit||!saved;eb.textContent='✏️ Edytuj'}}
function saveCurrent(){const n=nests.find(x=>x.id===currentNestId);if(!n)return;const c=n.controls[currentControl]||blankControl();if(currentControl===0&&!n.bird){const q=$('birdInput')?.value.trim().toLocaleLowerCase('pl-PL'),b=BIRDS.find(x=>x.name.toLocaleLowerCase('pl-PL')===q||x.code.toLocaleLowerCase('pl-PL')===q);if(!b)return alert('Wybierz gatunek z listy.');n.bird=b.name;n.birdCode=b.code;n.number=n.number||nextNumber(b.code);n.label=`${b.code}-${n.number}`}
c.count=$('count').value;c.chicks=$('chicks').value;c.criterion=$('criterion').value;c.observations=[...document.querySelectorAll('[data-obs]:checked')].map(x=>OBS[+x.dataset.obs]);c.tree=$('treeInput').value.trim();const t=TREES.find(x=>x.name.toLocaleLowerCase('pl-PL')===c.tree.toLocaleLowerCase('pl-PL')||x.code.toLocaleLowerCase('pl-PL')===c.tree.toLocaleLowerCase('pl-PL'));c.treeCode=t?t.code:($('treeInput').dataset.code||'');const x=now();if(!c.saved){c.date=x.date;c.time=x.time}c.notes=$('notes').value;c.saved=true;n.controls[currentControl]=c;n.draft=false;n.seasons=n.seasons||{};const year=c.date.slice(0,4);n.seasons[year]=n.seasons[year]||[];n.seasons[year][currentControl]=JSON.parse(JSON.stringify(c));save();$('nestCode').textContent=n.label;editing=false;renderMarkers();closeNest()}
function openNest(id){const n=nests.find(x=>x.id===id);if(!n)return;currentNestId=id;currentControl=0;editing=!!n.draft;$('nestCard').hidden=false;$('nestCode').textContent=n.label||'nie nadano';$('birdFixed').innerHTML=n.bird?`<strong>Gatunek: ${esc(n.bird)} (${esc(n.birdCode)})</strong>`:'Gatunek: jeszcze nie wybrano';$('nestVisibilityBtn').textContent='Ukryj gniazdo';$('nestVisibilityBtn').onclick=()=>{n.hidden=true;save();renderMarkers();closeNest()};$('editNestBtn').onclick=()=>{editing=true;renderControl()};$('deleteNestBtn').onclick=()=>{if(confirm('Usunąć to gniazdo wraz ze wszystkimi kontrolami?')){nests=nests.filter(x=>x.id!==id);save();closeNest()}};$('historyBtn').onclick=()=>renderHistory(n);renderTabs();renderControl();requestAnimationFrame(()=>{const card=$('nestCard');card.scrollIntoView({behavior:'smooth',block:'start'});const title=$('nestTitle');if(title)title.focus({preventScroll:true})})}
function renderHistory(n){const p=$('historyPanel');p.hidden=!p.hidden;if(p.hidden)return;const seasons=n.seasons||{};const years=Object.keys(seasons).sort((a,b)=>b.localeCompare(a));const val=v=>esc(v==null||v===''?'—':v);const obs=v=>(v||[]).length?esc(v.join(', ')):'—';const controls=arr=>[0,1,2,3].map(i=>{const c=arr[i]||blankControl();const crit=CRITERIA.find(x=>x.code===c.criterion);return `<div class="historyControl"><h4>Kontrola ${i+1}</h4><div><b>Data:</b> ${val(c.date)} &nbsp; <b>Czas:</b> ${val(c.time)}</div><div><b>Liczebność:</b> ${val(c.count)}</div><div><b>Liczba piskląt:</b> ${val(c.chicks)}</div><div><b>Kryterium lęgowości:</b> ${val(c.criterion)}</div><div class="historyDesc"><b>Opis kryterium:</b> ${val(crit&&crit.desc)}</div><div><b>Obserwacje:</b> ${obs(c.observations)}</div><div><b>Drzewo:</b> ${val(c.tree)}</div><div><b>Kod drzewa:</b> ${val(c.treeCode)}</div><div><b>Uwagi:</b> ${val(c.notes)}</div></div>`}).join('');p.innerHTML=years.length?`<h3>Historia gniazda ${esc(n.label)}</h3>`+years.map(y=>`<div class="historyYear"><button type="button" data-year="${y}">${y} ▸</button><div class="historyBody" data-body="${y}" hidden>${controls(seasons[y]||[])}</div></div>`).join(''):'<div class="muted">Brak zapisanej historii.</div>';p.querySelectorAll('[data-year]').forEach(b=>b.onclick=()=>{const body=p.querySelector(`[data-body="${b.dataset.year}"]`);body.hidden=!body.hidden;b.textContent=body.hidden?`${b.dataset.year} ▸`:`${b.dataset.year} ▾`})}
function renderTabs(){document.querySelectorAll('.tab').forEach((b,i)=>{b.classList.toggle('active',i===currentControl);b.onclick=()=>{currentControl=i;const n=nests.find(x=>x.id===currentNestId);const c=n?.controls?.[i]||blankControl();editing=!!n?.draft || !c.saved;renderTabs();renderControl()}})}
function cancelCurrentNest(){const n=nests.find(x=>x.id===currentNestId);if(!n)return;if(n.draft&&!n.bird){nests=nests.filter(x=>x.id!==currentNestId);save();$('mapMode').hidden=false;closeNest();return}editing=false;renderControl()}
function closeNest(){const n=currentNestId?nests.find(x=>x.id===currentNestId):null;if(n?.draft){nests=nests.filter(x=>x.id!==currentNestId);save()}currentNestId=null;$('nestCard').hidden=true;$('mapMode').hidden=false;$('historyPanel').hidden=true;renderMarkers();map.invalidateSize();window.scrollTo({top:0,behavior:'smooth'})}
function registerNest(){const c=map.getCenter(),id=crypto.randomUUID?crypto.randomUUID():String(Date.now());const n={id,lat:Number(c.lat.toFixed(6)),lon:Number(c.lng.toFixed(6)),bird:'',birdCode:'',label:'',number:'',controls:[blankControl(),blankControl(),blankControl(),blankControl()],seasons:{},draft:true};nests.push(n);currentNestId=id;$('mapMode').hidden=true;openNest(id);requestAnimationFrame(()=>{const card=$('nestCard');if(card){card.hidden=false;card.scrollIntoView({behavior:'smooth',block:'start'})}})}
function deleteVisibleNests(){const b=map.getBounds();const candidates=nests.filter(n=>n.lat&&n.lon&&b.contains([n.lat,n.lon])&&!n.hidden);if(!candidates.length)return alert('W widocznym fragmencie mapy nie ma widocznych gniazd.');if(!confirm(`Usunąć ${candidates.length} gniazd z widocznego fragmentu mapy? Tej operacji nie można cofnąć.`))return;nests=nests.filter(n=>!(n.lat&&n.lon&&b.contains([n.lat,n.lon])&&!n.hidden));save();renderMarkers();alert(`Usunięto ${candidates.length} gniazd.`)}
function countSpecies(){const box=$('speciesCountBox');if(!box)return;if(!box.hidden){box.hidden=true;return}const m={};nests.forEach(n=>{const k=n.bird||'bez gatunku';m[k]=(m[k]||0)+1});box.hidden=false;box.innerHTML=Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="speciesCountRow"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('')}
function getFilteredNests(){return nests.filter(n=>nestMatches(n))}
function csvEscape(v){return '"'+String(v??'').replaceAll('"','""')+'"'}
async function reverseGeocode(lat,lon){try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,{headers:{'Accept-Language':'pl'}});const j=await r.json(),a=j.address||{};return {miejscowosc:a.village||a.town||a.city||a.hamlet||'',gmina:String(a.municipality||a.city_district||'').replace(/^gmina\s+/i,'').trim(),wojewodztwo:String(a.state||'').replace(/^województwo\s+/i,'').trim()}}catch{return {miejscowosc:'',gmina:'',wojewodztwo:''}}}
async function fetchBDLExportData(n){
 try{
  // The official mBDL description layer is in EPSG:2180. ArcGIS performs the
  // WGS84 -> EPSG:2180 transformation when inSR=4326 is supplied. A small
  // search radius makes the lookup robust when the saved nest coordinate is
  // close to a stand boundary.
  const fields='adress_forest,compartment_cd,subarea_cd,species_cd,species_age,site_type_cd,storey_species_desc,a_year';
  const params=new URLSearchParams({
   where:'1=1',
   geometry:`${n.lon},${n.lat}`,
   geometryType:'esriGeometryPoint',
   inSR:'4326',
   spatialRel:'esriSpatialRelIntersects',
   distance:'25',
   units:'esriSRUnit_Meter',
   outFields:fields,
   returnGeometry:'false',
   resultRecordCount:'1',
   f:'json'
  });
  const r=await fetch(`${BDL_VECTOR_URL}?${params}`,{cache:'no-store'});
  if(!r.ok)throw new Error('BDL export HTTP '+r.status);
  const j=await r.json();
  const a=j.features?.[0]?.attributes||{};
  if(!Object.keys(a).length)throw new Error('BDL: brak wydzielenia dla punktu');
  const parts=String(a.adress_forest||'').split('-').map(x=>x.trim()).filter(Boolean);
  const species=a.species_cd||'';
  const age=a.species_age??'';
  const tsl=a.site_type_cd||'';
  return {
   bdlAddress:a.adress_forest||'',
   bdlCompartment:a.subarea_cd||parts[parts.length-1]||'',
   bdlAge:age,
   bdlSpecies:species,
   bdlTSL:tsl,
   bdlSpeciesDesc:a.storey_species_desc||'',
   bdlYear:a.a_year??''
  };
 }catch(e){
  console.warn('BDL export data:',e);
  return {bdlAddress:'',bdlCompartment:'',bdlAge:'',bdlSpecies:'',bdlTSL:'',bdlSpeciesDesc:'',bdlYear:''}
}
}
async function exportCSV(){
 const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));
 if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');
 const h=['kod_gniazda','gatunek','kod_gatunku','GPS_lat','GPS_lon','najblizsza_miejscowosc','gmina','wojewodztwo','BDL_adres_wydzielenia','BDL_numer_wydzielenia','BDL_wiek_drzewostanu','BDL_gatunek_glowny','BDL_TSL'];
 for(let i=1;i<=4;i++)h.push(`K${i}_kryterium`,`K${i}_obserwacje`,`K${i}_liczebnosc`,`K${i}_liczba_pisklat`,`K${i}_drzewo`,`K${i}_kod_drzewa`,`K${i}_data`,`K${i}_czas`,`K${i}_uwagi`);
 const rows=[];
 for(const n of list){
  const [g,bdl]=await Promise.all([reverseGeocode(n.lat,n.lon),fetchBDLExportData(n)]);
  const r=[n.label,n.bird,n.birdCode,n.lat,n.lon,g.miejscowosc,g.gmina,g.wojewodztwo,bdl.bdlAddress,bdl.bdlCompartment,bdl.bdlAge,bdl.bdlSpecies,bdl.bdlTSL];
  for(let i=0;i<4;i++){const c=n.controls[i]||blankControl();r.push(c.criterion,(c.observations||[]).join(' | '),c.count,c.chicks,c.tree,c.treeCode,c.date,c.time,c.notes)}
  rows.push(r)
 }
 const csv='\uFEFF'+[h,...rows].map(r=>r.map(csvEscape).join(';')).join('\n');
 shareOrDownload(new Blob([csv],{type:'text/csv;charset=utf-8'}),'NestMap.csv');
}
function exportGeoJSON(){const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));return {type:'FeatureCollection',features:list.map(n=>({type:'Feature',geometry:{type:'Point',coordinates:[n.lon,n.lat]},properties:{kod:n.label,gatunek:n.bird,kod_gatunku:n.birdCode,rok:nestYears(n).join(',')}}))}}
function kmzValue(v){return v==null||v===''?'—':String(v)}
function kmzControlHtml(c,i){const obs=(c.observations||[]).join(', ');return `<h3>Kontrola ${i+1}</h3><table><tr><td>Data</td><td>${esc(kmzValue(c.date))}</td></tr><tr><td>Czas</td><td>${esc(kmzValue(c.time))}</td></tr><tr><td>Kryterium lęgowości</td><td>${esc(kmzValue(c.criterion))}</td></tr><tr><td>Obserwacje</td><td>${esc(kmzValue(obs))}</td></tr><tr><td>Liczebność</td><td>${esc(kmzValue(c.count))}</td></tr><tr><td>Liczba piskląt</td><td>${esc(kmzValue(c.chicks))}</td></tr><tr><td>Drzewo</td><td>${esc(kmzValue(c.tree))}</td></tr><tr><td>Kod drzewa</td><td>${esc(kmzValue(c.treeCode))}</td></tr><tr><td>Uwagi</td><td>${esc(kmzValue(c.notes))}</td></tr></table>`}
async function exportKMZ(){
 const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));
 if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');
 $('mapStatus').textContent='Przygotowuję KMZ…';
 const k=[];
 for(const n of list){
  const b=await fetchBDLExportData(n);
  const controls=(n.controls||[]).map((c,i)=>kmzControlHtml(c||blankControl(),i)).join('');
  const bdl=`<h3>BDL</h3><table><tr><td>Adres leśny</td><td>${esc(kmzValue(b.bdlAddress))}</td></tr><tr><td>Oddział i wydzielenie</td><td>${esc(kmzValue(b.bdlCompartment))}</td></tr><tr><td>TSL</td><td>${esc(kmzValue(b.bdlTSL))}</td></tr><tr><td>Wiek drzewostanu</td><td>${esc(kmzValue(b.bdlAge))}</td></tr><tr><td>Gatunek dominujący</td><td>${esc(kmzValue(b.bdlSpecies))}</td></tr></table>`;
  const desc=`<![CDATA[<div><h2>NestMap — ${esc(n.label||'KOD')}</h2><p><b>KOD:</b> ${esc(kmzValue(n.label))}<br><b>Gatunek:</b> ${esc(kmzValue(n.bird))}<br><b>Kod gatunku:</b> ${esc(kmzValue(n.birdCode))}<br><b>Numer:</b> ${esc(kmzValue(n.number))}<br><b>GPS:</b> ${esc(kmzValue(n.lat))}, ${esc(kmzValue(n.lon))}</p>${bdl}${controls}</div>]]>`;
  k.push(`<Placemark><name>${esc(n.label||'gniazdo')}</name><description>${desc}</description><Point><coordinates>${Number(n.lon)},${Number(n.lat)},0</coordinates></Point></Placemark>`);
 }
 const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>NestMap</name>${k.join('')}</Document></kml>`;
 const zip=zipStore([{name:'doc.kml',data:new TextEncoder().encode(kml)}]);
 $('mapStatus').textContent='';
 await shareOrDownload(new Blob([zip],{type:'application/vnd.google-earth.kmz'}),'NestMap.kmz');
}
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
  ['MIEJSC','C',80,0],['GMINA','C',80,0],['WOJEW','C',60,0],['BDL_ADRES','C',25,0],['BDL_WYDZ','C',12,0],['BDL_WIEK','N',6,0],['BDL_GAT','C',10,0],['BDL_TSL','C',7,0]
 ];
 for(let i=1;i<=4;i++) fields.push([`K${i}_KRYT`,'C',20,0],[`K${i}_OBS`,'C',254,0],[`K${i}_LICZ`,'C',20,0],[`K${i}_PISKL`,'C',20,0],[`K${i}_DRZEWO`,'C',60,0],[`K${i}_KODDRZ`,'C',15,0],[`K${i}_DATA`,'C',12,0],[`K${i}_CZAS`,'C',8,0],[`K${i}_UWAGI`,'C',254,0]);
 const hlen=32+fields.length*32+1,rlen=1+fields.reduce((a,f)=>a+f[2],0),dbf=new Uint8Array(hlen+n*rlen);dbf.fill(32);dbf[0]=3;
 const d=new Date();dbf[1]=d.getFullYear()-1900;dbf[2]=d.getMonth()+1;dbf[3]=d.getDate();
 const dv=new DataView(dbf.buffer);dv.setUint32(4,n,true);dv.setUint16(8,hlen,true);dv.setUint16(10,rlen,true);
 let fp=32;for(const f of fields){dbf.set(dbfField(...f),fp);fp+=32}dbf[fp]=13;
 for(let i=0;i<n;i++){
  const x=list[i],b=bdlDataMap[x.id]||{},row=hlen+i*rlen;dbf[row]=32;let q=row+1;
  const vals=[x.label,x.bird,x.birdCode,Number(x.lat).toFixed(6),Number(x.lon).toFixed(6),x._exportPlace||'',x._exportGmina||'',x._exportWoj||'',b.bdlAddress||'',b.bdlCompartment||'',b.bdlAge??'',b.bdlSpecies||'',b.bdlTSL||''];
  for(let cidx=0;cidx<4;cidx++){const c=x.controls[cidx]||blankControl();vals.push(c.criterion||'',(c.observations||[]).join(' | '),c.count??'',c.chicks??'',c.tree||'',c.treeCode||'',c.date||'',c.time||'',c.notes||'')}
  for(let j=0;j<fields.length;j++){dbf.set(dbfText(vals[j],fields[j][2]),q);q+=fields[j][2]}
 }
 dbf[dbf.length-1]=26;
 const prj=new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]');
 return [{name:'NestMap.shp',data:concatBytes(...shp)},{name:'NestMap.shx',data:concatBytes(...shx)},{name:'NestMap.dbf',data:dbf},{name:'NestMap.prj',data:prj},{name:'NestMap.cpg',data:new TextEncoder().encode('UTF-8')}]
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
 $('mapStatus').textContent='';await shareOrDownload(new Blob([zipStore(files)],{type:'application/zip'}),'NestMap_SHP.zip');
}
async function exportGPX(){
 const list=getFilteredNests().filter(n=>!window.__nmExportBounds||window.__nmExportBounds.contains([n.lat,n.lon]));
 if(!list.length)return alert('Brak gniazd spełniających wybrane filtry.');
 const escXml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const w=list.map(n=>{const nm=n.label||'gniazdo',species=n.bird||'';const name=species?`${nm} — ${species}`:nm;return `<wpt lat="${Number(n.lat).toFixed(6)}" lon="${Number(n.lon).toFixed(6)}"><name>${escXml(name)}</name></wpt>`}).join('');
 const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="NestMap" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>NestMap</name></metadata>${w}</gpx>`;
 await shareOrDownload(new Blob([gpx],{type:'application/gpx+xml'}),'NestMap.gpx');
}
async function shareOrDownload(blob,name){
 const shareType='application/octet-stream';
 try{
  // iOS Safari is more reliable when the attachment is presented as a
  // generic file while the original filename/extension is preserved.
  const file=new File([blob],name,{type:shareType,lastModified:Date.now()});
  if(typeof navigator.share==='function'){
   // Do not gate this on navigator.canShare(): iOS Safari has reported false
   // for some valid attachment types even though navigator.share can send them.
   await navigator.share({files:[file]});
   return true;
  }
 }catch(e){
  if(e?.name==='AbortError')return false;
  console.warn('Udostępnianie pliku:',e);
 }
 // No synthetic "text" file: if the Web Share API is unavailable, create
 // exactly one download with the requested filename.
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download=name;a.rel='noopener';
 a.style.display='none';
 document.body.appendChild(a);a.click();
 setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},3000);
 return true;
}
function downloadBlob(data,name,type){return shareOrDownload(new Blob([data],{type}),name)}
function applyAreaExport(){window.__nmExportBounds=map.getBounds();alert('Ustawiono eksport dla obecnie widocznego fragmentu mapy. CSV, KMZ i SHP będą ograniczone do tego obszaru.')}
$('menuBtn').onclick=()=>{$('menuPanel').hidden=false};$('closeMenu').onclick=()=>{$('menuPanel').hidden=true};$('mapTypeBtn').onclick=()=>{if(bdlEnabled)return;const b=$('mapTypeBtn');if(map.hasLayer(window.__nmImagery)){map.removeLayer(window.__nmImagery);window.__nmStreets.addTo(map);baseMapMode='streets';b.textContent='🗺️ Mapa ulic'}else{map.removeLayer(window.__nmStreets);window.__nmImagery.addTo(map);baseMapMode='imagery';b.textContent='🛰️ Ortofotomapa'}};$('bdlBtn').onclick=toggleBDL;$('locateBtn').onclick=locatePhone;$('offlineBtn').onclick=prepareOfflineMap;$('registerBtn').onclick=registerNest;$('closeNest').onclick=closeNest;$('saveControl').onclick=saveCurrent;$('cancelNest').onclick=cancelCurrentNest;$('exportCsv').onclick=exportCSV;$('exportKmz').onclick=exportKMZ;$('exportShp').onclick=exportSHP;$('exportGpx').onclick=exportGPX;$('exportCurrentArea').onclick=applyAreaExport;$('deleteVisibleBtn').onclick=deleteVisibleNests;$('countSpeciesBtn').onclick=countSpecies;$('toggleNestsBtn').onclick=()=>{markersVisible=false;renderMarkers()};$('revealNestsBtn').onclick=()=>{markersVisible=true;nests.forEach(n=>n.hidden=false);save();renderMarkers();if(currentNestId){const b=$('nestVisibilityBtn');if(b)b.textContent='Ukryj gniazdo'}};$('nestSearch').oninput=e=>{speciesQuery=e.target.value;renderSpeciesFilter();renderMarkers()};$('showAllNests').onclick=()=>{$('nestSearch').value='';speciesQuery='';selectedSpeciesCodes.clear();filterYear='';renderYearFilter();renderSpeciesFilter();renderMarkers()};$('clearNestFilter').onclick=()=>{$('nestSearch').value='';speciesQuery='';selectedSpeciesCodes.clear();filterYear='';renderYearFilter();renderSpeciesFilter();renderMarkers()};if($('yearFilter'))$('yearFilter').onchange=e=>{filterYear=e.target.value;renderMarkers()};
initMap();startContinuousLocation();renderYearFilter();renderSpeciesFilter();
