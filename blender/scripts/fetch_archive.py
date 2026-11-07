"""Use the official bulk archive; extract selected parts and recursive dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile
from fetch_ldraw import DEFAULT_IDS, dependencies

URL='https://library.ldraw.org/library/updates/complete.zip'

def run(root,archive,ids):
    root.mkdir(parents=True,exist_ok=True)
    archive.parent.mkdir(parents=True,exist_ok=True)
    if not archive.exists():
        temporary=archive.with_suffix('.download')
        request=urllib.request.Request(URL,headers={'User-Agent':'BrickWorkshop research/0.1'})
        with urllib.request.urlopen(request,timeout=45) as response, temporary.open('wb') as output:
            size=0
            while True:
                chunk=response.read(1024*1024)
                if not chunk:break
                output.write(chunk);size+=len(chunk)
                if size%(10*1024*1024)<len(chunk):print(f'downloaded {size//1024//1024} MiB',flush=True)
        temporary.replace(archive)
    records={};seen=set();pending={p if p.endswith('.dat') else p+'.dat' for p in ids};missing=[]
    with zipfile.ZipFile(archive) as package:
        files={n.lower():n for n in package.namelist()}
        prefix='ldraw/' if any(n.startswith('ldraw/parts/') for n in files) else ''
        while pending:
            name=pending.pop()
            if name in seen:continue
            seen.add(name)
            choices=[f'parts/{name}',f'p/{name}']
            relative=next((path for path in choices if prefix+path in files),None)
            if relative is None: missing.append(name);continue
            raw=package.read(files[prefix+relative]);text=raw.decode('utf-8-sig',errors='replace')
            target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
            records[name]={'name':name,'path':relative,'url':'https://library.ldraw.org/library/official/'+relative,
              'archive_url':URL,'sha256':hashlib.sha256(raw).hexdigest(),'description':text.splitlines()[0][2:].strip(),
              'license':next((line for line in text.splitlines() if '!LICENSE' in line),'See archive license')}
            pending.update(dependencies(text))
        for name in ['CAreadme.txt','CAlicense.txt','LDConfig.ldr','Readme.txt']:
            key=prefix+name.lower()
            if key in files:(root/name).write_bytes(package.read(files[key]))
    manifest={'source':URL,'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'root_parts':ids,'files':list(records.values()),'failed':missing}
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'files':len(records),'missing':missing,'archive_bytes':archive.stat().st_size}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);parser.add_argument('--archive',type=Path,required=True);parser.add_argument('--parts',nargs='*',default=DEFAULT_IDS+['11477','85984','43093','6558','4073','3034','3036','3024','3795','43722','43723','50950','3623'])
    args=parser.parse_args();run(args.out,args.archive,args.parts)
