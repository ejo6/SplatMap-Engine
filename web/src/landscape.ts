// An original, deterministic point-cloud landscape for the placeholder cover.
export function drawLandscape(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = 1000, height = 760;
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = '#0b1720';
  ctx.fillRect(0, 0, width, height);
  let seed = 67;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  // Project rows of sampled terrain, hiding points below nearer ridge lines.
  const horizon = new Float32Array(width).fill(height);
  for (let row = 0; row < 480; row++) {
    const z = 1 - row / 480;
    for (let x = 0; x < width; x += 2) {
      const u = x / width;
      const wave = Math.sin(u * 9 + z * 6) + .55 * Math.cos(u * 23 - z * 9)
        + .24 * Math.sin(u * 53 + z * 27) + .09 * Math.sin(u * 130 + z * 47);
      const ridge = Math.abs(u - .55 + .12 * Math.sin(z * 8));
      const y = 236 + z * 565 - (ridge * 270 + 41 * wave) * (.5 + z);
      if (y > horizon[x]) continue;
      horizon[x] = y;
      if (random() > .51) continue;
      const warmth = .48 + .52 * Math.cos(u * 8 + z * 5);
      const light = (.4 + .6 * random()) * (.55 + .45 * z);
      ctx.fillStyle = `rgba(${105 + 143 * warmth},${187 - 29 * warmth},${195 - 83 * warmth},${light})`;
      ctx.fillRect(x + random(), y, 1 + z, 1 + z);
    }
  }
  // A freestanding doorway marks the transition from watching to exploring.
  ctx.strokeStyle = '#ffab77';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff9254';
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.moveTo(551, 445); ctx.lineTo(551, 290); ctx.lineTo(620, 277);
  ctx.lineTo(620, 437); ctx.stroke();
}
