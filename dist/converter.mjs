import {epsText,outputSize,pdfText,rasterSize,svgText,traceSize,zipFiles} from "./formats.mjs?v=17";
import {setupUtilities} from "./utilities.mjs?v=14";
import {loadImage,prepareImageFile} from "./image-codec.mjs?v=14";
import {detectIcons,detectInkPaper,gridIcons,removeBorderColor} from "./sheet.mjs?v=17";
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
function checkFile(file){
  if(!allowed.test(file.name)&&!file.type.startsWith("image/"))return "Format dicoba: JPG, PNG, WebP, BMP, GIF, atau AVIF.";
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
let worker=null,pending=null,processing=false;
let sheetPlan=null,sheetBusy=false,sheetRequest=0;
let previewAsset=null;
const levels=[1,1.5,2,3,4,6,8];
let panX=0,panY=0,pan=null;
const current=()=>jobList[selected];
const label=id=>Number($(id).value);
const settings=()=>({
  mode,colors:label("colors"),threshold:label("threshold"),detail:label("detail"),noise:label("noise"),
  removeWhite:$("removeWhite").checked,hd:$("traceHD").checked,smooth:$("smoothCurves").checked,
  profile:$("traceProfile").value,monoBackground:$("monoBackground").value,monoAuto:$("monoAuto").checked,monoInvert:$("monoPolarity").value==="light"
});
const exactMode=options=>options.mode==="color"&&options.profile==="exact";
function sampleSize(w,h,options){
  if(!exactMode(options))return traceSize(w,h,options.detail,options.hd);
  if(w*h>4.5e6||Math.max(w,h)>8192)throw Error("Presisi piksel mendukung gambar hingga 4,5 MP dan 8.192 px per sisi. Bagi gambar atau pilih Otomatis.");
  return [w,h];
}
const detailNames=["Sederhana","Ringan","Seimbang","Detail tinggi","Sangat detail"];
function updateSettings(){
  for(const key of ["colors","threshold","noise"])$(key+"Out").textContent=$(key).value;
  $("detailOut").textContent=detailNames[label("detail")];
  const exact=exactMode(settings());
  $("exactHelp").hidden=!exact;
  for(const id of ["detailControl","hdControl","smoothControl","advanced"])$(id).hidden=exact;
  $("colorControls").hidden=$("removeWhiteControl").hidden=mode!=="color";
  $("thresholdControl").hidden=$("monoAuto").checked;
  $("profileControl").hidden=mode!=="color";
  $("monoControls").hidden=mode!=="mono";
  document.querySelectorAll("[data-mode]").forEach(el=>el.setAttribute("aria-pressed",el.dataset.mode===mode));
}
function status(message){$("status").textContent=message;}
function refreshButtons(){
  const item=current(),has=Boolean(item?.result);
  $("run").disabled=processing||sheetBusy||!jobList.length;
  $("cancel").hidden=!processing;
  $("progressBox").hidden=!processing;
  $("run").lastChild.textContent=jobList.length>1?`Proses ${jobList.length} gambar`:"Buat vektor";
  $("download").disabled=!has||!item.result.layers.length;
  $("slice").hidden=!item?.w;
  $("sliceScan").disabled=processing||sheetBusy;
  $("sliceDownload").disabled=processing||sheetBusy||!sheetPlan?.boxes.length;
  for(const id of ["sliceMethod","sliceFormat","sliceBackground","columns","rows"])$(id).disabled=sheetBusy;
  $("sliceCancel").hidden=!sheetBusy;
  $("sliceProgress").hidden=!sheetBusy;
  $("batchDownload").disabled=processing||!jobList.some(entry=>entry.result?.layers.length);
  $("zoomIn").disabled=zoom>=8||!item;
  $("zoomOut").disabled=zoom<=1||!item;
  $("zoomLevel").disabled=!item?.w;
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
  canvas.style.setProperty("--art-width",width*zoom+"px");
  canvas.style.setProperty("--art-height",height*zoom+"px");
  canvas.style.setProperty("--image-split",((split-.5)*canvas.clientWidth/(width*zoom)+.5)*100+"%");
  const limitX=Math.max(0,(width*zoom-canvas.clientWidth)/2);
  const limitY=Math.max(0,(height*zoom-canvas.clientHeight)/2);
  panX=Math.max(-limitX,Math.min(limitX,panX));
  panY=Math.max(-limitY,Math.min(limitY,panY));
  canvas.style.setProperty("--pan-x",panX+"px");
  canvas.style.setProperty("--pan-y",panY+"px");
  canvas.dataset.pan=String(canvas.dataset.view!=="compare"&&zoom>1);
  $("zoomLevel").value=String(zoom);
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
function renderVector(model){
  const container=$("result"),outlines=view==="outline";
  if(previewAsset){
    if(previewAsset.model===model&&previewAsset.outlines===outlines)return;
    URL.revokeObjectURL(previewAsset.url);
    previewAsset=null;
  }
  if(!model){container.replaceChildren();return;}
  if(model.exact&&model.layers.length>10000){
    const url=URL.createObjectURL(new Blob([svgText(model,{outlines})],{type:"image/svg+xml"}));
    const image=new Image();
    image.alt="";
    image.src=url;
    container.replaceChildren(image);
    previewAsset={model,outlines,url};
  }else container.innerHTML=svgText(model,{preview:true,outlines});
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
  renderVector(result);
  if(result){
    $("objects").textContent=count(result.objects);
    $("points").textContent=count(result.points);
    $("svgSize").textContent=sizeText(new Blob([svgText(result,{stock:$("stock").checked})]).size);
  }
  document.querySelectorAll("button[data-view]").forEach(button=>{
    button.setAttribute("aria-pressed",button.dataset.view===view);
    button.disabled=!result;
  });
  $("fileInfo").hidden=!item;
  if(item){
    $("fileName").textContent=item.name;
    $("fileSize").textContent=ready?`${count(item.w)} × ${count(item.h)} px · ${item.size?sizeText(item.size):"Gambar contoh"}`:item.error??"Memuat…";
  }
  if(!processing)status(item?.error??(result?(result.layers.length?(result.gradients?"Hasil gradasi vektor siap diperiksa dan diunduh.":"Hasil siap diperiksa dan diunduh."):"Hasil kosong. Atur ambang atau gunakan mode warna."):"Pilih gambar atau gunakan contoh."));
  if(item&&!processing&&ready&&!result&&!item.error)status("Gambar siap. Ketuk Buat vektor.");
  updateDimensions();
  refreshButtons();
  sizeArtwork();
}
async function inspect(item){
  if(item.w)return;
  if(!item.source){
    item.source=(async()=>{
      if(item.file&&!item.url){
        const url=await prepareImageFile(item.file);
        if(!jobList.includes(item)){
          URL.revokeObjectURL(url);
          throw Error("Gambar sudah diganti.");
        }
        item.url=url;
      }
      const image=await loadImage(item.url);
      item.w=image.naturalWidth;
      item.h=image.naturalHeight;
    })().catch(error=>{item.source=null;throw error;});
  }
  await item.source;
}
async function selectItem(index){
  selected=index;
  zoom=1;
  panX=panY=0;
  resetSheet();
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
  for(const item of jobList)if(item.local&&item.url)URL.revokeObjectURL(item.url);
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
    accepted.push({name:file.name==="gambar"?"gambar-tempel.png":file.name,file,local:true,size:file.size});
  }
  if(firstError)notify(firstError);
  else if(files.length>30)notify("Maksimal 30 gambar per proses. Tiga puluh file pertama ditambahkan.");
  if(accepted.length)replaceItems(accepted);
}
function trace(pixels,w,h,options,progress){
  if(!worker){
    worker=new Worker(new URL("./trace-worker.mjs?v=18",import.meta.url),{type:"module"});
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
  const [width,height]=sampleSize(item.w,item.h,options);
  let image=await imageFrame(item.url);
  if(token!==serial){image.close?.();throw new DOMException("Dibatalkan","AbortError");}
  const canvas=document.createElement("canvas");
  const context=canvas.getContext("2d",{willReadFrequently:true});
  function sample(w,h){
    canvas.width=w;canvas.height=h;
    context.imageSmoothingQuality="high";
    context.drawImage(image,0,0,w,h);
    return context.getImageData(0,0,w,h).data;
  }
  let pixels;
  try{
    // Use native edges and color samples for ink on paper before upsampling can alter them.
    if(options.mode==="color"&&(options.profile==="auto"||options.profile==="flat")&&width>item.w&&height>item.h){
      const native=sample(item.w,item.h);
      if(detectInkPaper(native,item.w,item.h))pixels=native;
    }
    pixels??=sample(width,height);
  }finally{image.close?.();image=null;}
  const result=await trace(pixels,canvas.width,canvas.height,options,progress);
  result.originalWidth=item.w;
  result.originalHeight=item.h;
  return result;
}
async function run({reveal=false}={}){
  if(processing||sheetBusy||!jobList.length)return;
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
  if(view==="compare")panX=panY=0;
  renderPreview();
}
function changeZoom(value){
  if(!levels.includes(value))return;
  zoom=value;
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
      const url=URL.createObjectURL(new Blob([svgText(model,{dimensions:[w,h]})],{type:"image/svg+xml"}));
      try{
        const image=await loadImage(url,{exporting:true});
        context.imageSmoothingQuality="high";
        context.drawImage(image,0,0,w,h);
        saveFile(base+"."+format.toLowerCase(),await rasterBlob(canvas,format));
      }finally{URL.revokeObjectURL(url);}
    }
    notify(model.gradients&&["EPS","PDF"].includes(format)?`${format} diunduh dengan warna datar. Gunakan SVG untuk mempertahankan gradasi.`:`${format} siap diunduh.`);
  }catch(error){notify(error.message);}
}
function batchDownload(){
  const files=jobList.filter(item=>item.result?.layers.length).map((item,i)=>({
    name:`${String(i+1).padStart(2,"0")}-${fileName(item.name)}.svg`,
    text:svgText(item.result,{stock:$("stock").checked})
  }));
  if(files.length)saveFile("vektora-batch.zip",zipFiles(files));
}
function renderSheetBoxes(){
  const overlay=$("sliceOverlay"),show=Boolean(sheetPlan&&$("sliceShowBoxes").checked&&$("slice").open);
  $("sliceShow").hidden=!sheetPlan;
  overlay.hidden=!show;
  if(!show){overlay.replaceChildren();return;}
  const {item,boxes}=sheetPlan;
  overlay.setAttribute("viewBox",`0 0 ${item.w} ${item.h}`);
  overlay.innerHTML=boxes.map(({x,y,w,h})=>`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
}
function setSheetMessage(message){$("sliceStatus").textContent=message;}
function resetSheet(){
  sheetRequest++;
  if(sheetBusy)stopProcessing();
  sheetBusy=false;
  sheetPlan=null;
  renderSheetBoxes();
  setSheetMessage("Pindai lembar untuk memastikan jumlah ikon.");
  refreshButtons();
}
async function scanSheet(){
  const item=current();
  if(!item?.w||processing||sheetBusy)return;
  const request=++sheetRequest,method=$("sliceMethod").value;
  sheetPlan=null;
  renderSheetBoxes();
  $("sliceScan").disabled=true;
  $("sliceDownload").disabled=true;
  setSheetMessage("Memindai posisi ikon…");
  try{
    const image=await loadImage(item.url);
    if(request!==sheetRequest)return;
    const sample=document.createElement("canvas");
    const scale=Math.min(1,1500/Math.max(item.w,item.h));
    sample.width=Math.max(1,Math.round(item.w*scale));
    sample.height=Math.max(1,Math.round(item.h*scale));
    const context=sample.getContext("2d",{willReadFrequently:true});
    context.drawImage(image,0,0,sample.width,sample.height);
    const pixels=context.getImageData(0,0,sample.width,sample.height);
    let boxes,background,inkPaper;
    if(method==="auto"){
      const found=detectIcons(pixels.data,sample.width,sample.height);
      ({background,inkPaper}=found);
      if(found.boxes.length<2)throw Error("Kurang dari dua ikon terpisah terdeteksi. Periksa jarak antarikon atau pilih kisi manual.");
      boxes=found.boxes.map(({x,y,w,h})=>({
        x:Math.floor(x*item.w/sample.width),y:Math.floor(y*item.h/sample.height),
        w:Math.min(item.w,Math.ceil((x+w)*item.w/sample.width))-Math.floor(x*item.w/sample.width),
        h:Math.min(item.h,Math.ceil((y+h)*item.h/sample.height))-Math.floor(y*item.h/sample.height)
      }));
    }else{
      const rows=label("rows"),columns=label("columns");
      if(![rows,columns].every(value=>Number.isInteger(value)&&value>=1&&value<=20)||
        rows*columns<2||rows>item.h||columns>item.w)throw Error("Masukkan 1–20 baris dan kolom, dengan minimal 2 sel.");
      boxes=gridIcons(item.w,item.h,rows,columns);
      try{({background,inkPaper}=detectIcons(pixels.data,sample.width,sample.height));}catch{}
    }
    if(request!==sheetRequest)return;
    sheetPlan={item,boxes,background,inkPaper};
    renderSheetBoxes();
    setSheetMessage(`${count(boxes.length)} ${method==="auto"?"ikon terdeteksi":"potongan kisi siap"}.`);
  }catch(error){if(request===sheetRequest)setSheetMessage(error.message);}
  finally{if(request===sheetRequest)refreshButtons();}
}

async function pngFromIcon(model,background){
  const [w,h]=rasterSize(model.originalWidth,model.originalHeight,"1024");
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  const url=URL.createObjectURL(new Blob([svgText(model,{dimensions:[w,h],background})],{type:"image/svg+xml"}));
  try{
    const image=await loadImage(url,{exporting:true});
    canvas.getContext("2d").drawImage(image,0,0,w,h);
    return new Uint8Array(await (await rasterBlob(canvas,"PNG")).arrayBuffer());
  }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
}

async function sliceDownload(){
  if(!sheetPlan||sheetBusy||processing)return;
  const {item,boxes,background,inkPaper}=sheetPlan,format=$("sliceFormat").value;
  const outputBackground=$("sliceBackground").value,method=$("sliceMethod").value;
  const isolatedPaper=outputBackground==="source"?null:inkPaper;
  const config={...settings(),removeWhite:false,monoBackground:"transparent",
    ...(mode==="mono"?{}:{isolatedPaper})};
  const stock=$("stock").checked,base=fileName(item.name);
  sheetBusy=true;
  const request=++sheetRequest;
  $("sliceProgress").value=0;
  refreshButtons();
  let index=0,bytesTotal=0;
  const files=[];
  try{
    const image=await loadImage(item.url);
    const canvas=document.createElement("canvas");
    const context=canvas.getContext("2d",{willReadFrequently:true});
    for(const box of boxes){
      if(request!==sheetRequest)return;
      index++;
      setSheetMessage(`Memproses ikon ${index} dari ${boxes.length}…`);
      [canvas.width,canvas.height]=sampleSize(box.w,box.h,config);
      context.imageSmoothingQuality="high";
      context.drawImage(image,box.x,box.y,box.w,box.h,0,0,canvas.width,canvas.height);
      const raw=context.getImageData(0,0,canvas.width,canvas.height).data;
      if(outputBackground!=="source"&&!isolatedPaper)removeBorderColor(raw,canvas.width,canvas.height,background,exactMode(config)?0:24);
      const model=await trace(raw,canvas.width,canvas.height,config,()=>{});
      if(request!==sheetRequest)return;
      if(!model.layers.length){
        if(method==="grid")continue;
        throw Error(`Ikon ${index} kosong setelah diproses. Periksa kisi atau coba dengan latar polos tetap ditampilkan.`);
      }
      model.originalWidth=box.w;model.originalHeight=box.h;
      const name=`${base}-${String(index).padStart(3,"0")}.${format.toLowerCase()}`;
      if(format==="PNG"){
        const bytes=await pngFromIcon(model,outputBackground);
        files.push({name,bytes});
        bytesTotal+=bytes.length;
      }else{
        const text=svgText(model,{stock,background:outputBackground});
        files.push({name,text});
        bytesTotal+=text.length;
      }
      if(bytesTotal>120e6)throw Error("Arsip melebihi 120 MB. Pilih SVG atau bagi lembar menjadi beberapa bagian.");
      $("sliceProgress").value=index/boxes.length;
    }
    if(request!==sheetRequest)return;
    if(!files.length)throw Error("Tidak ada ikon yang dapat diunduh.");
    saveFile(base+"-ikon.zip",zipFiles(files));
    const backgroundLabel={transparent:"transparan",white:"putih",source:"sumber"}[outputBackground];
    const backgroundNote=outputBackground!=="source"&&!background?" Latar polos dari sumber tidak terdeteksi.":"";
    setSheetMessage(`${count(files.length)} file ${format} dengan latar ${backgroundLabel} dimasukkan ke ZIP.${backgroundNote}`);
  }catch(error){if(request===sheetRequest)setSheetMessage(error.message);}
  finally{
    if(request===sheetRequest){
      sheetBusy=false;
      refreshButtons();
    }
  }
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
$("sliceScan").onclick=scanSheet;
$("slice").ontoggle=$("sliceShowBoxes").onchange=renderSheetBoxes;
$("sliceCancel").onclick=()=>{
  sheetRequest++;
  sheetBusy=false;
  stopProcessing();
  setSheetMessage("Ekspor dibatalkan. Hasil pemindaian masih siap.");
  refreshButtons();
};
$("sliceMethod").onchange=()=>{
  $("gridFields").hidden=$("sliceMethod").value!=="grid";
  resetSheet();
};
$("rows").oninput=$("columns").oninput=resetSheet;
$("format").onchange=$("rasterSize").onchange=updateDimensions;
$("stock").onchange=()=>{
  updateDimensions();
  if(current()?.result)$("svgSize").textContent=sizeText(new Blob([svgText(current().result,{stock:$("stock").checked})]).size);
};
$("compareRange").oninput=sizeArtwork;
$("zoomIn").onclick=()=>changeZoom(levels[levels.indexOf(zoom)+1]);
$("zoomOut").onclick=()=>changeZoom(levels[levels.indexOf(zoom)-1]);
$("zoomLevel").onchange=()=>changeZoom(label("zoomLevel"));
$("canvas").onpointerdown=event=>{
  if($("canvas").dataset.pan!=="true"||event.button!==0)return;
  pan={id:event.pointerId,x:event.clientX-panX,y:event.clientY-panY};
  $("canvas").setPointerCapture(event.pointerId);
};
$("canvas").onpointermove=event=>{
  if(pan?.id!==event.pointerId)return;
  panX=event.clientX-pan.x;panY=event.clientY-pan.y;
  sizeArtwork();
};
$("canvas").onlostpointercapture=() => {pan=null;};
new ResizeObserver(sizeArtwork).observe($("canvas"));
function settingsChanged(){
  updateSettings();
  if(current()?.result&&!processing)status("Pengaturan berubah. Ketuk Buat vektor untuk memperbarui hasil.");
}
for(const id of ["detail","colors","threshold","noise","removeWhite","traceHD","smoothCurves","traceProfile","monoAuto","monoPolarity","monoBackground"])$(id).oninput=settingsChanged;
document.querySelectorAll("[data-mode]").forEach(button=>button.onclick=()=>{mode=button.dataset.mode;settingsChanged();});
document.querySelectorAll("button[data-view]").forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$("help").onclick=()=>$("guide").showModal();
$("closeGuide").onclick=()=>$("guide").close();
const openUtility=setupUtilities({$,notify,saveFile,checkFile,loadImage,prepareImageFile,rasterBlob,sampleUrl});
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
