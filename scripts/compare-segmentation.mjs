// Paired SlimSAM / SAM 2.1 diagnostic run. Reference-mask accuracy is reported only
// when reviewed annotations are supplied; cross-model agreement is not ground truth.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const base = process.env.BASE || 'http://localhost:5173';
const samples = JSON.parse(await (await import('node:fs/promises')).readFile('src/samples/samples.json', 'utf8'));
const selected = process.argv.slice(2);
const chosen = selected.length ? samples.filter(s => selected.includes(s.id)) : samples;
const out = 'eval-out/segmentation-comparison';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const csv = ['sample,backend,status,labels,mask_count,mean_score,mean_area_fraction,load_ms,embed_ms,segment_ms,wall_ms,downloaded_bytes'];
const enc = (x) => (x ?? '').replaceAll('"','""');

async function run(sample, backend) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  let downloaded = 0;
  page.on('response', async response => {
    try { if (response.request().resourceType() === 'fetch' || response.request().resourceType() === 'xhr') {
      const h = await response.allHeaders(); downloaded += Number(h['content-length'] || 0);
    }} catch {}
  });
  const started = Date.now();
  try {
    await page.goto(`${base}/?sample=${encodeURIComponent(sample.id)}&sam=${backend === 'sam2' ? 'sam2' : 'slimsam'}`);
    await page.waitForFunction(() => /Done in|Something went wrong|could not run/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 360000 });
    const data = await page.evaluate(() => {
      const s = window.__touchsight, a = s?.analysis;
      if (!a) return { error: document.querySelector('#status')?.textContent || 'No analysis state' };
      const labels = a.labels.map((L, i) => {
        const mask = L.mask;
        let area = 0, png = null;
        if (mask) {
          for (let j = 0; j < mask.length; j++) area += mask[j] ? 1 : 0;
          const c = document.createElement('canvas'); c.width = a.W; c.height = a.H;
          const ctx = c.getContext('2d'), im = ctx.createImageData(a.W, a.H);
          for (let j = 0; j < mask.length; j++) { const v = mask[j] ? 255 : 0; const k = j * 4; im.data[k]=im.data[k+1]=im.data[k+2]=v; im.data[k+3]=255; }
          ctx.putImageData(im, 0, 0); png = c.toDataURL('image/png').split(',')[1];
        }
        return { index:i, text:L.text, score:L.maskScore ?? 0, area, areaFraction: area/(a.W*a.H), png };
      });
      return { width:a.W,height:a.H,backend:a.segmentationBackend,device:a.device,timings:a.timings,labels,
        status:document.querySelector('#status')?.textContent || '',
        memoryBytes:performance.memory?.usedJSHeapSize ?? null };
    });
    for (const label of data.labels || []) if (label.png) {
      await writeFile(`${out}/${sample.id}-${backend}-${String(label.index).padStart(2,'0')}.png`, Buffer.from(label.png,'base64'));
      delete label.png;
    }
    const row = { sample:sample.id,backend,wallMs:Date.now()-started,downloadedBytes:downloaded,...data };
    results.push(row);
    csv.push([sample.id,backend,data.error?'error':'ok',(data.labels||[]).length,(data.labels||[]).filter(x=>x.area).length,
      mean((data.labels||[]).map(x=>x.score)),mean((data.labels||[]).map(x=>x.areaFraction)),
      data.timings?.load ?? '',data.timings?.sam_embed ?? '',data.timings?.sam_parts ?? '',row.wallMs,downloaded].join(','));
    console.log(JSON.stringify({sample:sample.id,backend,status:data.error||'ok',labels:(data.labels||[]).length,
      meanScore:mean((data.labels||[]).map(x=>x.score)),timings:data.timings,wallMs:row.wallMs,downloadedBytes:downloaded}));
  } catch (error) {
    const row={sample:sample.id,backend,error:String(error?.stack||error),wallMs:Date.now()-started};
    results.push(row); csv.push([sample.id,backend,'error'].join(',')); console.error(JSON.stringify(row));
  } finally { await page.close(); }
}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}

for (const sample of chosen) {
  await run(sample,'slimsam');
  await run(sample,'sam2');
}

// Compare paired masks for corresponding labels. This is agreement, not accuracy.
const byKey = new Map(results.map(r=>[r.sample+'|'+r.backend,r]));
for (const sample of chosen) {
  const a=byKey.get(sample.id+'|slimsam'), b=byKey.get(sample.id+'|sam2');
  if (!a?.labels || !b?.labels || a.error || b.error) continue;
  const paired=[];
  for (const x of a.labels) {
    const y=b.labels.find(z=>z.text.trim().toLowerCase()===x.text.trim().toLowerCase());
    if (!x.area || !y?.area) continue;
    const px=`${out}/${sample.id}-slimsam-${String(x.index).padStart(2,'0')}.png`;
    const py=`${out}/${sample.id}-sam2-${String(y.index).padStart(2,'0')}.png`;
    // Pixel-level overlap is calculated in Chromium to avoid adding a PNG dependency.
    const page=await browser.newPage();
    const iou=await page.evaluate(async ([u,v])=>{
      const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
      const [a,b]=await Promise.all([load(u),load(v)]), c=document.createElement('canvas');c.width=a.width;c.height=a.height;
      const x=c.getContext('2d');x.drawImage(a,0,0);const p=x.getImageData(0,0,c.width,c.height).data;
      x.clearRect(0,0,c.width,c.height);x.drawImage(b,0,0);const q=x.getImageData(0,0,c.width,c.height).data;
      let inter=0,union=0;for(let k=0;k<p.length;k+=4){const A=p[k]>127,B=q[k]>127;if(A&&B)inter++;if(A||B)union++;}
      return union?inter/union:null;
    },[await (await import('node:fs/promises')).readFile(px).then(x=>'data:image/png;base64,'+x.toString('base64')),
       await (await import('node:fs/promises')).readFile(py).then(x=>'data:image/png;base64,'+x.toString('base64'))]);
    await page.close(); paired.push({label:x.text,iou});
  }
  a.modelAgreement=paired;
  b.modelAgreement=paired;
}
await browser.close();
const summary={generatedAt:new Date().toISOString(),sampleCount:chosen.length,models:{
  slimsam:'Xenova/slimsam-77-uniform',sam2:'onnx-community/sam2.1-hiera-tiny-ONNX'
},note:'Mask IoU is paired-model agreement, not ground-truth accuracy. Add manually reviewed reference masks before using IoU/boundary metrics as an accuracy claim.',results};
await writeFile(`${out}/comparison.json`,JSON.stringify(summary,null,2));
await writeFile(`${out}/comparison.csv`,csv.join('\n')+'\n');
const lines=['# Segmentation backend comparison','',summary.note,'','| Sample | Backend | Labels | Masks | Mean score | Mean mask area | Embed ms | Segment ms | Wall ms | Download bytes |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const r of results) lines.push(`| ${r.sample} | ${r.backend} | ${r.labels?.length??'—'} | ${r.labels?.filter(x=>x.area).length??'—'} | ${mean((r.labels||[]).map(x=>x.score))?.toFixed(3)??'—'} | ${mean((r.labels||[]).map(x=>x.areaFraction))?.toFixed(4)??'—'} | ${r.timings?.sam_embed??'—'} | ${r.timings?.sam_parts??'—'} | ${r.wallMs??'—'} | ${r.downloadedBytes??'—'} |`);
lines.push('','## Paired-mask agreement','','IoU values compare corresponding SlimSAM and SAM 2.1 masks by normalized label text. They do not indicate which mask is correct.','');
for(const r of results.filter(x=>x.modelAgreement)) lines.push(`### ${r.sample}`,...r.modelAgreement.map(x=>`- ${x.label}: IoU ${x.iou?.toFixed(4)??'n/a'}`),'');
await writeFile(`${out}/comparison.md`,lines.join('\n'));
console.log(`Wrote ${out}/comparison.json, comparison.csv, comparison.md and per-label PNG masks.`);
