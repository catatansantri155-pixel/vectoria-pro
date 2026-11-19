const gradients={
  dusk:["#2b1558","#cb87ed"],
  sunrise:["#a43f7d","#ffd28c"],
  forest:["#12313c","#9fbb8e"],
  ocean:["#162a69","#60d5df"]
};
const studioCopy={
  upscale:["Perbesar gambar.","Naikkan resolusi hingga 4× dan perjelas tepi yang masih terlihat pada gambar sumber."],
  pattern:["Buat pola berulang.","Ubah gambar menjadi ubin pola untuk latar, kemasan, atau tekstil."],
  gradient:["Rancang gradien.","Pilih dua warna, tambahkan tekstur, lalu ekspor gambar atau video yang berulang."]
};
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function fit(w,h,maxArea,maxEdge){
  const scale=Math.min(1,Math.sqrt(maxArea/(w*h)),maxEdge/Math.max(w,h));
  return [Math.max(1,Math.floor(w*scale)),Math.max(1,Math.floor(h*scale))];
}
function gradientDimensions(ratio,edge){
  return ratio>=1?[edge,Math.round(edge/ratio)]:[Math.round(edge*ratio),edge];
}
function noiseTexture(w,h){
  const values=new Int8Array(w*h);
  let state=0x149b39f2;
  for(let i=0;i<values.length;i++){
    state^=state<<13;state^=state>>>17;state^=state<<5;
    values[i]=(state&255)-128;
  }
  return values;
}
function gradient(canvas,opts,texture,offset=0){
  const {width:w,height:h}=canvas,g=canvas.getContext("2d",{willReadFrequently:Boolean(opts.grain)});
  const direction=(opts.angle+offset)*Math.PI/180;
  const dx=Math.cos(direction),dy=Math.sin(direction);
  const span=(Math.abs(w*dx)+Math.abs(h*dy))/2;
  const paint=g.createLinearGradient(w/2-dx*span,h/2-dy*span,w/2+dx*span,h/2+dy*span);
  paint.addColorStop(0,opts.first);
  paint.addColorStop(1,opts.second);
  g.fillStyle=paint;
  g.fillRect(0,0,w,h);
  if(!opts.grain)return;
  const image=g.getImageData(0,0,w,h),pixels=image.data;
  for(let i=0;i<texture.length;i++){
    const amount=texture[i]*opts.grain/128,j=i*4;
    pixels[j]+=amount;pixels[j+1]+=amount;pixels[j+2]+=amount;
  }
  g.putImageData(image,0,0);
}
function resizeInWorker(image,canvas,sharp,signal){
  const w=image.naturalWidth,h=image.naturalHeight;
  // Downscaled or very large sources use the browser path to bound input-memory costs.
  if(typeof Worker!=="function"||w*h>9e6||canvas.width<w||canvas.height<h){
    const context=canvas.getContext("2d");
    context.imageSmoothingQuality="high";
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return Promise.resolve(false);
  }
  const source=document.createElement("canvas");
  source.width=w;source.height=h;
  const input=source.getContext("2d",{willReadFrequently:true});
  input.drawImage(image,0,0);
  const pixels=input.getImageData(0,0,w,h).data;
  source.width=source.height=0;
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./resample-worker.mjs?v=15",import.meta.url),{type:"module"});
    function close(){
      signal.removeEventListener("abort",cancel);
      worker.terminate();
    }
    function cancel(){
      close();
      reject(new DOMException("Dibatalkan","AbortError"));
    }
    if(signal.aborted){cancel();return;}
    signal.addEventListener("abort",cancel,{once:true});
    worker.onmessage=({data})=>{
      close();
      if(data.error){reject(Error(data.error));return;}
      canvas.getContext("2d").putImageData(new ImageData(data.output,canvas.width,canvas.height),0,0);
      resolve(true);
    };
    worker.onerror=()=>{close();reject(Error("Mesin upscale gagal berjalan di browser ini."));};
    worker.postMessage({pixels,w,h,width:canvas.width,height:canvas.height,sharp},[pixels.buffer]);
  });
}
function pattern(canvas,image,style){
  const w=canvas.width/2,h=canvas.height/2,g=canvas.getContext("2d");
  g.imageSmoothingQuality="high";
  for(let row=0;row<2;row++){
    for(let col=0;col<2;col++){
      g.save();
      const mirror=style==="mirror";
      g.translate((col+(mirror?col:0))*w,(row+(mirror?row:0))*h);
      g.scale(mirror&&col?-1:1,mirror&&row?-1:1);
      g.drawImage(image,0,0,w,h);
      g.restore();
    }
  }
}
function videoType(){
  if(typeof MediaRecorder!=="function"||!HTMLCanvasElement.prototype.captureStream)return "";
  return ["video/webm;codecs=vp8","video/webm","video/mp4"].find(type=>MediaRecorder.isTypeSupported(type))??"";
}
async function recordLoop(opts,mime,onProgress){
  const canvas=document.createElement("canvas");
  [canvas.width,canvas.height]=gradientDimensions(opts.ratio,720);
  const texture=opts.grain?noiseTexture(canvas.width*canvas.height):null;
  gradient(canvas,opts,texture);
  const stream=canvas.captureStream(24);
  let recorder;
  try{
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2400000});
    const chunks=[];
    const done=new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>chunks.length?resolve(new Blob(chunks,{type:recorder.mimeType})):reject(Error("Video kosong."));
      recorder.onerror=()=>reject(Error("Browser gagal merekam video."));
    });
    const started=performance.now(),duration=4000;
    recorder.start();
    function step(now){
      const phase=Math.min(1,(now-started)/duration);
      gradient(canvas,opts,texture,72*Math.sin(phase*Math.PI*2));
      onProgress(phase);
      if(phase<1&&recorder.state==="recording")requestAnimationFrame(step);
      else if(recorder.state==="recording")recorder.stop();
    }
    requestAnimationFrame(step);
    return await done;
  }finally{for(const track of stream.getTracks())track.stop();}
}

export function setupUtilities({$,notify,saveFile,checkFile,loadImage,prepareImageFile,rasterBlob,sampleUrl}){
  let kind="upscale",source=sampleUrl,base="botanika",serial=0,ready=false,lastGradient=null,recording=false;
  const availableVideo=videoType();
  const preview=$("utilityCanvas");
  let output=null,previewSource=null,controller;
  const state=message=>$("utilityStatus").textContent=message;
  function setReady(value){ready=value;$("utilityDownload").disabled=!ready||recording;}
  function paintPreview(){
    if(!output)return;
    const isUpscale=kind==="upscale"&&previewSource;
    const detail=isUpscale&&$("upscaleDetail").checked;
    const [w,h]=detail
      ?[Math.min(480,output.width),Math.min(480,output.height)]
      :fit(output.width,output.height,800**2,800);
    preview.width=w;preview.height=h;
    const context=preview.getContext("2d");
    context.imageSmoothingQuality="high";
    if(!isUpscale){
      context.drawImage(output,0,0,w,h);
      return;
    }
    const cropW=detail?w:output.width,cropH=detail?h:output.height;
    const x=(output.width-cropW)/2,y=(output.height-cropH)/2;
    const original=$("upscalePreviewMode").value==="source";
    const image=original?previewSource:output;
    const scaleX=original?previewSource.naturalWidth/output.width:1;
    const scaleY=original?previewSource.naturalHeight/output.height:1;
    context.drawImage(image,x*scaleX,y*scaleY,cropW*scaleX,cropH*scaleY,0,0,w,h);
  }
  function gradientOptions(){
    const angle=$("angle").valueAsNumber;
    if(!Number.isFinite(angle)||angle<0||angle>=360)throw Error("Arah gradien harus antara 0 dan 359 derajat.");
    return {angle,ratio:Number($("gradientRatio").value),grain:Number($("grain").value),first:$("gradientFirst").value,second:$("gradientSecond").value};
  }
  function setPalette(){
    const [first,second]=gradients[$("gradientPreset").value];
    $("gradientFirst").value=first;
    $("gradientSecond").value=second;
  }
  setPalette();
  async function run(){
    const ticket=++serial;
    const current=kind;
    controller?.abort();
    controller=new AbortController();
    const signal=controller.signal;
    setReady(false);
    if(output){output.width=output.height=0;output=null;}
    previewSource=null;
    state("Menyiapkan pratinjau…");
    await frame();
    if(signal.aborted)return;
    const canvas=document.createElement("canvas");
    let inputImage=null;
    try{
      let capped=false,browserResize=false;
      if(current==="gradient"){
        const options=gradientOptions();
        [canvas.width,canvas.height]=gradientDimensions(options.ratio,1920);
        gradient(canvas,options,options.grain?noiseTexture(canvas.width*canvas.height):null);
        lastGradient=options;
      }else{
        const image=await loadImage(source);
        if(signal.aborted)return;
        inputImage=image;
        const w=image.naturalWidth,h=image.naturalHeight;
        if(current==="pattern"){
          const [width,height]=fit(w,h,2.5e6,2000);
          canvas.width=width*2;canvas.height=height*2;
          pattern(canvas,image,$("patternStyle").value);
        }else{
          const choice=$("upscaleFactor").value;
          const factor=choice==="stock"?Math.max(1,Math.sqrt(4e6/(w*h))):choice==="4k"?4096/Math.max(w,h):Number(choice);
          const width=Math.ceil(w*factor),height=Math.ceil(h*factor);
          [canvas.width,canvas.height]=fit(width,height,16e6,4096);
          capped=canvas.width!==width||canvas.height!==height;
          browserResize=!await resizeInWorker(image,canvas,$("sharpen").checked,signal);
        }
      }
      if(ticket!==serial)return;
      output=canvas;
      previewSource=current==="upscale"?inputImage:null;
      paintPreview();
      const inputSize=previewSource?`${previewSource.naturalWidth} × ${previewSource.naturalHeight} → `:"";
      state(`${inputSize}${output.width.toLocaleString("id-ID")} × ${output.height.toLocaleString("id-ID")} px${capped?" · batas 4K":""}${browserResize?" · interpolasi browser":""}`);
      setReady(true);
    }catch(error){
      if(ticket===serial&&error.name!=="AbortError"){state(error.message);notify(error.message);}
    }finally{if(output!==canvas)canvas.width=canvas.height=0;}
  }
  $("utilityChoose").onclick=()=>$("utilityFile").click();
  $("utilityFile").onchange=async event=>{
    const file=event.target.files[0];
    event.target.value="";
    if(!file)return;
    const error=checkFile(file);
    if(error){notify(error);return;}
    const request=++serial;
    controller?.abort();
    setReady(false);
    try{
      const url=await prepareImageFile(file);
      if(request!==serial){URL.revokeObjectURL(url);return;}
      if(source!==sampleUrl)URL.revokeObjectURL(source);
      source=url;
      base=file.name.replace(/\.[^.]+$/,"").slice(0,100);
      run();
    }catch(error){if(request===serial){state(error.message);notify(error.message);}}
  };
  $("utilitySample").onclick=()=>{
    if(source!==sampleUrl)URL.revokeObjectURL(source);
    source=sampleUrl;base="botanika";
    run();
  };
  $("utilityRun").onclick=run;
  $("upscalePreviewMode").onchange=$("upscaleDetail").onchange=paintPreview;
  $("gradientPreset").onchange=()=>{setPalette();run();};
  for(const id of ["gradientFirst","gradientSecond","gradientRatio","angle","grain","patternStyle","upscaleFactor","sharpen"])$(id).onchange=run;
  $("utilityDownload").onclick=async()=>{
    if(!ready||recording||!output)return;
    const exportCanvas=output;
    const format=$("utilityFormat").value;
    const name=kind==="gradient"?"vektora-gradien":base+(kind==="pattern"?"-ubin":"-diperbesar");
    try{
      if(format==="VIDEO"){
        recording=true;
        setReady(true);
        const ticket=serial;
        const video=await recordLoop(lastGradient,availableVideo,phase=>{if(ticket===serial)state(`Merekam video… ${Math.round(phase*100)}%`);});
        saveFile(name+(video.type.includes("mp4")?".mp4":".webm"),video);
        if(ticket===serial)state("Video loop 4 detik siap diunduh.");
      }else if(format==="JPG"){
        const temp=document.createElement("canvas");
        temp.width=exportCanvas.width;temp.height=exportCanvas.height;
        const context=temp.getContext("2d");
        context.fillStyle="#fff";context.fillRect(0,0,temp.width,temp.height);
        context.drawImage(exportCanvas,0,0);
        try{saveFile(name+".jpg",await rasterBlob(temp,format));}
        finally{temp.width=temp.height=0;}
      }else saveFile(name+".png",await rasterBlob(exportCanvas,format));
    }catch(error){notify(error.message);}
    finally{recording=false;setReady(ready);}
  };
  return function open(studio){
    kind=studio;
    const isGradient=studio==="gradient";
    [$("utilityTitle").textContent,$("utilityDescription").textContent]=studioCopy[studio];
    $("upscaleFields").hidden=$("upscaleCompare").hidden=studio!=="upscale";
    $("patternFields").hidden=studio!=="pattern";
    $("gradientFields").hidden=!isGradient;
    $("utilityChoose").hidden=$("utilitySample").hidden=isGradient;
    $("videoOption").hidden=!isGradient||!availableVideo;
    $("videoOption").disabled=$("videoOption").hidden;
    $("utilityFormat").value="PNG";
    run();
  };
}
