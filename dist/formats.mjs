const encoder=new TextEncoder();
const round=value=>Number(value.toFixed(5));
export function outputSize(w,h,stock){
  if(!stock)return [w,h];
  const scale=Math.sqrt(16e6/(w*h));
  return [Math.max(1,Math.ceil(w*scale)),Math.max(1,Math.ceil(h*scale))];
}
export function rasterSize(w,h,preset){
  const longest = Math.max(w,h);
  const requested = preset==="native" ? longest : Number(preset);
  const edge = Math.min(4096,requested);
  const scale = edge/longest;
  return [Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))];
}
export function traceSize(w,h,detail,hd){
  const edgeLimit = hd ? [700,1050,1600,2000,2400][detail] : [450,700,1000,1350,1750][detail];
  const scale = Math.min(hd?2:1,edgeLimit/Math.max(w,h),Math.sqrt(4.5e6/(w*h)));
  return [Math.max(1,Math.floor(w*scale)),Math.max(1,Math.floor(h*scale))];
}
const sequence=ring=>"M"+ring.map(([x,y])=>x+" "+y).join("L")+"Z";
export function svgText(model,options={}){
  const {w,h,layers}=model;
  const crop=options.crop??{x:0,y:0,w,h};
  const [width,height]=options.crop
    ? outputSize(Math.round(crop.w),Math.round(crop.h),options.stock)
    : outputSize(model.originalWidth??w,model.originalHeight??h,options.stock);
  const dim=options.preview ? "" : ` width="${width}" height="${height}"`;
  const shapes=layers.map(({fill,rings})=>{
    const paths=rings.filter(ring=>!options.crop||intersects(ring,crop)).map(sequence).join("");
    if(!paths)return "";
    const paint=options.outlines ? `fill="none" stroke="${fill}" stroke-width="${round(Math.max(w,h)/545)}"` : `fill="${fill}" stroke="${fill}" stroke-width="0.36" stroke-linejoin="round"`;
    return `<path ${paint} d="${paths}"/>`;
  }).join("");
  const content=options.crop
    ? `<defs><clipPath id="tile"><rect width="${crop.w}" height="${crop.h}"/></clipPath></defs><g clip-path="url(#tile)"><g transform="translate(${-crop.x} ${-crop.y})">${shapes}</g></g>`
    : shapes;
  return `<svg xmlns="http://www.w3.org/2000/svg"${dim} viewBox="0 0 ${crop.w} ${crop.h}" fill-rule="evenodd">${content}</svg>`;
}
function intersects(ring,crop) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of ring){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return left<crop.x+crop.w&&right>crop.x&&top<crop.y+crop.h&&bottom>crop.y;
}
const rgb=fill=>[1,3,5].map(i=>round(parseInt(fill.slice(i,i+2),16)/255)).join(" ");
function drawCommands(layers,pdf){
  const cmd=[];
  for(const {fill,rings} of layers){
    cmd.push(rgb(fill)+(pdf?" rg":" setrgbcolor\nnewpath"));
    for(const ring of rings){
      for(let i=0;i<ring.length;i++) cmd.push(ring[i].join(" ")+(pdf?(i?" l":" m"):(i?" lineto":" moveto")));
      cmd.push(pdf?"h":"closepath");
    }
    cmd.push(pdf?"f*":"eofill");
  }
  return cmd.join("\n");
}
function outputTitle(name){
  return name.replace(/[^a-z0-9 ._-]/gi,"-").slice(0,110)||"vektora";
}
export function epsText(model,stock,name){
  const [w,h]=outputSize(model.originalWidth??model.w,model.originalHeight??model.h,stock);
  return `%!PS-Adobe-3.0 EPSF-3.0
%%Title: ${outputTitle(name)}
%%BoundingBox: 0 0 ${w} ${h}
%%Pages: 1
%%LanguageLevel: 2
%%EndComments
gsave
0 ${h} translate
${round(w/model.w)} ${round(-h/model.h)} scale
${drawCommands(model.layers,false)}
grestore
%%EOF
`;
}
export function pdfText(model,stock){
  const [w,h]=outputSize(model.originalWidth??model.w,model.originalHeight??model.h,stock);
  const stream=`q\n${round(w/model.w)} 0 0 ${round(-h/model.h)} 0 ${h} cm\n${drawCommands(model.layers,true)}\nQ\n`;
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
  ];
  let pdf="%PDF-1.4\n";
  const index=[];
  for(const object of objects){
    index.push(pdf.length);
    pdf+=`${index.length} 0 obj\n${object}\nendobj\n`;
  }
  const offset=pdf.length;
  pdf+="xref\n0 5\n0000000000 65535 f \n";
  for(const position of index) pdf+=String(position).padStart(10,"0")+" 00000 n \n";
  return pdf+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
}
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++) value=value&1?0xedb88320^(value>>>1):value>>>1;
  return value;
});
function crc32(bytes){
  let sum=0xffffffff;
  for(const byte of bytes)sum=CRC_TABLE[(sum^byte)&255]^(sum>>>8);
  return (sum^0xffffffff)>>>0;
}
export function zipFiles(files){
  const contents=[],directory=[];
  let offset=0,directorySize=0;
  for(const {name,text} of files){
    const title=encoder.encode(name),body=encoder.encode(text),checksum=crc32(body);
    const header=new Uint8Array(30),entry=new Uint8Array(46);
    const h=new DataView(header.buffer),d=new DataView(entry.buffer);
    h.setUint32(0,0x04034b50,true);
    h.setUint16(4,20,true);
    h.setUint16(6,0x800,true);
    h.setUint16(12,33,true);
    h.setUint32(14,checksum,true);
    h.setUint32(18,body.length,true);
    h.setUint32(22,body.length,true);
    h.setUint16(26,title.length,true);
    d.setUint32(0,0x02014b50,true);
    d.setUint16(4,20,true);
    entry.set(header.subarray(4,30),6);
    d.setUint32(42,offset,true);
    contents.push(header,title,body);
    directory.push(entry,title);
    offset+=header.length+title.length+body.length;
    directorySize+=entry.length+title.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);
  e.setUint16(8,files.length,true);
  e.setUint16(10,files.length,true);
  e.setUint32(12,directorySize,true);
  e.setUint32(16,offset,true);
  return new Blob([...contents,...directory,end],{type:"application/zip"});
}
