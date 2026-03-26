const CACHE='md-v4'; 
const ASSETS=['/','/index.html','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/')||e.request.url.includes('googleapis'))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
self.addEventListener('push',e=>{let data={title:'MindDump',body:'You have a reminder'};try{data=e.data?JSON.parse(e.data.text()):data;}catch(err){}e.waitUntil(self.registration.showNotification(data.title||'MindDump',{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',vibrate:[200,100,200],tag:data.tag||'reminder',data:{url:data.url||'/'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(cls=>{const url=e.notification.data?.url||'/';const ex=cls.find(c=>c.url.includes(self.location.origin));if(ex){ex.focus();return;}return clients.openWindow(url);}));});
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
