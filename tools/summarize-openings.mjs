// Export compact review artifacts from a real-browser report, without images,
// local absolute paths, model weights, or credentials.
// node tools/summarize-openings.mjs <report.json> [output-directory]
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const [input,output='.screenshots/opening-evaluation']=process.argv.slice(2);
if(!input)throw new Error('Usage: node tools/summarize-openings.mjs <report.json> [output-directory]');
const report=JSON.parse(await readFile(input,'utf8'));
if(report.annotated!==44||!report.modelHashes)throw new Error('Expected a complete, fingerprinted 44-image report');
const labeled=report.rows.filter(r=>r.windowPixelIoU!==null),real=report.rows.filter(r=>r.windowPixelIoU===null);
const thresholds=[.25,.20,.15,.10].map(conf=>{
  const rows=labeled.map(r=>r.thresholds.find(t=>t.conf===conf));
  const sum=key=>rows.reduce((s,r)=>s+r[key],0),count=sum('count'),truth=sum('truth'),matched=sum('matched');
  return {conf,count,truth,matched,unmatched:sum('unmatched'),countRatio:count/truth,matchedRecall:matched/truth,matchedPrecision:matched/count};
});
const summary={createdAt:report.createdAt,modelHashes:report.modelHashes,definitions:report.definitions,
  annotated:44,meanWindowPixelIoU:report.meanWindowPixelIoU,meanWindowBoxIoU:report.meanWindowBoxIoU,
  pixelWindowGatePassed:report.windowGatePassed,boxWindowGatePassed:report.meanWindowBoxIoU>=.6,
  thresholds,real:real.map(({name,imageSha256,width,height,ms,windowCount,cv,ocr,thresholds})=>({name,imageSha256,width,height,detectorMs:ms,windowCount,cv,ocr,doors:thresholds.map(({boxes,...rest})=>rest)}))};
const headers=['image','image_sha256','mask_sha256','window_pixel_iou','window_box_iou','predicted_windows','annotated_windows',...thresholds.flatMap(t=>['doors','matched','unmatched','truth'].map(k=>k+'_'+t.conf))];
const csv=[headers.join(','),...labeled.map(r=>[r.name,r.imageSha256,r.maskSha256,r.windowPixelIoU,r.windowBoxIoU,r.windowCount,r.windowTruth,...r.thresholds.flatMap(t=>[t.count,t.matched,t.unmatched,t.truth])].join(','))].join('\n')+'\n';
const dir=resolve(output);await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,'openings-summary.json'),JSON.stringify(summary,null,2)+'\n');
await writeFile(resolve(dir,'openings-per-image.csv'),csv);
console.log(JSON.stringify({summary:resolve(dir,'openings-summary.json'),perImage:resolve(dir,'openings-per-image.csv'),thresholds}));
