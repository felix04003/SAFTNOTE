export function escapeHtml(str: any): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function cn(val: number | null | undefined): string {
  if (val == null) return 'var(--g400)';
  if (val >= 14) return 'var(--vert)';
  if (val >= 10) return 'var(--orange)';
  return 'var(--rouge)';
}

export function parCn(val: number | null | undefined): string {
  if (val == null) return 'var(--g500)';
  if (val >= 14) return 'var(--vert)';
  if (val >= 10) return 'var(--orange)';
  return 'var(--rouge)';
}

export function init2(nom: string): string {
  const parts = (nom || '').trim().split(/\s+/);
  return ((parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function toast(msg: string, type: string = 'i') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const bg = type === 's' ? '#22c55e' : type === 'e' || type === 'd' ? '#ef4444' : type === 'w' ? '#f59e0b' : '#3b82f6';
  const el = document.createElement('div');
  el.style.cssText = 'background:' + bg + ';color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.15)';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function openModal(id: string) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; el.classList.add('open'); }
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('show');
}

export function closeModal(id: string) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; el.classList.remove('open'); }
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('show');
}

export function sparkline(canvasId: string, data: number[], color: string) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!data.length) return;
  const max = Math.max(...data) || 1;
  const step = w / (data.length - 1 || 1);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

(window as any).escapeHtml = escapeHtml;
(window as any).cn = cn;
(window as any).parCn = parCn;
(window as any)._parCn = parCn;
(window as any).init2 = init2;
(window as any).toast = toast;
(window as any).openModal = openModal;
(window as any).closeModal = closeModal;
(window as any).sparkline = sparkline;
