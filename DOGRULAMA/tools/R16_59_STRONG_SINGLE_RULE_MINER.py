#!/usr/bin/env python3
"""Sonuç kullanmadan, tek aday bırakabilecek yarış-öncesi desenleri arar.

Kural madenciliği yalnız eğitim bölümünde yapılır. En iyi eğitim kuralları
validation'da yeniden sınanır; canlı aday yalnız holdout'ta da yeterli örnek ve
alt güven sınırı üretirse kabul edilir.
"""
import gzip,json,struct,sys,itertools,math
from collections import defaultdict

IN=sys.argv[1] if len(sys.argv)>1 else None
OUT=sys.argv[2] if len(sys.argv)>2 else 'R16_59_STRONG_SINGLE_RULE_MINER.json'
if not IN: raise SystemExit('Kullanım: R16_59_STRONG_SINGLE_RULE_MINER.py backup.tkbz [report.json]')
def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except: return None
def yes(v): return v is True or v==1 or v=='1'
def read(path):
    b=gzip.decompress(open(path,'rb').read());p=0
    def take(n):
        nonlocal p;x=b[p:p+n];p+=n;return x
    if take(4)!=b'TKPB':raise ValueError('TKPB yok')
    take(4);n=struct.unpack('>I',take(4))[0];meta=json.loads(take(n));o={}
    for c in meta['collections']:
        a=[]
        for _ in range(c['chunks']):
            n=struct.unpack('>I',take(4))[0];a.extend(json.loads(take(n)))
        o[c['name']]=a
    return o
def ordinal(values,lower=False):
    idx=[i for i,v in enumerate(values) if v is not None];idx.sort(key=lambda i:values[i],reverse=not lower);r=[999]*len(values)
    for k,i in enumerate(idx):r[i]=k+1
    return r
def rows(db):
    out=[]
    fields=[('TKP',lambda h:num(h.get('prediction_score_snapshot',h.get('score',h.get('pre_race_tkp_score')))),False),('AGF',lambda h:num(h.get('agf')),False),('TR',lambda h:num(h.get('tr_puan')),False),('YPUAN',lambda h:num(h.get('ypuan')),False),('HNDKP',lambda h:num(h.get('hndkp')),False),('VALUE',lambda h:num(h.get('value_score')),False),('JBYG',lambda h:num(h.get('jbyg')),False),('GALOP',lambda h:num(h.get('galop_rank',h.get('glp_rank'))),True),('TR_GANYAN',lambda h:num(h.get('tr_ganyan')),True),('PRIOR',lambda h:num(h.get('priorWins')),False),('COND',lambda h:num(h.get('condWinPct')),False),('ACCURATE',lambda h:num(h.get('priorAccurateFinishSignal')),False),('G800',lambda h:num(h.get('g800')),True),('SP',lambda h:num(h.get('sp')),True)]
    for r in db.get('races',[]):
        hs=[h for h in r.get('horses',[]) if str(h.get('horse_no','')).strip()];win=next((h for h in hs if yes(h.get('winner')) or str(h.get('finish_position'))=='1'),None)
        if not win:continue
        data={name:ordinal([fn(h) for h in hs],low) for name,fn,low in fields}
        horses=[]
        for i,h in enumerate(hs):
            tags={f'{name}_TOP':data[name][i]==1 for name,_,_ in fields}
            # ikinci sırada olmak tek başına yeterli değil; ancak başka sinyalle
            # kesişince tek aday bırakabilir.
            tags.update({f'{name}_TOP2':data[name][i]<=2 for name,_,_ in fields})
            tags['BMB']=yes(h.get('bmb'));tags['TR_BMB']=yes(h.get('tr_bmb_candidate'));tags['HIDDEN']=yes(h.get('tr_hidden_fav'))
            horses.append({'winner':str(h.get('horse_no'))==str(win.get('horse_no')),'tags':tags})
        out.append({'date':str(r.get('race_date','')),'seq':int(r.get('sequence_no') or 0),'id':str(r.get('id','')),'horses':horses})
    return sorted(out,key=lambda x:(x['date'],x['seq'],x['id']))
def wilson(h,n):
    if not n:return 0
    z=1.96;p=h/n;d=1+z*z/n
    return (p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/d
def check(rs,rule):
    sel=hit=0
    for r in rs:
        a=[h for h in r['horses'] if all(h['tags'].get(x,False) for x in rule)]
        if len(a)==1:sel+=1;hit+=a[0]['winner']
    return {'selected':sel,'hits':hit,'rate':round(hit/sel,4) if sel else None,'wilson':round(wilson(hit,sel),4)}
def main():
    rs=rows(read(IN));a=int(len(rs)*.6);b=int(len(rs)*.8);train,val,hold=rs[:a],rs[a:b],rs[b:]
    # İlk sırada olan sinyaller ve bunların ikili/üçlü sağlam kesişimleri.
    primary=['TKP_TOP','AGF_TOP','TR_TOP','YPUAN_TOP','HNDKP_TOP','VALUE_TOP','JBYG_TOP','GALOP_TOP','TR_GANYAN_TOP','PRIOR_TOP','COND_TOP','ACCURATE_TOP','G800_TOP','SP_TOP','BMB','TR_BMB','HIDDEN']
    secondary=['TKP_TOP2','AGF_TOP2','TR_TOP2','YPUAN_TOP2','HNDKP_TOP2','VALUE_TOP2','JBYG_TOP2','GALOP_TOP2','TR_GANYAN_TOP2','PRIOR_TOP2','COND_TOP2','ACCURATE_TOP2','G800_TOP2','SP_TOP2']
    rules=[(x,) for x in primary]
    rules += list(itertools.combinations(primary,2))
    # Üçlü kurallar yalnız iki farklı "TOP" sinyal + bir rozet veya güçlü
    # destekten oluşur; milyonlarca tesadüfi kural taranmaz.
    anchors=['BMB','TR_BMB','HIDDEN','TKP_TOP','AGF_TOP','TR_TOP','YPUAN_TOP','HNDKP_TOP','VALUE_TOP','JBYG_TOP']
    rules += [tuple(sorted((x,y,z))) for x,y in itertools.combinations(primary,2) for z in anchors if z not in (x,y)]
    rules += [tuple(sorted((x,y))) for x in primary for y in secondary if x.split('_')[0]!=y.split('_')[0]]
    rules=list(dict.fromkeys(rules))
    scored=[]
    for rule in rules:
        s=check(train,rule)
        if s['selected']>=60:scored.append({'rule':rule,'train':s})
    scored.sort(key=lambda x:(-x['train']['wilson'],-x['train']['rate'],-x['train']['selected']))
    # Eğitimde en güçlü 40 kuralı validation'a geçir. Çoklu deneme etkisini
    # tutmak için validation'da en az 30 tek aday şartı var.
    stage=[]
    for x in scored[:40]:
        v=check(val,x['rule'])
        if v['selected']>=30:stage.append({**x,'validation':v})
    stage.sort(key=lambda x:(-x['validation']['wilson'],-x['validation']['rate'],-x['validation']['selected']))
    finalists=[]
    for x in stage[:12]:finalists.append({**x,'holdout':check(hold,x['rule'])})
    r={'version':'R16.59-STRONG-SINGLE-RULE-MINER','contract':'Her kural yalnız yarış öncesi TKP/AGF/TR/Y.PUAN/HNDKP/VALUE/JBYG/galop/geçmiş sırası ile BMB/TR-BMB/gizli favori rozetlerini kullanır. Bir koşuda kuralın tam bir atı seçmesi gerekir. Kural eğitimde keşfedilir, doğrulamada seçilir, holdout yalnız son kanıttır.','all_official_result_races':len(rs),'split':{'train':len(train),'validation':len(val),'holdout':len(hold)},'rules_examined':len(rules),'train_candidates':len(scored),'validation_candidates':len(stage),'finalists':finalists,'decision_rule':'Canlı otomatik TEK için holdout en az 50 aday, oran ≥%70 ve Wilson alt sınırı ≥%60 gerekir.'}
    json.dump(r,open(OUT,'w'),ensure_ascii=False,indent=2);print(json.dumps(r,ensure_ascii=False,indent=2))
main()
