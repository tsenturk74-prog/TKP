/* One PNG sharing path for restored and newly generated coupons. */
(function(root){
'use strict';
function slots(candidates){
 const unique=[],seen=new Set();
 for(const c of candidates||[]){const no=String(c?.horse_no??'').trim();if(!no||seen.has(no))continue;seen.add(no);unique.push(c);}
 const odb=unique.find(c=>String(c.kind||'').toUpperCase()==='ODB')||null;
 const bh=unique.filter(c=>String(c.kind||'').toUpperCase()!=='ODB').slice(0,3);
 return [...[0,1,2].map(i=>({label:'BH'+(i+1),candidate:bh[i]||null})),{label:'ODB',candidate:odb}];
}
function bind(shotBtn){
 if(!shotBtn)return;
 shotBtn.dataset.bound='1';
        shotBtn.onclick = async () => {
          const oldLabel = shotBtn.textContent;
          // V1.1.135: X penceresini kullanıcı tıklamasının SENKRON çağrı zincirinde aç.
          // PNG hazırlama async olduğu için window.open() await sonrasına kalırsa Chrome popup olarak engelleyebilir.
          let xShareWindow=null;
          try {
            xShareWindow=window.open('about:blank','_blank');
            if(xShareWindow){
              try{xShareWindow.opener=null;}catch(_e){}
              try{
                xShareWindow.document.title='TKP · X paylaşımı hazırlanıyor';
                xShareWindow.document.body.innerHTML='<div style=\"font-family:Arial,sans-serif;padding:24px;color:#17365d\"><b>TKP kupon paylaşımı hazırlanıyor…</b><div style=\"margin-top:8px;color:#64748b;font-size:13px\">PNG hazırlanırken X gönderi ekranı açılacak.</div></div>';
              }catch(_e){}
            }
          }catch(_e){}
          shotBtn.textContent = '⏳ 3 kupon X paylaşımı hazırlanıyor…';
          shotBtn.disabled = true;
          let shareRoot=null;
          try {
            // Paylaşım anı = son kupon hali. BH/manuel eklemeler dahil snapshot önce güncellenir.
            if(typeof tkpPersistFinalCouponSnapshot==='function')tkpPersistFinalCouponSnapshot();
            const ctx=typeof couponSnapshotContext==='function'?couponSnapshotContext(lastRaceResults,'SON_KUPON'):{date:'',hippodrome:'',altiliNo:1};
            const date=String(ctx.date||new Date().toISOString().slice(0,10));
            const hip=String(ctx.hippodrome||'YARIŞ').trim();
            const alt=Math.max(1,Number(ctx.altiliNo)||1);
            const displayDate=date.split('-').reverse().join('.');
            const shareTitle=`TKP Altılı Ganyan Tahmini · ${displayDate} ${hip} ${alt}. Altılı`;
            const safeName=`TKP_Altili_Ganyan_Tahmini_${date}_${hip}_${alt}_Altili`.replace(/[^0-9A-Za-zÇĞİÖŞÜçğıöşü_-]+/g,'_');
            const bhTrForShare=(r,c)=>{
              const clean=v=>String(v??'').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g,' ');
              const no=clean(c?.horse_no),name=clean(c?.horse_name);
              const horses=Array.isArray(r?.horses)?r.horses:[];
              const horse=horses.find(h=>clean(h?.horse_no)===no)
                ||(name?horses.find(h=>clean(h?.horse_name)===name):null);
              const value=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(horse):null;
              return value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0?'TR '+fmt2(value):'TR —';
            };
            const shareNumber=(no,r)=>{const raw=String(no),id=typeof tkpShareHorseIdentity==='function'?tkpShareHorseIdentity(no,r):{number:raw.replace(/-E\d+$/i,''),tag:(raw.match(/-(E\d+)$/i)||[])[1]||''};return id.tag?`<span class="tkpXEkuriNumber">${esc(id.number)}-${esc(id.tag)}</span>`:esc(id.number);};
            const shareCard=(coupon,title,themeClass)=>{
              if(!coupon||coupon.error)return `<div class="tkpXShareCoupon ${themeClass||''}"><div class="tkpXShareCouponHead">${esc(title)}</div><div class="tkpXShareError">${esc(coupon?.error||'Kupon yok')}</div></div>`;
              const horseNameForPick=(pick,leg)=>{
                const direct=String(pick?.horse_name||'').trim();
                if(direct)return direct;
                const no=String(pick?.horse_no||'').trim();
                const rows=Array.isArray(leg?.r?.horses)?leg.r.horses:[];
                const found=rows.find(h=>String(h?.horse_no||'').trim()===no||String(h?.program_no||'').trim()===no);
                return String(found?.horse_name||'').trim();
              };
              const renderPickCell=leg=>{
                const picks=(leg?.picks||[]).map(h=>({no:String(h?.horse_no??'').trim(),name:horseNameForPick(h,leg)})).filter(h=>h.no);
                if(!picks.length)return '<div class="tkpXPickRow"><span class="tkpXNumChip">-</span></div>';
                if(picks.length===1){
                  const single=picks[0];
                  return `<div class="tkpXSingleWrap"><span class="tkpXSingleTag">TEK</span><span class="tkpXNumChip${/E\d+/i.test(single.no)?' tkpXNumChipEcuri':''}">${shareNumber(single.no,leg?.r)}</span><span class="tkpXSingleName">${esc(single.name||'TEK')}</span></div>`;
                }
                return `<div class="tkpXPickRow">${picks.map(p=>`<span class="tkpXNumChip${/E\d+/i.test(p.no)?' tkpXNumChipEcuri':''}">${shareNumber(p.no,leg?.r)}</span>`).join('')}</div>`;
              };
              const rows=(coupon.legs||[]).slice().sort((a,b)=>(Number(a.r?.leg)||0)-(Number(b.r?.leg)||0)).map((leg,index)=>`<tr><td class="tkpXLegCol"><span class="tkpXLegLabel">${index+1}. Ayak</span></td><td class="tkpXPickCol">${renderPickCell(leg)}</td></tr>`).join('');
              return `<div class="tkpXShareCoupon ${themeClass||''}"><div class="tkpXShareCouponHead"><span class="tkpXCardHorse"></span><span>${esc(title)}</span></div><table class="tkpXShareTable"><thead><tr><th>Ayak</th><th>At No</th></tr></thead><tbody>${rows}</tbody></table><div class="tkpXShareCost"><span>Maliyet:</span><b>${(Number(coupon.cost)||0).toLocaleString('tr-TR',{maximumFractionDigits:2})} TL</b></div></div>`;
            };
            const bhLegCards=(lastRaceResults||[]).slice().sort((a,b)=>(Number((a?.r||a)?.leg)||0)-(Number((b?.r||b)?.leg)||0)).map((x,index)=>{
              const r=x?.r||x; if(!r)return '';
              let candidates=[];
              try{
                const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
                const log=Array.isArray(db?.bomb_hunter_shadow_log)?db.bomb_hunter_shadow_log:[];
                const frozen=key?log.find(z=>z?.race_key===key):null;
                if(frozen?.candidates?.length)candidates=frozen.candidates.slice();
                else if(!(typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r.horses||[])) && typeof tkpBombHunterCandidates==='function'){
                  candidates=tkpBombHunterCandidates(r).map((z,i)=>({rank:i+1,horse_no:String(z.h?.horse_no||''),horse_name:z.h?.horse_name||'',score:Number(z.score)||0,kind:z.kind,category_rank:z.category_rank}));
                }
              }catch(_e){}
              // X güncellemeleri ile aynı ayak için paylaşım adayları yeniden hesaplanmasın.
              // 14.10.2026 İstanbul 2. Altılı: kullanıcının onayladığı ilk görselin
              // yarış-öncesi paylaşım kaydı. Yalnız görseli etkiler, model/kuponu etkilemez.
              const approved20261014={
                1:[['7','SENKRON','BH2 + ALT3 + BMB',12.50],['6','FILIUS VENTUS','BH1',0]],
                2:[['1','MUZATCAN','BH2 + BMB',25],['4','SADIK AĞANIN OĞLU','ALT4 + BMB',6.45],['12','ULU BEDEN','BH3 + BMB',4.55],['6','UFKUN ÖTESİ','ALT3 + ODB',3.23],['11','AKBELHAN','ALT1 + ODB',3.23],['2','ERSANŞAH','BH ADAY',null]],
                3:[],
                4:[['10','DEMRENİN KIZI','BH2 + BMB',25],['13','GÜLERYÜZ','ALT3 + ODB',4.35],['12','GÜLALP KIZI','ALT2 + ODB',4.35],['9','BERAY SULTAN','ALT1 + ODB',4.35],['15','ŞİMŞEK YELELİ','ALT4',4.35],['8','AYSERA KIZ','BH ADAY',null]],
                5:[['8','PRESIDENTS HORSE','ALT2 + ODB',20],['4','ÇİMEN BERA','BH',null],['6-E1','LORD OF LIGHT','BH ADAY',null],['1','AKALA','BH ADAY',null]],
                6:[['12','ŞAHANİL','ALT2 + ODB',16.67],['11','SERİN HATUN','ALT3 + ODB',8.33],['8','SAYRA','BH2 + BMB',5.56],['6','YILDIZBAŞAR','BH1 + BMB',5.56],['9','HÜRRİYET','BMB',5.56],['4','GÜZEL ZEHRA','BH ADAY',null]]
              };
              const isApproved= date==='2026-10-14' && /İSTANBUL|ISTANBUL/i.test(hip) && alt===2;
              const snapshotStore=(db && typeof db==='object')?(db.settings||(db.settings={})):null;
              const snapshotKey=[date,hip.toUpperCase(),alt,String(r.leg||index+1)].join('|');
              const snapshots=snapshotStore?(snapshotStore.bh_share_frozen_v1||(snapshotStore.bh_share_frozen_v1={})):null;
              // Onaylı ilk görsel, aynı gün için daha önce saklanmış hatalı bir
              // X ekranı önbelleğine yenilmemeli. Yalnız bu tarih/oturum için.
              let rescue=isApproved?null:(Array.isArray(snapshots?.[snapshotKey])?snapshots[snapshotKey]:null);
              if(!rescue){
                if(isApproved){
                  rescue=(approved20261014[Number(r.leg||index+1)]||[]).map(c=>({horse_no:c[0],horse_name:c[1],label:c[2],winRate:c[3]==null?null:c[3]/100}));
                }else{
                  rescue=typeof tkpConditionRescueShareRows==='function'?tkpConditionRescueShareRows(x):[];
                }
                // Saklanan satırlar sonraki X tarama ve kupon yenilemelerinde sabittir.
                if(snapshots){snapshots[snapshotKey]=rescue.map(c=>({horse_no:c.horse_no,horse_name:c.horse_name,label:c.label,winRate:c.winRate}));try{if(typeof saveDB==='function')saveDB(false);}catch(_e){}}
              }

              const rows=rescue.map(c=>`<div class="tkpXBhItem tkpXRescueItem"><span class="tkpXBhNo">${shareNumber(c.horse_no,r)}</span><div class="tkpXBhMeta"><div class="tkpXBhName">${esc(c.horse_name)} <span class="tkpXBhTr">${esc(bhTrForShare(r,c))}</span></div><span class="tkpXBhTag">${esc(c.label)}</span><span class="tkpXBhScore">${c.winRate==null?'—':fmt2(c.winRate*100)}</span></div></div>`).join('');
              const rescueRows='';
              return `<div class="tkpXBhCard"><div class="tkpXBhCardHead">${index+1}. AYAK</div><div class="tkpXBhList">${rows}${rescueRows}</div></div>`;
            }).filter(Boolean).join('');
            // FIX (Tommy talebi — "üste taşı ve jokey görseli ekle"): "6'lı Kuponlar
            // Hazır!" şeridi referans görseldeki gibi ÜST BAŞLIĞA taşındı (bkz.
            // tkpXShareRibbon). BH kartları artık iki sütun (marka + kartlar); üçüncü
            // sütundaki eski tkpBottomTicket kaldırıldı.
            const shareBh=bhLegCards?`<div class="tkpXBhSection"><div class="tkpXBhBrand"><div class="tkpXReferenceBhLogo"></div></div><div class="tkpXBhCards">${bhLegCards}</div></div>`:'';
            const artUrl=new URL('assets/coupon-reference-art.png',document.baseURI).href;
            shareRoot=document.createElement('div');
            shareRoot.className='tkpXShareCanvasRoot';
            shareRoot.dataset.tkpPresentation='off';
            shareRoot.style.cssText='position:fixed;left:-20000px;top:0;width:1672px;background:#fff;color:#172033;padding:0;font-family:Arial,Helvetica,sans-serif;z-index:-1;box-sizing:border-box';
            shareRoot.innerHTML=`<div class="tkpXShareShell"><div class="tkpXShareHeader"><div class="tkpXShareHeadText"><div class="tkpXShareSub"><span class="tkpXGoldHorse"></span><span>${esc(hip)} ${alt}. Altılı</span></div><div class="tkpXShareDate">${esc(displayDate)}</div></div><div class="tkpXReferenceSlogan"></div><div class="tkpXReferenceJockey"></div></div><div class="tkpXShareCouponGrid">${shareCard(activeCoupons.main,'1) Normal','normal')}${shareCard(activeCoupons.surprise,'2) Uzman + Kulis','expert')}${shareCard(activeCoupons.alt,'3) Sürpriz','surprise')}</div>${shareBh}</div>`;

            const style=document.createElement('style');
            style.textContent=`
.tkpXShareCanvasRoot *{box-sizing:border-box}
.tkpXShareShell{width:1400px;padding:22px;border-radius:28px;background:#fff;color:#172033;border:1px solid #dbe4ef;overflow:hidden}
.tkpXShareHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px}
.tkpXShareHeaderLeft{display:flex;align-items:flex-start;gap:16px;min-width:0}
.tkpXShareXMark{font-size:70px;line-height:1;font-weight:900;color:#8af4ff;text-shadow:0 0 22px rgba(54,217,255,.45)}
.tkpXShareHeadText{min-width:0}
.tkpXShareTitle{font-size:40px;line-height:1.05;font-weight:900;letter-spacing:-.02em}
.tkpXShareTitle span{color:#f6d74a}
.tkpXShareSub{margin-top:10px;font-size:24px;font-weight:800;color:#172033;display:flex;align-items:center;gap:10px}
.tkpXShareMiniHorse{font-size:24px}
.tkpXShareHeaderRight{padding-top:4px;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.tkpXShareSlogan{font-size:28px;line-height:1.05;font-weight:900;color:#0f4c81;text-shadow:none}
.tkpXShareRibbon{display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#ffd94d,#ff9f0f);border-radius:16px;padding:6px 14px 6px 8px;box-shadow:0 6px 14px rgba(255,159,15,.35)}
.tkpXJockeySvg{flex:0 0 auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}
.tkpXShareRibbonText{display:flex;flex-direction:column;line-height:1.05;text-align:left}
.tkpXShareRibbonMain{font-size:26px;font-weight:900;color:#201600}
.tkpXShareRibbonSub{font-size:14px;font-weight:900;color:#3a2600}
.tkpXShareCouponGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:16px}
.tkpXShareCoupon{display:flex;flex-direction:column;min-width:0;border-radius:24px;border:2px solid #dbe4ef;background:#fff;color:#172033;box-shadow:0 8px 22px rgba(15,23,42,.10);overflow:hidden}
.tkpXShareCoupon.normal{border-color:#23ddff;box-shadow:0 0 0 1px rgba(35,221,255,.12),0 0 18px rgba(35,221,255,.16)}
.tkpXShareCoupon.expert{border-color:#ffc620;box-shadow:0 0 0 1px rgba(255,198,32,.12),0 0 18px rgba(255,198,32,.16)}
.tkpXShareCoupon.surprise{border-color:#3cf36a;box-shadow:0 0 0 1px rgba(60,243,106,.12),0 0 18px rgba(60,243,106,.16)}
.tkpXShareCouponHead{padding:14px 16px;font-size:24px;font-weight:900;line-height:1.05;color:#fff}
.tkpXShareCoupon.normal .tkpXShareCouponHead{background:linear-gradient(90deg,#04d9ff,#0e92d5 62%,rgba(14,146,213,.25) 100%)}
.tkpXShareCoupon.expert .tkpXShareCouponHead{background:linear-gradient(90deg,#ffd21f,#ff9f0f 62%,rgba(255,159,15,.25) 100%);color:#201600}
.tkpXShareCoupon.surprise .tkpXShareCouponHead{background:linear-gradient(90deg,#4df26f,#00c96a 62%,rgba(0,201,106,.25) 100%);color:#06250e}
.tkpXShareTable{width:100%;border-collapse:collapse;table-layout:fixed}
.tkpXShareTable thead th{padding:10px 12px;font-size:15px;text-align:left;font-weight:900;background:#f8fafc;color:#334155;border-bottom:1px solid #dbe4ef}
.tkpXShareTable tbody td{padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:middle;color:#172033}
.tkpXLegCol{width:116px;font-size:16px;font-weight:900;white-space:nowrap}
.tkpXPickCol{font-size:15px}
.tkpXPickRow{display:flex;flex-wrap:wrap;gap:8px}
.tkpXNumChip{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:38px;padding:0 12px;border-radius:12px;background:linear-gradient(180deg,#ffffff,#dbe9ff);color:#0a1930;font-size:18px;font-weight:900;box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 2px 5px rgba(0,0,0,.18)}
.tkpXNumChipEcuri{background:linear-gradient(180deg,#f4d0ff,#d79cff);color:#2d1142}
.tkpXSingleWrap{display:flex;align-items:center;gap:8px;min-width:0}
.tkpXSingleTag{display:inline-flex;align-items:center;justify-content:center;height:38px;padding:0 16px;border-radius:12px;background:linear-gradient(180deg,#ffe45c,#ffbf00);color:#241700;font-size:16px;font-weight:900;box-shadow:0 2px 5px rgba(0,0,0,.18)}
.tkpXSingleName{display:inline-block;min-width:0;max-width:240px;padding:8px 12px;border-radius:12px;border:1px solid #67e8f9;background:#ecfeff;color:#164e63;font-size:15px;font-weight:900;line-height:1.1;white-space:normal;overflow-wrap:anywhere}
.tkpXShareCost{display:flex;align-items:center;justify-content:space-between;margin-top:auto;flex-shrink:0;gap:10px;padding:12px 16px 14px;border-top:1px solid #e5e7eb;background:#f8fafc;color:#172033}
.tkpXShareCost span{font-size:18px;font-weight:900}
.tkpXShareCost b{font-size:28px;font-weight:900;color:#b45309;white-space:nowrap}
.tkpXShareError{padding:16px;font-size:15px;color:#475569}
.tkpXBhSection{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:stretch}
.tkpXBhBrand{border-radius:24px;border:2px solid rgba(35,221,255,.35);background:linear-gradient(180deg,rgba(17,56,92,.95),rgba(2,10,20,.95));padding:16px;box-shadow:0 10px 22px rgba(0,0,0,.24)}
.tkpXBhBrand{display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
.tkpXBhBrandTitle{font-size:36px;font-weight:900;line-height:.95;color:#fff;text-shadow:0 0 14px rgba(255,255,255,.1)}
.tkpXBhBrandSub{margin-top:8px;font-size:28px;font-weight:900;color:#ffd94d}
.tkpXBhCards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
/* FIX (Tommy talebi — "alt tablo üstleri de aynı renk olmayacaktı"): her BH
   kartının başlık şeridi artık kendi çerçeve rengini taşır (5 renkli döngü),
   böylece kartların üst kısmı tek düze bir renkte kalmaz. */
.tkpXBhCard{background:#fff!important;color:#172033!important;border-radius:20px;padding:0;border:2px solid #dbe4ef;box-shadow:0 6px 16px rgba(15,23,42,.10);overflow:hidden}
.tkpXBhCard:nth-child(5n+1){border-color:#31d7ff}
.tkpXBhCard:nth-child(5n+2){border-color:#ffc62c}
.tkpXBhCard:nth-child(5n+3){border-color:#42ef79}
.tkpXBhCard:nth-child(5n+4){border-color:#f34dff}
.tkpXBhCard:nth-child(5n+5){border-color:#ff9d1a}
.tkpXBhCardHead{font-size:16px;font-weight:900;margin:0;padding:8px 12px;color:#0a1220}
.tkpXBhCard:nth-child(5n+1) .tkpXBhCardHead{background:#31d7ff}
.tkpXBhCard:nth-child(5n+2) .tkpXBhCardHead{background:#ffc62c}
.tkpXBhCard:nth-child(5n+3) .tkpXBhCardHead{background:#42ef79}
.tkpXBhCard:nth-child(5n+4) .tkpXBhCardHead{background:#f34dff}
.tkpXBhCard:nth-child(5n+5) .tkpXBhCardHead{background:#ff9d1a}
.tkpXBhList{display:flex;flex-direction:column;gap:8px;padding:9px 12px 12px}
.tkpXBhItem{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:center;border-radius:12px;padding:4px 6px!important;background:#f8fafc;border:1px solid #e5e7eb;font-size:12px!important;color:#172033}
.tkpXBhTag{white-space:normal!important;overflow-wrap:anywhere;display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 8px;border-radius:999px;background:#0f172a;color:#fff;font-size:12px;font-weight:900}
.tkpXBhNo{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:30px;padding:0 8px;border-radius:10px;background:linear-gradient(180deg,#fff,#dfe8f7);color:#0a1930;font-size:18px;font-weight:900}
.tkpXBhMeta{min-width:0}
.tkpXBhTr{display:inline-block;white-space:nowrap;color:#1e3a8a;font-size:10px;font-weight:900;margin-left:3px}
.tkpXBhName{font-size:14px;font-weight:900;line-height:1.05;white-space:normal;overflow-wrap:anywhere}
.tkpXBhScore{margin-top:2px;font-size:12px;font-weight:900;color:#9a6700}

/* Reference-sized number tiles and fixed first column: six legs stay compact. */
.tkpXShareTable thead th:first-child{width:86px}
.tkpXShareTable tbody td{height:62px;padding:8px}
.tkpXLegCol{width:86px;font-size:15px}
.tkpXPickRow{gap:5px}
.tkpXNumChip,.tkpXNumChipEcuri{display:inline-block;flex:0 0 auto;min-width:37px;height:42px;line-height:40px;text-align:center;padding:0 5px;border:1px solid #c8cbd0;border-bottom:3px solid #bfc3c8;border-radius:10px;background:#f6f6f6;color:#111;font-size:23px;font-weight:800;box-shadow:inset 0 2px 0 #fff,0 2px 3px #0002}
.tkpXSingleWrap{gap:6px}
.tkpXSingleName{flex:1;font-size:14px;line-height:1.25;padding:6px 8px;background:#f1f3f5;border-color:#c8cbd0;color:#172033}
.tkpXSingleTag{flex:0 0 auto;padding:0 12px;border:1px solid #e3b418;border-bottom-width:3px}
.tkpXShareHeader{align-items:center;margin-bottom:14px}
.tkpXShareHeaderRight{flex-direction:row;align-items:center;gap:20px}
.tkpXShareSub{font-size:28px;margin-top:0}
.tkpXShareSlogan{font-size:21px}
.tkpXShareRibbon{box-shadow:none}
.tkpXShareCost{background:#f1f3f5;padding:10px 14px}
.tkpXShareCost b{font-size:25px;color:#172033}
.tkpXBhSection{grid-template-columns:132px minmax(0,1fr);gap:10px}
.tkpXBhCards{gap:8px}
.tkpXBhBrand{padding:12px}
.tkpXBhBrandTitle{font-size:26px;line-height:1.1}
.tkpXBhBrandSub{font-size:18px;line-height:1.3}
.tkpXBhList{padding:7px 5px;gap:5px}
.tkpXBhItem{grid-template-columns:30px 30px minmax(0,1fr);gap:3px;min-height:68px;padding:5px 3px!important;border-radius:8px}
.tkpXBhTag{padding:0 3px;font-size:10px;border-radius:5px}
.tkpXBhNo{display:inline-block;min-width:28px;height:34px;line-height:32px;text-align:center;padding:0;border:1px solid #c8cbd0;border-bottom:2px solid #bfc3c8;border-radius:7px;background:#f6f6f6;color:#111;font-size:20px}
.tkpXBhName{font-size:12px;line-height:1.2;overflow-wrap:break-word}
.tkpXBhScore{font-size:11px}

/* Reference art is an unchanged local asset; only decorative regions are shown.
   Every number, name, cost and candidate below is current application data. */
.tkpXShareShell{width:1672px;padding:14px;border:0;border-radius:0;background:#fff;color:#050b17;font-family:Arial,Helvetica,sans-serif}
.tkpXShareHeader{height:156px;position:relative;display:flex;align-items:center;gap:8px;margin-bottom:14px;overflow:hidden}
.tkpXShareHeadText{width:640px;flex-shrink:0;position:relative;z-index:1}
.tkpXShareSub{font-size:42px;line-height:1.08;font-weight:800;color:#070d1c;gap:12px}
.tkpXShareDate{font-size:21px;color:#334155;margin:8px 0 0 105px}
.tkpXGoldHorse{display:block;width:86px;height:74px;flex-shrink:0;background-image:url("${artUrl}");background-size:1672px 941px;background-position:-199px -94px}
.tkpXReferenceSlogan{width:430px;height:95px;flex-shrink:0;background-image:url("${artUrl}");background-size:1672px 941px;background-position:-676px -96px}
.tkpXReferenceJockey{position:absolute;right:-1px;top:-12px;width:558px;height:176px;background-image:url("${artUrl}");background-size:1672px 941px;background-position:-1114px 0}
.tkpXShareCouponGrid{gap:16px;margin-bottom:16px}
.tkpXShareCoupon{border-radius:23px;border-width:3px;box-shadow:none}
.tkpXShareCoupon.normal{border-color:#00daf3;background:#effdff}
.tkpXShareCoupon.expert{border-color:#ffc300;background:#fffef1}
.tkpXShareCoupon.surprise{border-color:#1be86b;background:#f1fff5}
.tkpXShareCouponHead{height:69px;padding:3px 12px;display:flex;align-items:center;gap:12px;font-size:39px;font-weight:900;text-shadow:2px 3px 1px #000;color:white!important;line-height:1.05}
.tkpXShareCoupon.normal .tkpXShareCouponHead{background:linear-gradient(105deg,#001928 3%,#005b84 56%,#01ccf2 82%,#f3feff 100%)}
.tkpXShareCoupon.expert .tkpXShareCouponHead{background:linear-gradient(105deg,#261800 3%,#8a3300 60%,#ffb31a 83%,#fffef3 100%);color:#fff3aa!important}
.tkpXShareCoupon.surprise .tkpXShareCouponHead{background:linear-gradient(105deg,#002719 3%,#005d22 60%,#19d936 83%,#f3fff5 100%)}
.tkpXCardHorse{display:block;flex-shrink:0;width:92px;height:60px;background-image:url("${artUrl}");background-size:1672px 941px;background-position:-50px -191px}
.expert .tkpXCardHorse{background-position:-606px -191px}
.surprise .tkpXCardHorse{background-position:-1146px -191px}
.tkpXShareTable{background:#fff}
.tkpXShareTable thead th{height:43px;padding:6px 15px;color:#050b17;font-size:26px;font-weight:800;border-bottom:1px solid #dbe1e6}
.tkpXShareTable thead th:first-child{width:134px}
.normal .tkpXShareTable thead th{background:linear-gradient(#d7fdff,#76eafa)}
.expert .tkpXShareTable thead th{background:linear-gradient(#fffcd4,#ffe66d)}
.surprise .tkpXShareTable thead th{background:linear-gradient(#e6ffeb,#92efaa)}
.tkpXShareTable tbody td{height:59px;padding:5px 8px;border-color:#ecf0f3}
.tkpXShareTable tbody tr:nth-child(even) td{background:#f5f8fa}
.tkpXLegCol{font-size:24px;font-weight:700;color:#0b1220!important;position:relative;padding-left:19px!important}
.tkpXLegCol:before{content:'';position:absolute;left:5px;top:10px;bottom:10px;width:6px;border-radius:4px;background:#08cef3;border:1px solid #0797d3}
.expert .tkpXLegCol:before{background:#ffd500;border-color:#ef8c00}
.surprise .tkpXLegCol:before{background:#13e533;border-color:#00aa39}
.tkpXPickRow{gap:6px}
.tkpXNumChip,.tkpXNumChipEcuri{display:block;min-width:43px;height:45px;line-height:42px;padding:0 8px;border:1px solid #ccd0d5;border-bottom:2px solid #bfc4ca;border-radius:11px;background:#fafafa;color:#090b10;font-size:27px;font-weight:700;box-shadow:inset 0 2px 0 #fff;text-shadow:none}
.tkpXSingleTag{height:45px;line-height:42px;display:block;padding:0 18px;font-size:25px;font-weight:800;background:linear-gradient(#fff278,#ffcf00);color:#111;border-color:#e3b700}
.tkpXSingleName{background:#f2f3f5;border:1px solid #bac4d0;border-radius:12px;color:#0b1220;font-size:20px;line-height:1.1;padding:7px 9px;text-align:center}
.tkpXShareCost{height:68px;justify-content:center;gap:8px;padding:6px 12px;border:2px solid #aaf9ff;border-radius:20px;color:#fff;background:linear-gradient(#057aa6,#002535 55%,#00648e)}
.expert .tkpXShareCost{border-color:#ffda60;background:linear-gradient(#a56a00,#301600 55%,#945e00)}
.surprise .tkpXShareCost{border-color:#8dffad;background:linear-gradient(#118d35,#00270e 55%,#086927)}
.tkpXShareCost span{font-size:26px;font-weight:800;color:#fff;text-shadow:1px 2px #000}
.tkpXShareCost span:before{content:'💰';font-size:37px;margin-right:9px}
.tkpXShareCost b{font-size:39px;color:#ffe42d;text-shadow:2px 3px #151000}
.tkpXBhSection{grid-template-columns:232px minmax(0,1fr);gap:10px}
.tkpXBhBrand{border:1px solid #e1e5e9;border-radius:19px;background:#fff;padding:0;box-shadow:none;align-items:center;justify-content:center}
.tkpXReferenceBhLogo{width:231px;height:178px;background-image:url("${artUrl}");background-size:1672px 941px;background-position:-15px -750px}
.tkpXBhCards{gap:9px}
.tkpXBhCard{border-width:2px;border-radius:18px;background:#fff!important;box-shadow:none}
.tkpXBhCardHead{font-size:24px;text-align:center;padding:7px 4px;color:#05090f}
.tkpXBhList{padding:5px;gap:4px}
.tkpXBhItem{grid-template-columns:39px 34px minmax(0,1fr);gap:4px;min-height:62px;border:0;border-radius:7px;padding:4px 2px!important;background:#f1fbfe}
.tkpXBhCard:nth-child(2) .tkpXBhItem{background:#fffbea}
.tkpXBhCard:nth-child(3) .tkpXBhItem{background:#effff0}
.tkpXBhCard:nth-child(4) .tkpXBhItem{background:#fcf1ff}
.tkpXBhCard:nth-child(5) .tkpXBhItem{background:#fff7eb}
.tkpXBhCard:nth-child(6) .tkpXBhItem{background:#fff0fa}
.tkpXBhCard:nth-child(6){border-color:#fa5bc8}
.tkpXBhCard:nth-child(6) .tkpXBhCardHead{background:#fa77ce}
.tkpXBhTag{height:31px;line-height:29px;padding:0 3px;border:1px solid #65c9df;border-radius:6px;background:linear-gradient(#fff,#daf6fc);color:#10435a;font-size:13px;text-shadow:none}
.tkpXBhNo{height:35px;line-height:33px;font-size:23px;background:#fafafa;border:1px solid #d0d4da;border-bottom:2px solid #bfc4ca}
.tkpXBhName{font-size:13px;line-height:1.1;font-weight:800;color:#10213a}
.tkpXBhScore{font-size:13px;font-weight:700;color:#aa5100;margin-top:4px}

.tkpXBhCardHead{font-size:20px;line-height:1.1;padding:5px 3px}
.tkpXBhList{padding:4px;gap:2px}
.tkpXBhItem{min-height:42px;padding:2px!important;grid-template-columns:34px 30px minmax(0,1fr);gap:3px}
.tkpXBhTag{height:25px;line-height:23px;font-size:12px;padding:0 2px}
.tkpXBhNo{height:29px;line-height:27px;font-size:21px;min-width:28px}
.tkpXBhName{font-size:12px;line-height:1.05}
.tkpXBhScore{font-size:12px;margin-top:2px;line-height:1.05}

.tkpXReferenceSlogan{position:absolute;left:652px;top:65px;width:438px;height:77px}
.tkpXReferenceJockey{width:525px;background-position:-1147px 0}
.tkpXShareCouponGrid{margin-left:14px;margin-right:14px}
.tkpXShareCoupon.normal .tkpXShareCouponHead{background-image:url("${artUrl}");background-size:1672px 941px;background-position:-32px -184px}
.tkpXShareCoupon.expert .tkpXShareCouponHead{background-image:url("${artUrl}");background-size:1672px 941px;background-position:-572px -184px}
.tkpXShareCoupon.surprise .tkpXShareCouponHead{background-image:url("${artUrl}");background-size:1672px 941px;background-position:-1119px -184px}
.tkpXShareCouponHead>span{visibility:hidden}
.tkpXShareTable thead th:first-child{width:145px}
.tkpXShareCost b{font-size:44px}
.tkpXShareCanvasRoot .tkpXLegLabel{display:block!important;visibility:visible!important;opacity:1!important;position:static!important;color:#0b1220!important;font:600 24px/1.3 Arial,Helvetica,sans-serif!important;white-space:nowrap!important;letter-spacing:0!important}
.tkpXShareCanvasRoot .tkpXPickRow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
.tkpXShareCanvasRoot .tkpXPickRow .tkpXNumChip{min-width:0;width:100%;padding:0 3px}
.tkpXShareCanvasRoot .tkpXSingleTag{font-size:20px;padding:0 10px}
`;
            style.textContent+='\n.tkpXBhEvidence{font-size:9px;line-height:1.2;margin-top:3px;white-space:normal;overflow-wrap:anywhere;color:#075985}.tkpXEkuriNumber{display:inline-block;font-size:inherit!important;white-space:nowrap!important;line-height:inherit!important}.tkpXNumChip:has(.tkpXEkuriNumber){font-size:22px!important}.tkpXBhItem{grid-template-columns:34px 42px minmax(0,1fr)!important}.tkpXBhNo{box-sizing:border-box;min-width:0!important;width:42px!important;display:flex!important;align-items:center;justify-content:center}.tkpXBhTag{white-space:nowrap!important;overflow-wrap:normal!important;font-size:10px!important}.tkpXRescueItem{grid-template-columns:55px 42px minmax(0,1fr)!important;align-items:start!important}.tkpXRescueItem .tkpXBhTag{height:auto!important;min-height:25px;line-height:1.2!important;padding:3px!important;font-size:10px!important;white-space:normal!important;overflow-wrap:anywhere!important}.tkpXRescueItem .tkpXBhName,.tkpXRescueItem .tkpXBhScore{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.2!important}';
            shareRoot.appendChild(style);
            style.textContent+='\n.tkpXRescueItem{grid-template-columns:42px minmax(0,1fr)!important;gap:5px!important;align-items:center!important}.tkpXRescueItem .tkpXBhMeta{min-width:0}.tkpXRescueItem .tkpXBhName{font-size:11px!important;line-height:1.15!important}.tkpXRescueItem .tkpXBhTag{display:inline!important;height:auto!important;min-height:0!important;padding:0!important;border:0!important;background:none!important;font-size:8px!important;line-height:1.2!important;font-weight:500!important;white-space:normal!important;overflow-wrap:normal!important}.tkpXRescueItem .tkpXBhScore{display:inline!important;font-size:9px!important;margin-left:5px!important}';
            style.textContent+='\n.tkpXRescueItem:has(.tkpXEkuriNumber){grid-template-columns:70px minmax(0,1fr)!important}.tkpXRescueItem:has(.tkpXEkuriNumber) .tkpXBhNo{width:70px!important}';
            document.body.appendChild(shareRoot);
            const capture=await tkpEnsureHtml2Canvas();
            if(document.fonts?.ready)await document.fonts.ready;
            const canvas=await capture(shareRoot,{backgroundColor:null,scale:1.3,useCORS:true,logging:false,width:1672,windowWidth:1700});
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            if(!blob)throw new Error('Görüntü oluşturulamadı.');
            const file=new File([blob],safeName+'.png',{type:'image/png'});
            // Kullanıcı kuralı: paylaş düğmesi HER ZAMAN aynı anda PNG'yi bilgisayara kaydeder.
            const downloadUrl=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=downloadUrl;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
            setTimeout(()=>URL.revokeObjectURL(downloadUrl),5000);
            // X intent yalnız metin taşır. Tarayıcı izin verirse PNG'yi panoya da
            // koy; kullanıcı X taslağında Ctrl+V ile ekler ve Gönder'e kendisi basar.
            let copied=false;
            try{
              if(navigator.clipboard?.write && typeof ClipboardItem!=='undefined'){
                await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
                copied=true;
              }
            }catch(_e){ /* PNG zaten indirildi; manuel dosya ekleme yolu korunur. */ }
            const oldNotice=shotBtn.parentElement.querySelector('.tkpXComposeNotice');
            if(oldNotice)oldNotice.remove();
            const notice=document.createElement('span');notice.className='tkpXComposeNotice';
            notice.style.cssText='font-size:12px;color:#334155;font-weight:700';
            notice.textContent=copied?'PNG panoya kopyalandı. X taslağında Ctrl+V ile ekleyip Gönder’e basın.':'PNG indirildi. X taslağında görseli dosyadan ekleyip Gönder’e basın.';
            shotBtn.insertAdjacentElement('afterend',notice);
            const xUrl='https://x.com/intent/post?text='+encodeURIComponent(shareTitle);
            if(xShareWindow && !xShareWindow.closed){
              try{xShareWindow.location.replace(xUrl);}catch(_e){xShareWindow.location.href=xUrl;}
            }else{
              // Popup engellendiyse kullanıcıya sessizce hiçbir şey olmamış gibi davranma.
              // Aynı tıklamada açılamadıysa açık ve görünür geri bildirim ver.
              const link=document.createElement('a');link.href=xUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='PNG kaydedildi · X gönderi ekranını aç';link.className='tkpXComposeLink';shotBtn.parentElement.querySelector('.tkpXComposeLink')?.remove();shotBtn.insertAdjacentElement('afterend',link);
            }
          } catch(e){
            try{if(xShareWindow && !xShareWindow.closed)xShareWindow.close();}catch(_e){}
            if(e?.name!=='AbortError'){console.error('Kupon paylaşım görseli hatası:',e);alert('Görüntü oluşturulurken bir hata oluştu: '+(e?.message||e));}
          } finally {
            try{shareRoot?.remove();}catch(_e){}
            shotBtn.textContent = oldLabel;
            shotBtn.disabled = false;
          }
        };
}
root.TKPCouponShare={slots,bind};
})(globalThis);
