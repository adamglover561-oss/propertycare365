const CACHE="pc360-admin-v2";
const APP_SHELL=["/admin/","/admin/manifest.webmanifest","/icon.svg","/icon.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("pc360-admin-")&&k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith("/admin/")) return;

  event.respondWith(
    fetch(event.request).then(response=>{
      if(response && response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      }
      return response;
    }).catch(()=>caches.match(event.request).then(r=>r||caches.match("/admin/")))
  );
});

self.addEventListener("push",event=>{
  let data={};
  try{ data=event.data?.json()||{}; }catch{ data={body:event.data?.text()||"New Property Care 360 activity"}; }
  const title=data.title||"Property Care 360";
  const options={
    body:data.body||"New customer activity.",
    icon:"/icon.png",
    badge:"/icon.png",
    tag:data.tag||"pc360-owner-alert",
    renotify:true,
    data:{url:data.url||"/admin/"}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/admin/",self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){
        if("navigate" in client) await client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
