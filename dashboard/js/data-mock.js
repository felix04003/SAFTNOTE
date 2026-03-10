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
var BULL=[
  ['Term S1',42,42,38,12.4,'Aissatou Camara','81%'],
  ['Term L1',38,38,35,13.1,'Awa Ba','87%'],
  ['1re S1',45,40,0,11.8,'\u2014','69%'],
  ['2de A',48,48,0,12.9,'Mariam Coulibaly','72%'],
  ['3e A',52,52,25,11.5,'Khadi Mbaye','68%'],
  ['3e B',50,0,0,null,'\u2014','\u2014'],
  ['6e A',54,54,40,13.7,'Adja Sow','84%'],
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
