const cacheName="vektora-converter-v20";
const assets=[
  "./","./converter.css?v=15","./converter.mjs?v=20","./icons.mjs","./trace-worker.mjs?v=20","./trace.mjs?v=20","./contours.mjs?v=18","./ink-contours.mjs?v=20","./formats.mjs?v=17","./sheet.mjs?v=17","./utilities.mjs?v=14","./image-codec.mjs?v=14","./tones.mjs?v=14","./resample-worker.mjs?v=14","./resample.mjs?v=14","./app.webmanifest?v=5",
  "./editor.html","./style.css?v=7","./editor.mjs?v=7","./assets/mark.svg?v=5","./assets/mark-192.png?v=5","./assets/mark-512.png?v=5","./assets/botanika.jpg"
];
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const root=await fetch("./",{cache:"reload"});
    if(!root.ok||!(await root.clone().text()).includes('name="vektora-app"')) throw Error("Studio belum bisa disimpan untuk offline.");
    const cache=await caches.open(cacheName);
    const editor = await fetch("./editor.html", {cache:"reload"});
    if (!editor.ok) throw Error("Editor belum bisa disimpan untuk offline.");
    const editorHtml = await editor.text();
    if (!editorHtml.includes('id="board"')) throw Error("Halaman editor tidak cocok.");
    const otherAssets = assets.slice(1).filter(path=>path!=="./editor.html");
    await cache.addAll(otherAssets.map(path=>new Request(path,{cache:"reload"})));
    await cache.put("./editor.html", new Response(editorHtml, {
      headers: {"Content-Type":"text/html; charset=utf-8"}
    }));
    await cache.put("./",root);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()) if(key.startsWith("vektora-converter-")&&key!==cacheName)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  const url=new URL(event.request.url);
  const editorAlias = new URL("./editor",self.registration.scope).href;
  const asset = url.href===editorAlias ? "./editor.html"
    : assets.find(path=>new URL(path,self.registration.scope).href===url.href);
  if(!asset)return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).catch(()=>caches.match(asset)));
  }else{
    event.respondWith(caches.match(asset).then(hit=>hit||fetch(event.request)));
  }
});
