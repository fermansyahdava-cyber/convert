const input = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const chooseBtn = document.getElementById("chooseBtn");
const formatSelect = document.getElementById("formatSelect");
const convertBtn = document.getElementById("convertBtn");
const fileInfo = document.getElementById("fileInfo");
const errorMessage = document.getElementById("errorMessage");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const statusText = document.getElementById("statusText");
const percentText = document.getElementById("percentText");
const result = document.getElementById("result");
let selectedFile = null;
let outputUrl = null;

const formatBytes = bytes => bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024/1024).toFixed(2)} MB`;
function showError(message){errorMessage.textContent=message;errorMessage.classList.remove("hidden")}
function clearError(){errorMessage.textContent="";errorMessage.classList.add("hidden")}
function setProgress(percent,text){progressWrap.classList.remove("hidden");progressBar.style.width=`${percent}%`;percentText.textContent=`${Math.round(percent)}%`;statusText.textContent=text}
function clearResult(){result.classList.add("hidden");if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null}}
function updateHint(){
  const fmt=formatSelect.value;
  const isMp3=selectedFile?.name.toLowerCase().endsWith(".mp3");
  document.getElementById("formatHint").textContent = fmt==="wav"
    ? (isMp3 ? "MP3 → WAV: mengubah audio MP3 menjadi file WAV." : "MP4 → WAV: mengambil audio dari video lalu menyimpannya sebagai WAV.")
    : (isMp3 ? "MP3 → MP3: file tidak perlu dikonversi; pilih WAV untuk mengubah format." : "MP4 → MP3: mengambil audio dari video dan menyimpannya sebagai MP3.");
}
function chooseFile(file){
  clearError();clearResult();progressWrap.classList.add("hidden");
  if(!file)return;
  const name=file.name.toLowerCase();
  if(!name.endsWith(".mp4")&&!name.endsWith(".mp3")){showError("Format belum didukung. Pilih file MP4 atau MP3.");return}
  selectedFile=file;
  document.getElementById("fileName").textContent=file.name;
  document.getElementById("fileSize").textContent=formatBytes(file.size);
  document.getElementById("fileIcon").textContent=name.endsWith(".mp4")?"MP4":"MP3";
  fileInfo.classList.remove("hidden");dropzone.classList.add("has-file");
  formatSelect.value=name.endsWith(".mp4")?"mp3":"wav";
  convertBtn.disabled=false;updateHint();
}
chooseBtn.addEventListener("click",e=>{e.stopPropagation();input.click()});
dropzone.addEventListener("click",e=>{if(e.target!==chooseBtn)input.click()});
dropzone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.click()}});
input.addEventListener("change",()=>chooseFile(input.files[0]));
document.getElementById("removeBtn").addEventListener("click",()=>{selectedFile=null;input.value="";fileInfo.classList.add("hidden");convertBtn.disabled=true;clearResult();clearError();progressWrap.classList.add("hidden")});
formatSelect.addEventListener("change",updateHint);
["dragenter","dragover"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add("dragover")}));
["dragleave","drop"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove("dragover")}));
dropzone.addEventListener("drop",e=>chooseFile(e.dataTransfer.files[0]));

function decodeAudio(file){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw new Error("Browser ini belum mendukung Web Audio API. Coba Chrome atau Edge versi terbaru.");
  const ctx=new AudioContextClass();
  return file.arrayBuffer().then(buffer=>ctx.decodeAudioData(buffer)).finally(()=>ctx.close());
}
function audioBufferToWav(buffer){
  const channels=buffer.numberOfChannels, length=buffer.length, sampleRate=buffer.sampleRate;
  const bytesPerSample=2, blockAlign=channels*bytesPerSample;
  const out=new ArrayBuffer(44+length*blockAlign), view=new DataView(out);
  const write=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i))};
  write(0,"RIFF");view.setUint32(4,36+length*blockAlign,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*blockAlign,true);view.setUint16(32,blockAlign,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,length*blockAlign,true);
  let offset=44;
  for(let i=0;i<length;i++)for(let ch=0;ch<channels;ch++){
    let sample=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));
    view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true);offset+=2;
  }
  return new Blob([out],{type:"audio/wav"});
}
async function audioBufferToMp3(buffer,onProgress){
  if(!window.lamejs)throw new Error("Encoder MP3 belum termuat. Periksa koneksi internet, lalu muat ulang halaman.");
  const channels=Math.min(2,buffer.numberOfChannels), sampleRate=buffer.sampleRate;
  const encoder=new lamejs.Mp3Encoder(channels,sampleRate,128);
  const left=buffer.getChannelData(0);
  const right=channels===2?buffer.getChannelData(1):null;
  const chunkSize=1152, chunks=[];
  const toInt16=(data,start,end)=>{const out=new Int16Array(end-start);for(let i=start;i<end;i++){let s=Math.max(-1,Math.min(1,data[i]));out[i-start]=s<0?s*32768:s*32767}return out};
  for(let i=0;i<left.length;i+=chunkSize){
    const end=Math.min(i+chunkSize,left.length);
    const l=toInt16(left,i,end), r=right?toInt16(right,i,end):null;
    const encoded=channels===2?encoder.encodeBuffer(l,r):encoder.encodeBuffer(l);
    if(encoded.length)chunks.push(new Uint8Array(encoded));
    if(i%(chunkSize*100)===0){onProgress(15+70*(i/left.length));await new Promise(resolve=>setTimeout(resolve,0))}
  }
  const tail=encoder.flush();if(tail.length)chunks.push(new Uint8Array(tail));
  return new Blob(chunks,{type:"audio/mpeg"});
}
convertBtn.addEventListener("click",async()=>{
  if(!selectedFile)return;
  clearError();clearResult();convertBtn.disabled=true;
  const target=formatSelect.value, source=selectedFile.name.toLowerCase();
  try{
    if(source.endsWith(".mp3")&&target==="mp3"){
      const blob=new Blob([await selectedFile.arrayBuffer()],{type:"audio/mpeg"});
      finish(blob,"mp3");return;
    }
    setProgress(3,"Membaca file...");
    const buffer=await decodeAudio(selectedFile);
    setProgress(12,"Mengonversi audio...");
    let blob;
    if(target==="wav"){
      blob=audioBufferToWav(buffer);setProgress(95,"Menyiapkan file WAV...");
    }else{
      blob=await audioBufferToMp3(buffer,p=>setProgress(p,"Mengenkode MP3..."));
      setProgress(95,"Menyiapkan file MP3...");
    }
    finish(blob,target);
  }catch(err){
    showError("Konversi gagal: "+(err.message||"format file tidak dapat dibaca")+". Coba file lain atau gunakan Chrome/Edge terbaru.");
    progressWrap.classList.add("hidden");convertBtn.disabled=false;
  }
});
function finish(blob,extension){
  if(outputUrl)URL.revokeObjectURL(outputUrl);
  outputUrl=URL.createObjectURL(blob);
  const original=selectedFile.name.replace(/\.[^.]+$/,"").replace(/[^\w\- ()]+/g,"_");
  const filename=`${original}.${extension}`;
  document.getElementById("resultName").textContent=filename+" • "+formatBytes(blob.size);
  const link=document.getElementById("downloadBtn");link.href=outputUrl;link.download=filename;
  result.classList.remove("hidden");setProgress(100,"Selesai");convertBtn.disabled=false;
}
