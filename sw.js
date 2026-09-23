const CACHE='tt-league-v5-career-stats';
const ASSETS=['./','./index.html','./style.css','./app.js','./domain.js','./storage.js','./cloud.js','./cloud-config.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
// A new version waits until the old application is closed; no reload during a match.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tt-league-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
