// Where the photo's waterline lands on screen when the photo is drawn with `object-fit: cover`.
// No imports so node --test can load it directly.

/** Fraction of the hero photo's height where the lake meets the shore (Moraine Lake at 6AM, measured). */
export const PHOTO = { width: 2560, height: 1710, waterline: 0.606 };

/** Y (px from the container top) of the waterline for a cover-fit image at vertical object-position `posY` (0..1). */
export function waterlineY(boxW: number, boxH: number, posY = 0.5, photo = PHOTO): number {
  const scale = Math.max(boxW / photo.width, boxH / photo.height);
  const drawnH = photo.height * scale;
  return (boxH - drawnH) * posY + photo.waterline * drawnH;
}
