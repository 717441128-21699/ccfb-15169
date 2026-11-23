// 简易画布折线图(趋势页)

export interface Series {
  label: string;
  color: string;
  points: { t: number; v: number }[];
}

export interface ChartOpts {
  yLabel: string;
  yMin?: number;
  yMax?: number;
  /** 控制限(虚线) */
  limits?: { v: number; label: string; color?: string }[];
}

export function drawChart(canvas: HTMLCanvasElement, series: Series[], opts: ChartOpts): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 260;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const styles = getComputedStyle(document.body);
  const fg = styles.getPropertyValue('--fg').trim() || '#ddd';
  const grid = styles.getPropertyValue('--grid').trim() || '#444';

  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  const all = series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => !isNaN(v));
  if (all.length === 0) {
    g.fillStyle = fg;
    g.font = '13px system-ui';
    g.fillText('暂无数据 — 请先在检测页扫描印张', padL, H / 2);
    return;
  }
  let yMin = opts.yMin ?? Math.min(...all);
  let yMax = opts.yMax ?? Math.max(...all);
  for (const l of opts.limits ?? []) {
    yMin = Math.min(yMin, l.v);
    yMax = Math.max(yMax, l.v);
  }
  const margin = (yMax - yMin) * 0.12 || 0.01;
  yMin -= margin;
  yMax += margin;

  const tMin = Math.min(...series.flatMap((s) => s.points.map((p) => p.t)));
  const tMax = Math.max(...series.flatMap((s) => s.points.map((p) => p.t)));
  const x = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  // 网格与坐标
  g.strokeStyle = grid;
  g.fillStyle = fg;
  g.font = '11px system-ui';
  g.lineWidth = 1;
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    const yy = y(v);
    g.beginPath();
    g.moveTo(padL, yy);
    g.lineTo(W - padR, yy);
    g.stroke();
    g.fillText(v.toFixed(2), 4, yy + 4);
  }
  g.fillText(opts.yLabel, 4, padT - 2);

  // 控制限
  for (const l of opts.limits ?? []) {
    g.save();
    g.setLineDash([5, 4]);
    g.strokeStyle = l.color ?? '#c66';
    g.beginPath();
    g.moveTo(padL, y(l.v));
    g.lineTo(W - padR, y(l.v));
    g.stroke();
    g.restore();
    g.fillStyle = l.color ?? '#c66';
    g.fillText(l.label, W - padR - 60, y(l.v) - 3);
  }

  // 折线
  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 1.8;
    g.beginPath();
    let started = false;
    for (const p of s.points) {
      if (isNaN(p.v)) continue;
      const px = x(p.t);
      const py = y(p.v);
      if (!started) {
        g.moveTo(px, py);
        started = true;
      } else g.lineTo(px, py);
    }
    g.stroke();
    // 图例
  }
  let lx = padL + 8;
  for (const s of series) {
    g.fillStyle = s.color;
    g.fillRect(lx, H - 16, 10, 3);
    g.fillText(s.label, lx + 14, H - 10);
    lx += 14 + g.measureText(s.label).width + 18;
  }
}
