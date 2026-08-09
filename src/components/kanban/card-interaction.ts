export interface PointerCoordinates {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export const CARD_DRAG_THRESHOLD = 8;

export function shouldOpenCardAfterPointer(pointer: PointerCoordinates): boolean {
  return Math.hypot(pointer.endX - pointer.startX, pointer.endY - pointer.startY) < CARD_DRAG_THRESHOLD;
}
