const VERSION="v8-21-14";
const STATIC=`nestmap-static-${VERSION}`;
const MAP="nestmap-map-tiles-v5";
const APP_SHELL=["./","./index.html","./app.js","./data.js","./style.css","./nestmap_v82_ui.css","./nestmap_v86.css","./manifest.webmanifest","./kania-logo.png"];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(STATIC)
      .then(cache=>cache.addAll(APP_SHELL))
      .catch(()=>{})
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>(k.startsWith("nestmap-static-")||k.startsWith("nestmap-map-tiles-")) && k!==STATIC && k!==MAP)
          .map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=req.url;

  // Never let an old Service Worker cache its own update file.
  if(new URL(url).pathname.endsWith("/sw.js")){
    event.respondWith(fetch(req,{cache:"no-store"}));
    return;
  }

  // BDL drzewostany are online-only: never cache BDL responses in the service worker.
  if(url.includes("bdl.lasy.gov.pl")){
    event.respondWith(fetch(req,{cache:"no-store"}));
    return;
  }

  // Map tiles: cache-first so tiles viewed online remain available offline.
  if(url.includes("server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/") || url.includes("tile.openstreetmap.org/")){
    event.respondWith(
      caches.open(MAP).then(cache=>
        cache.match(req).then(hit=>hit || fetch(req).then(response=>{
          if(response.ok) cache.put(req,response.clone());
          return response;
        }).catch(()=>new Response("",{status:503})))
      )
    );
    return;
  }

  // Application files: network-first. This prevents stale app.js/index.html
  // from being served after a new version is published, while retaining an
  // offline fallback.
  const isAppFile=/\/((index\.html)|(app\.js)|(data\.js)|(style\.css)|(nestmap_v82_ui\.css)|(nestmap_v86\.css)|(manifest\.webmanifest)|(kania-logo\.png))$/.test(new URL(url).pathname);
  if(isAppFile){
    event.respondWith(
      fetch(req,{cache:"no-store"}).then(response=>{
        if(response.ok) caches.open(STATIC).then(cache=>cache.put(req,response.clone()));
        return response;
      }).catch(()=>caches.match(req).then(hit=>hit || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit=>hit || fetch(req).then(response=>{
      if(response.ok) caches.open(STATIC).then(cache=>cache.put(req,response.clone()));
      return response;
    }).catch(()=>caches.match("./index.html")))
  );
});
