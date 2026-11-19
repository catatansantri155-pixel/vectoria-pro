import {epsText,outputSize,pdfText,rasterSize,svgText,traceSize,zipFiles} from "./formats.mjs?v=7";
import {setupUtilities} from "./utilities.mjs";
import {mountIcons} from "./icons.mjs";

const $=id=>document.getElementById(id);
mountIcons();

const allowed=/\.(jpe?g|png|webp|bmp|gif|avif)$/i;
const sampleUrl="assets/botanika.jpg";
const standardFormat=new Intl.NumberFormat("id-ID");
const count=value=>standardFormat.format(value);
const fileName=name=>name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").trim().slice(0,110)||"vektora";
function sizeText(bytes){
  if(bytes<1000)return bytes+" B";
  if(bytes<1e6)return (bytes/1000).toLocaleString("id-ID",{maximumFractionDigits:1})+" KB";
  return (bytes/1e6).toLocaleString("id-ID",{maximumFractionDigits:1})+" MB";
}
let noticeTimer;
function notify(message){
  clearTimeout(noticeTimer);
  $("notice").hidden=false;
  $("notice").textContent=message;
  noticeTimer=setTimeout(()=>$("notice").hidden=true,4300);
}
function saveFile(name,contents,type){
  const url=URL.createObjectURL(contents instanceof Blob?contents:new Blob([contents],{type}));
  const anchor=document.createElement("a");
  anchor.href=url;
  anchor.download=name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function loadImage(url){
  const image=new Image();
  image.decoding="async";
  image.src=url;
  try{await image.decode();}catch{throw Error("Gambar tidak dapat dibaca oleh browser.");}
  if(!image.naturalWidth || image.naturalWidth*image.naturalHeight>60e6) throw Error("Resolusi gambar melebihi 60 MP.");
  return image;
}
function checkFile(file){
  if(!allowed.test(file.name)&&!(file.name==="gambar"&&/^image\/(jpeg|png|webp|bmp|gif|avif)$/.test(file.type)))return "Format dicoba: JPG, PNG, WebP, BMP, GIF, atau AVIF.";
  if(file.size>20e6)return "Ukuran file melebihi 20 MB.";
  return "";
}
async function imageFrame(url){
  const image=await loadImage(url);
  if(typeof createImageBitmap!=="function")return image;
  try{return await createImageBitmap(image);}catch{return image;}
}
function rasterBlob(canvas,format){
  const type=format==="JPG"?"image/jpeg":"image/png";
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
    if(blob)resolve(blob);
    else reject(Error("Browser gagal membuat gambar unduhan."));
  },type,.94));
}

let jobList=[],selected=0,studio="vector",mode="color",view="compare",zoom=1,serial=0;
let worker=null,pending=null,processing=false,previewUrl;
const current=()=>jobList[selected];
const label=id=>Number($(id).value);
const settings=()=>({mode,colors:label("colors"),threshold:label("threshold"),detail:label("detail"),noise:label("noise"),removeWhite:$("removeWhite").checked,hd:$("traceHD").checked});
const detailNames=["Sederhana","Ringan","Seimbang","Detail tinggi","Sangat detail"];
function updateSettings(){
  for(const key of ["colors","threshold","noise"])$(key+"Out").textContent=$(key).value;
  $("detailOut").textContent=detailNames[label("detail")];
  $("colorControls").hidden=mode!=="color";
  $("monoControls").hidden=mode!=="mono";
  document.querySelectorAll("[data-mode]").forEach(el=>el.setAttribute("aria-pressed",el.dataset.mode===mode));
}
function status(message){$("status").textContent=message;}
function refreshButtons(){
  const item=current(),has=Boolean(item?.result);
  $("run").disabled=processing||!jobList.length;
  $("cancel").hidden=!processing;
  $("progressBox").hidden=!processing;
  $("run").lastChild.textContent=jobList.length>1?`Proses ${jobList.length} gambar`:"Buat vektor";
  $("download").disabled=!has||!item.result.layers.length;
  $("slice").hidden=!has;
  $("batchDownload").disabled=processing||!jobList.some(entry=>entry.result?.layers.length);
  $("zoomIn").disabled=zoom>=8||!item;
  $("zoomOut").disabled=zoom<=1||!item;
}
function updateQueue(){
  $("queueBox").hidden=jobList.length<2;
  $("queue").replaceChildren(...jobList.map((item,i)=>{
    const state=item.error?"gagal":item.result?"selesai":"menunggu";
    return new Option(`${i+1}. ${item.name} · ${state}`,i);
  }));
  $("queue").value=String(selected);
}
function sizeArtwork(){
  const canvas=$("canvas");
  const item=current();
  if(!item?.w||!item?.h||!canvas.clientWidth)return;
  const width=Math.min(canvas.clientWidth,canvas.clientHeight*item.w/item.h);
  const height=width*item.h/item.w;
  const split=label("compareRange")/100;
  canvas.style.setProperty("--split",split*100+"%");
  canvas.style.setProperty("--art-width",width+"px");
  canvas.style.setProperty("--art-height",height+"px");
  canvas.style.setProperty("--zoom",zoom);
  canvas.style.setProperty("--image-split",((split-.5)*canvas.clientWidth/(width*zoom)+.5)*100+"%");
  $("zoomReset").textContent=zoom*100+"%";
}
function updateDimensions(){
  const item=current();
  const raster = ["PNG","JPG"].includes($("format").value);
  $("stockSettings").hidden=raster;
  $("rasterSettings").hidden=!raster;
  if(!item?.w){
    $("dimensions").textContent="16 MP · proporsi asli";
    $("rasterDimensions").textContent="Sisi terpanjang";
    return;
  }
  if(raster){
    const [rw,rh]=rasterSize(item.w,item.h,$("rasterSize").value);
    $("rasterDimensions").textContent=`${count(rw)} × ${count(rh)} px`;
  }
  const [w,h]=outputSize(item.w,item.h,$("stock").checked);
  $("dimensions").textContent=`${count(w)} × ${count(h)} px · ${(w*h/1e6).toLocaleString("id-ID",{maximumFractionDigits:2})} MP`;
}
function renderPreview(){
  const item=current(),result=item?.result;
  const ready=Boolean(item?.w);
  $("canvas").dataset.view=result?view:"original";
  $("art").hidden=!ready;
  $("empty").hidden=ready;
  $("original").src=ready?item.url:sampleUrl;
  $("sourceLabel").hidden=!ready||Boolean(result&&view!=="compare");
  $("vectorLabel").hidden=!result;
  $("vectorLabel").textContent=view==="outline"?"Kontur":"Vektor";
  $("splitLine").hidden=$("compareRange").hidden=!(result&&view==="compare");
  $("result").hidden=!result;
  $("metrics").hidden=!result;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=undefined;}
  if(result){
    previewUrl=URL.createObjectURL(new Blob([svgText(result,{preview:true,outlines:view==="outline"})],{type:"image/svg+xml"}));
    $("result").src=previewUrl;
    $("objects").textContent=count(result.objects);
    $("points").textContent=count(result.points);
    $("svgSize").textContent=sizeText(new Blob([svgText(result,{stock:$("stock").checked})]).size);
  }else $("result").removeAttribute("src");
  document.querySelectorAll("button[data-view]").forEach(button=>{
    button.setAttribute("aria-pressed",button.dataset.view===view);
    button.disabled=!result;
  });
  $("fileInfo").hidden=!item;
  if(item){
    $("fileName").textContent=item.name;
    $("fileSize").textContent=ready?`${count(item.w)} × ${count(item.h)} px · ${item.size?sizeText(item.size):"Gambar contoh"}`:item.error??"Memuat…";
  }
  if(!processing)status(item?.error??(result?(result.layers.length?"Hasil siap diperiksa dan diunduh.":"Hasil kosong. Atur ambang atau gunakan mode warna."):"Pilih gambar atau gunakan contoh."));
  if(item&&!processing&&ready&&!result&&!item.error)status("Gambar siap. Ketuk Buat vektor.");
  updateDimensions();
  refreshButtons();
  sizeArtwork();
}
async function inspect(item){
  if(item.w)return;
  const image=await loadImage(item.url);
  item.w=image.naturalWidth;
  item.h=image.naturalHeight;
}
async function selectItem(index){
  selected=index;
  zoom=1;
  $("compareRange").value=50;
  const item=current();
  renderPreview();
  if(!item)return;
  try{await inspect(item);}catch(error){item.error=error.message;}
  if(current()===item){updateQueue();renderPreview();}
}
function stopProcessing(){
  serial+=1;
  worker?.terminate();
  worker=null;
  pending?.reject(new DOMException("Dibatalkan","AbortError"));
  pending=null;
  processing=false;
}
function replaceItems(items){
  stopProcessing();
  for(const item of jobList)if(item.local)URL.revokeObjectURL(item.url);
  jobList=items;
  view="compare";
  updateQueue();
  return selectItem(0);
}
async function sample(){
  const items=[{name:"botanika.jpg",url:sampleUrl}];
  await replaceItems(items);
  if(jobList===items&&!processing)await run();
}
function addFiles(files){
  const accepted=[];
  let firstError="";
  for(const file of Array.from(files).slice(0,30)){
    const error=checkFile(file);
    if(error){firstError ||= `${file.name}: ${error}`;continue;}
    accepted.push({name:file.name==="gambar"?"gambar-tempel.png":file.name,url:URL.createObjectURL(file),local:true,size:file.size});
  }
  if(firstError)notify(firstError);
  else if(files.length>30)notify("Maksimal 30 gambar per proses. Tiga puluh file pertama ditambahkan.");
  if(accepted.length)replaceItems(accepted);
}
function trace(pixels,w,h,options,progress){
  if(!worker){
    worker=new Worker(new URL("./trace-worker.mjs",import.meta.url),{type:"module"});
    worker.onmessage=event=>{
      const {progress,error,result}=event.data;
      if(!pending)return;
      if(progress!==undefined){pending.progress(progress);return;}
      const job=pending;
      pending=null;
      if(error)job.reject(Error(error));
      else job.resolve(result);
    };
    worker.onerror=()=>{
      pending?.reject(Error("Mesin vektor gagal dimuat. Muat ulang halaman lalu coba lagi."));
      pending=null;
      worker?.terminate();
      worker=null;
    };
  }
  return new Promise((resolve,reject)=>{
    pending={resolve,reject,progress};
    worker.postMessage({pixels,w,h,settings:options},[pixels.buffer]);
  });
}
async function convert(item,options,token,progress){
  await inspect(item);
  let image=await imageFrame(item.url);
  if(token!==serial){image.close?.();throw new DOMException("Dibatalkan","AbortError");}
  const canvas=document.createElement("canvas");
  [canvas.width,canvas.height]=traceSize(item.w,item.h,options.detail,options.hd);
  const context=canvas.getContext("2d",{willReadFrequently:true});
  context.imageSmoothingQuality="high";
  context.drawImage(image,0,0,canvas.width,canvas.height);
  image.close?.();
  image=null;
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  const result=await trace(pixels,canvas.width,canvas.height,options,progress);
  result.originalWidth=item.w;
  result.originalHeight=item.h;
  return result;
}
async function run({reveal=false}={}){
  if(processing||!jobList.length)return;
  processing=true;
  const token=++serial,options=settings();
  for(const item of jobList){item.result=null;item.error=null;}
  updateQueue();
  renderPreview();
  const scoped=jobList;
  for(let i=0;i<scoped.length;i++){
    const item=scoped[i];
    $("progress").value=i/scoped.length;
    status(scoped.length>1?`Mengubah ${i+1} dari ${scoped.length} gambar…`:"Menelusuri warna dan kontur…");
    try {
      const result=await convert(item,options,token,value=>{$("progress").value=(i+value)/scoped.length;});
      if(token!==serial)return;
      item.result=result;
    }catch(error){
      if(token!==serial)return;
      item.error=error.message;
    }
    updateQueue();
    if(current()===item)renderPreview();
  }
  if(token!==serial)return;
  processing=false;
  $("progress").value=1;
  renderPreview();
  const finished=scoped.filter(item=>item.result?.layers.length).length;
  if(scoped.length>1)status(`${finished} dari ${scoped.length} gambar menghasilkan vektor.`);
  if(reveal && studio==="vector" && matchMedia("(max-width:739px)").matches){
    $("previewTitle").scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  }
}
function switchView(target){
  if(!current()?.result)return;
  view=target;
  renderPreview();
}
function changeZoom(value){
  zoom=Math.min(8,Math.max(1,value));
  sizeArtwork();
  refreshButtons();
}
async function downloadResult(){
  const item=current(),model=item?.result,stock=$("stock").checked,format=$("format").value;
  if(!model?.layers.length){notify("Hasil belum berisi bentuk. Ubah pengaturan lalu proses kembali.");return;}
  const base=fileName(item.name);
  try{
    if(format==="SVG")saveFile(base+".svg",svgText(model,{stock}),"image/svg+xml");
    else if(format==="EPS")saveFile(base+".eps",epsText(model,stock,base),"application/postscript");
    else if(format==="PDF")saveFile(base+".pdf",pdfText(model,stock),"application/pdf");
    else {
      const [w,h]=rasterSize(model.originalWidth,model.originalHeight,$("rasterSize").value);
      const canvas=document.createElement("canvas");
      canvas.width=w;canvas.height=h;
      const context=canvas.getContext("2d");
      if(format==="JPG"){context.fillStyle="#ffffff";context.fillRect(0,0,w,h);}
      const url=URL.createObjectURL(new Blob([svgText(model)],{type:"image/svg+xml"}));
      try{
        const image=await loadImage(url);
        context.imageSmoothingQuality="high";
        context.drawImage(image,0,0,w,h);
        saveFile(base+"."+format.toLowerCase(),await rasterBlob(canvas,format));
      }finally{URL.revokeObjectURL(url);}
    }
    notify(`${format} siap diunduh.`);
  }catch(error){notify(error.message);}
}
function batchDownload(){
  const files=jobList.filter(item=>item.result?.layers.length).map((item,i)=>({
    name:`${String(i+1).padStart(2,"0")}-${fileName(item.name)}.svg`,
    text:svgText(item.result,{stock:$("stock").checked})
  }));
  if(files.length)saveFile("vektora-batch.zip",zipFiles(files));
}
function sliceDownload(){
  const item=current(),model=item?.result;
  if(!model?.layers.length)return;
  const rows=label("rows"),columns=label("columns");
  if(![rows,columns].every(value=>Number.isInteger(value)&&value>=1&&value<=8)){notify("Isi 1–8 baris dan kolom.");return;}
  if(rows*columns<2 || rows>model.h || columns>model.w){notify("Gunakan minimal dua sel dan pastikan gambar cukup besar.");return;}
  if(model.points*rows*columns>5500000){notify("Lembar ini terlalu rumit untuk banyak potongan. Kurangi detail atau jumlah sel.");return;}
  const files=[],base=fileName(item.name),w=model.w/columns,h=model.h/rows;
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const x=col*w,y=row*h;
      const crop={x,y,w,h};
      files.push({name:`${base}-${row+1}-${col+1}.svg`,text:svgText(model,{stock:$("stock").checked,crop})});
    }
  }
  saveFile(base+"-potongan.zip",zipFiles(files));
}

$("drop").onclick=$("dockPick").onclick=()=>$("file").click();
$("file").onchange=event=>{addFiles(event.target.files);event.target.value="";};
for(const event of ["dragenter","dragover","dragleave","drop"]){
  $("drop").addEventListener(event,input=>{
    input.preventDefault();
    $("drop").classList.toggle("drag",event==="dragenter"||event==="dragover");
    if(event==="drop")addFiles(input.dataTransfer.files);
  });
}
document.addEventListener("paste",event=>{
  if(studio!=="vector")return;
  const files=Array.from(event.clipboardData?.files??[]).filter(file=>file.type.startsWith("image/"));
  if(files.length){event.preventDefault();addFiles(files);}
});
$("sample").onclick=sample;
$("queue").onchange=()=>selectItem(label("queue"));
$("batchDownload").onclick=batchDownload;
$("run").onclick=()=>run({reveal:true});
$("cancel").onclick=()=>{stopProcessing();renderPreview();status("Proses dibatalkan.");};
$("download").onclick=downloadResult;
$("sliceDownload").onclick=sliceDownload;
$("format").onchange=$("rasterSize").onchange=updateDimensions;
$("stock").onchange=()=>{
  updateDimensions();
  if(current()?.result)$("svgSize").textContent=sizeText(new Blob([svgText(current().result,{stock:$("stock").checked})]).size);
};
$("compareRange").oninput=sizeArtwork;
$("zoomIn").onclick=()=>changeZoom(zoom<2?2:zoom*2);
$("zoomOut").onclick=()=>changeZoom(zoom/2);
$("zoomReset").onclick=()=>changeZoom(1);
new ResizeObserver(sizeArtwork).observe($("canvas"));
function settingsChanged(){
  updateSettings();
  if(current()?.result&&!processing)status("Pengaturan berubah. Ketuk Buat vektor untuk memperbarui hasil.");
}
for(const id of ["detail","colors","threshold","noise","removeWhite","traceHD"])$(id).oninput=settingsChanged;
document.querySelectorAll("[data-mode]").forEach(button=>button.onclick=()=>{mode=button.dataset.mode;settingsChanged();});
document.querySelectorAll("button[data-view]").forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$("help").onclick=()=>$("guide").showModal();
$("closeGuide").onclick=()=>$("guide").close();
const openUtility=setupUtilities({$,notify,saveFile,checkFile,loadImage,rasterBlob,sampleUrl});
document.querySelectorAll("button[data-studio]").forEach(button=>button.onclick=()=>{
  studio=button.dataset.studio;
  document.querySelectorAll("button[data-studio]").forEach(el=>el.setAttribute("aria-pressed",el===button));
  $("vector").hidden=studio!=="vector";
  $("utility").hidden=studio==="vector";
  $("vectorActions").hidden=studio!=="vector";
  $("utilityActions").hidden=studio==="vector";
  if(studio!=="vector")openUtility(studio);
  window.scrollTo(0,0);
});
updateSettings();
sample();
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
