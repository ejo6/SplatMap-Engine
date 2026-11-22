/** YouTube t is absolute; the packaged video's clock starts at sourceStart. */
export function handoffPosition(raw: string | null, sourceStart: number, duration: number, fps: number) {
  const sourceTime = Number(raw);
  if (!raw?.trim() || !Number.isFinite(sourceTime) || sourceTime < 0) {
    return { time: 0, play: true };
  }
  const time = Math.max(0, sourceTime - sourceStart);
  // Hold the final frame on a late handoff so autoplay + loop cannot immediately wrap to zero.
  if (time >= duration) return { time: Math.max(0, duration - 1 / fps), play: false };
  return { time, play: true };
}
