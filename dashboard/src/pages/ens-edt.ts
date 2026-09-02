import { PAGE_HOOKS } from '../router';
import { PageEnsEdt } from './ens-edt-page';
import { EdtDrawer } from './ens-edt-drawer';
import { EdtAppel } from './ens-edt-appel';

// HTML global — appelé depuis onclick dans index.html
(window as any).PageEnsEdt = PageEnsEdt;
(window as any).EdtDrawer  = EdtDrawer;
(window as any).EdtAppel   = EdtAppel;

PAGE_HOOKS['ens-edt'] = () => PageEnsEdt.init();
