"""Fetch selected parts and their dependencies from the LDraw official library.

Preserves source headers and records source URLs, SHA256 and licenses. No packages.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request

BASE = 'https://library.ldraw.org/library/official/'
DEFAULT_IDS = ['3001','3004','3005','3020','3022','3023','3710','3666','3460',
 '3069b','3070b','2431','3039','3040b','3700','3701','32316','32523','32009',
 '32062','3705','2780','3673','4274','3937','3938','2429','2430','60470b',
 '60478','48336','11090','2412b','4070','11211','99207','44728','98138',
 '3062b','6141','4740','54200','14417','14418','14704','62360']

def safe_name(name):
    value=name.replace('\\','/').lower()
    if not re.fullmatch(r'[a-z0-9_.\-/]+',value) or '..' in value:
        raise ValueError(f'Unsafe reference: {name}')
    return value

def dependencies(text):
    refs=[]
    for line in text.splitlines():
        fields=line.strip().split(maxsplit=14)
        if fields and fields[0]=='1' and len(fields)==15:
            refs.append(safe_name(fields[14]))
    return refs

def fetch_one(name, root):
    name=safe_name(name)
    choices=[f'parts/{name}',f'p/{name}']
    for relative in choices:
        target=root/relative
        url=BASE+relative
        if target.exists():
            raw=target.read_bytes()
        else:
            try:
                request=urllib.request.Request(url,headers={'User-Agent':'BrickWorkshop research/0.1'})
                with urllib.request.urlopen(request, timeout=18) as response:
                    raw=response.read()
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(raw)
            except urllib.error.HTTPError as exc:
                if exc.code==404: continue
                raise
        text=raw.decode('utf-8-sig',errors='replace')
        if not text.lstrip().startswith('0'): raise ValueError(f'Invalid LDraw: {relative}')
        license_line=next((line for line in text.splitlines() if '!LICENSE' in line),'Unspecified in file; inspect source')
        return {'name':name,'path':relative,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),
                'description':text.splitlines()[0][2:].strip(),'license':license_line},dependencies(text)
    raise FileNotFoundError(name)

def run(root, ids):
    root.mkdir(parents=True,exist_ok=True)
    manifest_path=root/'manifest.json'
    records={}
    if manifest_path.exists():
        prior=json.loads(manifest_path.read_text(encoding='utf-8'))
        records={record['name']:record for record in prior.get('files',[])}
    pending={part if part.endswith('.dat') else part+'.dat' for part in ids}
    seen=set()
    failed={}
    while pending:
        batch=pending-seen
        if not batch: break
        seen.update(batch)
        pending=set()
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures={pool.submit(fetch_one,name,root):name for name in batch}
            for future in as_completed(futures):
                name=futures[future]
                try:
                    record,refs=future.result()
                    records[name]=record
                    pending.update(refs)
                except Exception as exc:
                    failed[name]=str(exc)
        manifest_path.write_text(json.dumps({'source':BASE,'root_parts':ids,'files':list(records.values()),'failed':failed},ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'files={len(records)} pending={len(pending-seen)} missing={len(failed)}',flush=True)
    print(json.dumps({'files':len(records),'failed':failed,'manifest':str(manifest_path)},ensure_ascii=False),flush=True)
    for part in ids:
        record=records.get(part if part.endswith('.dat') else part+'.dat')
        if record: print(f"{part}: {record['description']}",flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--parts',nargs='*',default=DEFAULT_IDS)
    args=parser.parse_args()
    run(args.out,args.parts)
