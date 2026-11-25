"""Read-only integration audit and v2-checkpoint continuation for the 15 nb- plans."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding="utf-8")

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--model',type=Path,required=True)
    p.add_argument('--project',type=Path,required=True)
    p.add_argument('--name',default='yolo-n-v4-newbatch')
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--epochs',type=int,default=50)
    p.add_argument('--batch',type=int,default=8)
    p.add_argument('--imgsz',type=int,default=640)
    p.add_argument('--export-only',type=Path)
    p.add_argument('--calibration',type=Path)
    a=p.parse_args()
    from ultralytics import YOLO
    if a.export_only:
        output=YOLO(a.export_only).export(format='onnx',imgsz=a.imgsz,opset=12,simplify=False,
                                        quantize=8,data=str(a.calibration or a.data),device='cpu')
        path=Path(output)
        print(json.dumps({'onnx':str(path),'bytes':path.stat().st_size,'sha256':sha(path)}),flush=True)
        return
    import yaml
    from PIL import Image
    config=yaml.safe_load(a.data.read_text(encoding='utf-8'))
    if config['names']!={0:'door',1:'window'}:raise ValueError('Unexpected class mapping')
    root=Path(config['path']);root=root if root.is_absolute() else a.data.parent/root
    manifest={'baseCheckpoint':str(a.model.resolve()),'baseSha256':sha(a.model),'data':str(a.data.resolve()),
              'dataYamlSha256':sha(a.data),'epochsRequested':a.epochs,'batch':a.batch,'imgsz':a.imgsz,
              'warmupEpochs':3,'seed':0,'sourceFilesReadOnly':True,'labelCacheMayBeRebuilt':True,'splits':{},'newClassCounts':{}}
    counts=Counter()
    for split in ['train','val']:
        files=sorted((root/config[split]).glob('*.jpg'))
        rows=[]
        for image in files:
            label=root/'labels'/split/(image.stem+'.txt')
            if not label.exists():raise FileNotFoundError(label)
            row={'image':image.name,'imageSha256':sha(image),'labelSha256':sha(label),'size':Image.open(image).size}
            if image.name.startswith('nb-'):
                if split!='train':raise ValueError('New batch leaked into validation')
                for line in label.read_text(encoding='utf-8').splitlines():
                    c,x,y,w,h=map(float,line.split())
                    if c not in (0,1) or w<=0 or h<=0 or min(x-w/2,y-h/2)<-1e-5 or max(x+w/2,y+h/2)>1+1e-5:
                        raise ValueError(f'Invalid nb label: {label}: {line}')
                    counts[int(c)]+=1
            rows.append(row)
        manifest['splits'][split]=rows
    if len(manifest['splits']['train'])!=145 or len(manifest['splits']['val'])!=13:
        raise ValueError('Expected unchanged 145 train / 13 val split')
    if sum(r['image'].startswith('nb-') for r in manifest['splits']['train'])!=15 or counts!={0:117,1:116}:
        raise ValueError(f'Unexpected new batch counts: {counts}')
    manifest['newClassCounts']={'door':counts[0],'window':counts[1]}
    if (a.project/a.name).exists():raise FileExistsError('Refusing to overwrite a previous run')
    model=YOLO(a.model)
    if model.names!={0:'door',1:'window'}:raise ValueError('Unexpected checkpoint classes')
    a.manifest.parent.mkdir(parents=True,exist_ok=True)
    a.manifest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    result=model.train(data=str(a.data),epochs=a.epochs,batch=a.batch,imgsz=a.imgsz,warmup_epochs=3,
                       device=0,workers=0,project=str(a.project),name=a.name,exist_ok=False,
                       patience=25,seed=0,deterministic=True,verbose=True)
    manifest['runDirectory']=str(result.save_dir)
    manifest['bestCheckpoint']=str(Path(result.save_dir)/'weights/best.pt')
    a.manifest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest.items() if k!='splits'},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
