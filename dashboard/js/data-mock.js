'use strict';

// ── DONNEES STATIQUES (fallback / demo) ────────────────
var ELEVES=[
  ['Aminata Traore','2024-001','Term S1',true,14.2,2,'Awa Traore'],
  ['Ibrahima Fall','2024-002','1re L1',true,11.8,5,'Mamadou Fall'],
  ['Fatou Diallo','2024-003','3e B',true,9.6,12,'Rokhaya Diallo'],
  ['Moussa Kouyate','2024-004','3e B',true,7.1,23,'Kouyate'],
  ['Mariam Coulibaly','2024-005','2de A',true,13.4,1,'Coulibaly'],
  ['Seydou Bah','2024-006','Term L1',true,12.9,4,'Fatoumata Bah'],
  ['Adja Sow','2024-007','6e A',true,15.1,0,'Ndeye Sow'],
  ['Oumar Diop','2024-008','2de B',true,10.3,7,'Penda Diop'],
  ['Aissatou Camara','2024-009','1re S1',true,16.2,1,'Kadiatou Camara'],
  ['Modou Ndiaye','2024-010','Term S1',true,8.9,9,'Astou Ndiaye'],
  ['Khadi Mbaye','2024-011','3e A',true,11.5,3,'Rokhaya Mbaye'],
  ['Alioune Diatta','2024-012','6e B',true,13.7,2,'Maguette Diatta'],
  ['Ndeye Diouf','2024-013','2de A',false,null,0,'Binta Diouf'],
  ['Lamine Gueye','2024-014','1re L1',true,10.8,6,'Anta Gueye'],
  ['Awa Ba','2024-015','Term L1',true,14.8,0,'Mariama Ba'],
];
var EVALS=[
  ['Mathematiques','Term S1','Composition','12/02','M. Sow',11.4,3,18,'publiee'],
  ['Francais','2de A','Devoir','15/02','Mme Diaw',null,null,null,'non saisie'],
  ['SVT','1re S1','TP','18/02','M. Diallo',13.2,7,20,'publiee'],
  ['Physique','Term S1','Composition','08/02','M. Cisse',8.1,2,16,'publiee'],
  ['Anglais','3e B','Devoir','20/02','Mme Fall',12.7,5,19,'publiee'],
  ['Histoire-Geo','Term L1','Expose','22/02','M. Toure',13.9,9,20,'publiee'],
  ['Philosophie','Term S1','Devoir','25/02','Mme Sy',11.1,4,17,'brouillon'],
];
var ABS=[
  ['Fatou Diallo','3e B','25/02','Mathematiques','absent','\u2705','\u2014'],
  ['Moussa Kouyate','3e B','25/02','Francais','absent','\u2705','Non justifiee'],
  ['Ibrahima Fall','1re L1','24/02','SVT','retard','\u2705','20 min'],
  ['Modou Ndiaye','Term S1','24/02','Physique','absent','\u2705','Non justifiee'],
  ['Oumar Diop','2de B','23/02','EPS','absent','\u274C','\u2014'],
  ['Lamine Gueye','1re L1','22/02','Histoire','retard','\u2705','15 min'],
];
var NOTIFS=[
  ['Awa Traore','Absence Aminata en Physique 25/02','WhatsApp','25/02 08:43','\u2705 Livre'],
  ['Kouyate','Absence Moussa \u2014 23e cette annee','SMS','25/02 08:44','\u2705 Livre'],
  ['Fatoumata Bah','Note Seydou : 14/20 Anglais','WhatsApp','24/02 11:12','\u2705 Lu'],
  ['Astou Ndiaye','Retard Modou \u2014 25 min','SMS','24/02 09:01','\u23F3 Attente'],
  ['Rokhaya Diallo','Bulletin T2 disponible \u2014 Fatou','WhatsApp','23/02 16:30','\u2705 Telecharge'],
];
var BULL=[
  ['Term S1',42,42,38,12.4,'Aissatou Camara','81%'],
  ['Term L1',38,38,35,13.1,'Awa Ba','87%'],
  ['1re S1',45,40,0,11.8,'\u2014','69%'],
  ['2de A',48,48,0,12.9,'Mariam Coulibaly','72%'],
  ['3e A',52,52,25,11.5,'Khadi Mbaye','68%'],
  ['3e B',50,0,0,null,'\u2014','\u2014'],
  ['6e A',54,54,40,13.7,'Adja Sow','84%'],
];
var ENS=[
  ['Amadou Sow','Mathematiques','Term S1, 2de A',22,'92%','47/47','8 min'],
  ['Mame Diaw','Francais','2de A, 2de B, 3e',18,'61%','32/40','2j'],
  ['Omar Cisse','Physique','Term S1, 1re S1',16,'95%','38/38','1h'],
  ['Aissatou Fall','Anglais','Term, 1re',20,'88%','41/44','4h'],
  ['Pape Toure','Histoire-Geo','Term, 1re, 2de',18,'100%','36/36','3h'],
  ['Djibril Diallo','SVT','1re, Term S',16,'98%','40/41','2h'],
];
var CLASSES=[
  {n:'Term S1',e:42,m:12.4,p:94,s:'Scientifique'},
  {n:'Term L1',e:38,m:13.1,p:96,s:'Litteraire'},
  {n:'1re S1', e:45,m:11.8,p:91,s:'Scientifique'},
  {n:'2de A',  e:48,m:12.9,p:93,s:'Generale'},
  {n:'3e A',   e:52,m:11.5,p:90,s:'College'},
  {n:'3e B',   e:50,m:9.8, p:84,s:'College'},
  {n:'6e A',   e:54,m:13.7,p:97,s:'College'},
  {n:'6e B',   e:52,m:12.1,p:95,s:'College'},
];

// ── RENDU TABLEAUX ─────────────────────────────────────
function renderAll(){
  // Eleves
  document.getElementById('tb-eleves').innerHTML=ELEVES.map(function(r){var nm=r[0],mat=r[1],cls=r[2],ok=r[3],moy=r[4],ab=r[5],par=r[6];return '<tr><td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:'+cn(moy)+'">'+init2(nm)+'</div>'+nm+'</td><td style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400)">'+mat+'</td><td><span class="badge bp">'+cls+'</span></td><td><span class="badge '+(ok?'bs':'bn')+'">'+(ok?'\u2713 Inscrit':'Inactif')+'</span></td><td>'+(moy!=null?'<span style="font-weight:700;color:'+cn(moy)+'">'+moy+'/20</span>':'<span class="badge bn">\u2014</span>')+'</td><td><span style="font-weight:600;color:'+(ab>=10?'var(--rouge)':ab>=5?'var(--warning)':'var(--g700)')+'">'+ab+'j</span></td><td style="font-size:12px;color:var(--g500)">'+par+'</td><td style="display:flex;gap:5px"><button class="btn btn-l btn-sm" onclick="toast(\'Fiche '+nm+'\')">Voir</button><button class="btn btn-l btn-sm" style="color:var(--orange);border-color:var(--orange-lt)" onclick="toast(\'SMS envoye a '+par+'\',\'s\')">&#128241;</button></td></tr>';}).join('');

  // Evaluations
  document.getElementById('tb-eval').innerHTML=EVALS.map(function(r){var m=r[0],c=r[1],t=r[2],d=r[3],e=r[4],moy=r[5],mn=r[6],mx=r[7],st=r[8];return '<tr><td class="nc">'+m+'</td><td><span class="badge bp">'+c+'</span></td><td><span class="badge bo">'+t+'</span></td><td style="font-family:\'Space Mono\',monospace;font-size:11.5px">'+d+'</td><td>'+e+'</td><td>'+(moy!=null?'<span style="font-weight:700;color:'+cn(moy)+'">'+moy+'/20</span>':'<span class="badge bd">Non saisi</span>')+'</td><td style="color:var(--g400)">'+(mn!=null?mn:'\u2014')+'</td><td style="color:var(--g400)">'+(mx!=null?mx:'\u2014')+'</td><td><span class="badge '+(st==='publiee'?'bs':st==='brouillon'?'bw':'bd')+'">'+st+'</span></td></tr>';}).join('');

  // Absences
  document.getElementById('tb-abs').innerHTML=ABS.map(function(r){var nm=r[0],c=r[1],d=r[2],m=r[3],t=r[4],n=r[5],j=r[6];return '<tr><td class="nc">'+nm+'</td><td><span class="badge bp">'+c+'</span></td><td style="font-family:\'Space Mono\',monospace;font-size:11.5px">'+d+'</td><td>'+m+'</td><td><span class="badge '+(t==='absent'?'bd':'bw')+'">'+t+'</span></td><td style="text-align:center">'+n+'</td><td style="font-size:11.5px;color:var(--g500)">'+j+'</td><td><button class="btn btn-l btn-sm" onclick="toast(\'Justification enregistree\',\'s\')">Justifier</button></td></tr>';}).join('');

  // Notifs
  document.getElementById('tb-notif').innerHTML=NOTIFS.map(function(r){var d=r[0],m=r[1],c=r[2],dt=r[3],s=r[4];return '<tr><td class="nc">'+d+'</td><td style="font-size:12px;color:var(--g600);max-width:260px">'+m+'</td><td><span class="badge '+(c==='WhatsApp'?'bs':'bp')+'">'+c+'</span></td><td style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400)">'+dt+'</td><td>'+s+'</td></tr>';}).join('');

  // Bulletins
  document.getElementById('tb-bull').innerHTML=BULL.map(function(r){var c=r[0],e=r[1],g=r[2],v=r[3],m=r[4],p=r[5],tx=r[6];return '<tr><td class="nc">'+c+'</td><td style="font-weight:600">'+e+'</td><td><div style="display:flex;align-items:center;gap:7px"><div class="pb" style="width:70px;height:7px"><div class="pf" style="width:'+(g/e*100)+'%;--c:var(--success)"></div></div><span style="font-weight:600;font-size:11.5px">'+g+'/'+e+'</span></div></td><td><span style="font-weight:600;color:'+(v===e&&e>0?'var(--success)':'var(--g500)')+'">'+v+'</span></td><td>'+(m!=null?'<span style="font-weight:700;color:'+cn(m)+'">'+m+'</span>':'\u2014')+'</td><td style="font-size:12px">'+p+'</td><td><span class="badge '+(parseFloat(tx)>=80?'bs':parseFloat(tx)>=70?'bw':'bd')+'">'+tx+'</span></td><td style="display:flex;gap:5px"><button class="btn btn-l btn-sm" onclick="toast(\'Bulletins '+c+'\')">Voir</button>'+(v===0&&g>0?'<button class="btn btn-p btn-sm" onclick="toast(\'Validation en cours...\',\'s\')">Valider</button>':'')+'<button class="btn btn-l btn-sm">&#128229;</button></td></tr>';}).join('');

  // Enseignants
  document.getElementById('tb-ens').innerHTML=ENS.map(function(r){var nm=r[0],m=r[1],c=r[2],h=r[3],tn=r[4],ap=r[5],ac=r[6];return '<tr><td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:var(--bleu)">'+init2(nm)+'</div>'+nm+'</td><td><span class="badge bo">'+m+'</span></td><td style="font-size:11.5px;color:var(--g500)">'+c+'</td><td style="font-weight:600">'+h+'h</td><td><span style="font-weight:600;color:'+(parseFloat(tn)>=90?'var(--success)':parseFloat(tn)>=75?'var(--warning)':'var(--rouge)')+'">'+tn+'</span></td><td style="font-family:\'Space Mono\',monospace;font-size:11.5px">'+ap+'</td><td style="font-size:11.5px;color:var(--g400)">'+ac+'</td><td><span class="badge bs">Actif</span></td></tr>';}).join('');

  // Classes
  document.getElementById('cls-grid').innerHTML=CLASSES.map(function(c){return '<div class="carte" style="cursor:pointer;transition:transform .15s" onmouseenter="this.style.transform=\'translateY(-3px)\'" onmouseleave="this.style.transform=\'\'"><div style="padding:16px 18px"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px"><div><div style="font-size:17px;font-weight:800">'+c.n+'</div><div style="font-size:11.5px;color:var(--g400);margin-top:2px">'+c.s+' \u00B7 '+c.e+' eleves</div></div><div class="nb" style="color:'+cn(c.m)+';font-size:12px;width:38px;height:38px">'+c.m+'</div></div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px"><span style="color:var(--g500)">Presence</span><span style="font-weight:700;color:'+(c.p>=92?'var(--success)':c.p>=85?'var(--warning)':'var(--rouge)')+'">'+c.p+'%</span></div><div class="pb"><div class="pf" style="width:'+c.p+'%;--c:'+(c.p>=92?'var(--success)':c.p>=85?'var(--warning)':'var(--rouge)')+'"></div></div><div style="display:flex;gap:6px;margin-top:12px"><button class="btn btn-l btn-sm" style="flex:1" onclick="toast(\''+c.n+'\')">Voir</button><button class="btn btn-l btn-sm" onclick="goto(\'edt\')">&#128197;</button></div></div></div>';}).join('');

  // Top classes dashboard
  document.getElementById('top-classes').innerHTML=[['Term S1',14.2],['Term L1',13.8],['1re S1',13.1],['2de B',12.9],['1re L1',12.6]].map(function(r,i){var c=r[0],m=r[1];return '<div style="display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid var(--g100)"><span style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400);width:14px">'+(i+1)+'</span><span style="flex:1;font-size:12.5px;font-weight:600">'+c+'</span><div class="nb" style="font-size:11px;width:34px;height:34px;color:'+cn(m)+'">'+m+'</div></div>';}).join('');

  // Taux presence dashboard
  document.getElementById('taux-presence').innerHTML=[['Lundi',94],['Mardi',91],['Mercredi',96],['Jeudi',88],['Vendredi',85]].map(function(r){var j=r[0],v=r[1];return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span style="color:var(--g700);font-weight:500">'+j+'</span><span style="font-weight:700;color:'+(v>=92?'var(--success)':v>=88?'var(--orange)':'var(--rouge)')+'">'+v+'%</span></div><div class="pb"><div class="pf" style="width:'+v+'%;--c:'+(v>=92?'var(--success)':v>=88?'var(--orange)':'var(--rouge)')+'"></div></div></div>';}).join('');

  // Absences top classes
  document.getElementById('cls-abs').innerHTML=[['3e B',22,'var(--rouge)'],['2de A',18,'var(--orange)'],['1re S2',14,'var(--warning)'],['6e A',11,'var(--warning)'],['Term L1',8,'var(--success)']].map(function(r){var c=r[0],n=r[1],col=r[2];return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span style="font-weight:600">'+c+'</span><span style="font-weight:700;color:'+col+'">'+n+' abs.</span></div><div class="pb"><div class="pf" style="width:'+(n/22*100)+'%;--c:'+col+'"></div></div></div>';}).join('');
}

// ── CHARTS ──────────────────────────────────────────────
var chartsInit = false;
function initCharts(){
  if(chartsInit) return; chartsInit = true;
  var V='#1A4731',O='#E07B39',R='#C0392B',S='#27AE60',B='#1A5276',W='#F39C12';

  new Chart(document.getElementById('c-moy'),{
    type:'line',
    data:{labels:['Sep','Oct','Nov','Dec','Jan','Fev'],datasets:[
      {label:'Term S1',data:[11.8,12.1,12.4,12.0,12.6,12.4],borderColor:V,backgroundColor:V+'18',tension:.4,fill:true,pointRadius:4},
      {label:'1re S1', data:[10.9,11.2,11.8,11.5,12.0,11.8],borderColor:O,backgroundColor:O+'18',tension:.4,fill:false,pointRadius:4},
      {label:'2de A',  data:[11.5,12.0,12.7,12.4,13.1,12.9],borderColor:B,backgroundColor:B+'18',tension:.4,fill:false,pointRadius:4},
    ]},
    options:{responsive:true,plugins:{legend:{position:'top',labels:{font:{family:'Sora',size:11},boxWidth:11}}},scales:{y:{min:9,max:16,grid:{color:'#F3F4F6'},ticks:{font:{family:'Sora',size:10}}},x:{grid:{color:'#F3F4F6'},ticks:{font:{family:'Sora',size:10}}}}},
  });

  new Chart(document.getElementById('c-donut'),{
    type:'doughnut',
    data:{datasets:[{data:[18,27,31,16,8],backgroundColor:[S,V,O,W,R],borderWidth:0,hoverOffset:5}]},
    options:{responsive:false,plugins:{legend:{display:false}},cutout:'68%'},
  });

  new Chart(document.getElementById('c-distrib'),{
    type:'bar',
    data:{labels:['0-4','4-6','6-8','8-10','10-12','12-14','14-16','16-18','18-20'],
      datasets:[{label:'Nb eleves',data:[12,28,45,89,187,224,189,124,48],
        backgroundColor:[R,R,R+'AA',W,O+'AA',V+'AA',V,S,S+'CC'],borderRadius:5}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#F3F4F6'},ticks:{font:{family:'Sora',size:10}}},x:{grid:{display:false},ticks:{font:{family:'Sora',size:10}}}}},
  });

  new Chart(document.getElementById('c-mat'),{
    type:'bar',
    data:{labels:['Maths','Francais','Physique','SVT','Anglais','Hist-Geo','Philo'],
      datasets:[
        {label:'T1',data:[11.8,12.4,11.0,13.2,12.7,13.9,11.5],backgroundColor:V+'40',borderRadius:4},
        {label:'T2',data:[11.4,12.1,8.1,13.5,13.2,14.1,11.1],backgroundColor:V,borderRadius:4},
      ]},
    options:{responsive:true,plugins:{legend:{position:'top',labels:{font:{family:'Sora',size:11},boxWidth:11}}},scales:{y:{min:6,max:16,grid:{color:'#F3F4F6'},ticks:{font:{family:'Sora',size:10}}},x:{grid:{display:false},ticks:{font:{family:'Sora',size:10}}}}},
  });

  new Chart(document.getElementById('c-abs'),{
    type:'bar',
    data:{labels:['Lun 24','Mar 25','Mer 26','Jeu 27','Ven 28'],
      datasets:[
        {label:'Injustifiees',data:[8,12,5,9,7],backgroundColor:R,borderRadius:4},
        {label:'Justifiees',data:[4,6,3,5,3],backgroundColor:W,borderRadius:4},
      ]},
    options:{responsive:true,plugins:{legend:{position:'top',labels:{font:{family:'Sora',size:11},boxWidth:11}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{family:'Sora',size:10}}},y:{stacked:true,grid:{color:'#F3F4F6'},ticks:{font:{family:'Sora',size:10}}}}},
  });
}

// ── EDT ─────────────────────────────────────────────────
function initEDT(){
  var jours=['','Lun 24','Mar 25','Mer 26','Jeu 27','Ven 28'];
  var heures=['07h-08h','08h-09h','09h-10h','10h-11h','11h-12h','14h-15h','15h-16h','16h-17h'];
  var cmat={'Mathematiques':'#1A5276','Physique':'#7D3C98','SVT':'#1E8449','Francais':'#B7950B','Anglais':'#1B4F72','Philo':'#6C3483','Hist-Geo':'#935116','EPS':'#1A6B3A'};
  var data=[
    [null,'Mathematiques\nM. Sow','Francais\nMme Diaw',null,'Physique\nM. Cisse'],
    ['SVT\nM. Diallo',null,'Anglais\nMme Fall','Hist-Geo\nM. Toure',null],
    ['Francais\nMme Diaw','Physique\nM. Cisse',null,'Mathematiques\nM. Sow','SVT\nM. Diallo'],
    [null,'EPS\nM. Badji','Hist-Geo\nM. Toure',null,'Anglais\nMme Fall'],
    ['Philo\nMme Sy',null,'Mathematiques\nM. Sow','Philo\nMme Sy',null],
    ['Anglais\nMme Fall','SVT\nM. Diallo',null,'Francais\nMme Diaw','Mathematiques\nM. Sow'],
    [null,'Hist-Geo\nM. Toure','Physique\nM. Cisse',null,'EPS\nM. Badji'],
    ['Mathematiques\nM. Sow',null,null,'SVT\nM. Diallo','Philo\nMme Sy'],
  ];
  var g=document.getElementById('edt-grid');
  g.className='edt-grid';
  g.innerHTML=jours.map(function(j){return '<div class="edt-h">'+j+'</div>';}).join('');
  heures.forEach(function(h,hi){
    g.innerHTML+='<div class="edt-t">'+h+'</div>';
    for(var j=0;j<5;j++){
      var v=data[hi]?data[hi][j]:null;
      if(v){var parts=v.split('\n');var m=parts[0];var e=parts[1];var c=cmat[m]||'#1A4731';g.innerHTML+='<div class="edt-slot" style="background:'+c+'14;border-left:3px solid '+c+'"><div class="edt-sm" style="color:'+c+'">'+m+'</div><div class="edt-si" style="color:'+c+'">'+e+'</div></div>';}
      else g.innerHTML+='<div class="edt-slot vide"></div>';
    }
  });
}

// ── SYNC ────────────────────────────────────────────────
function doSync(){
  var ico=document.getElementById('sync-ico');
  var a=0;var t=setInterval(function(){a+=36;ico.style.transform='rotate('+a+'deg)';},50);
  toast('Synchronisation en cours\u2026');
  setTimeout(function(){clearInterval(t);ico.style.transform='';toast('Synchronisation terminee \u2014 3 ens. \u00B7 47 notes \u00B7 12 presences','s');},2000);
}

// ── FILTRES ─────────────────────────────────────────────
function filtEl(q){document.querySelectorAll('#tb-eleves tr').forEach(function(r){r.style.display=r.textContent.toLowerCase().includes(q.toLowerCase())?'':'none';});}
function filtCls(c){document.querySelectorAll('#tb-eleves tr').forEach(function(r){r.style.display=(!c||r.textContent.includes(c))?'':'none';});}
