export interface PassiveHoverPoint {
  x: number;
  y: number;
}

export interface PassiveHoverTarget {
  id: string;
  disabled: boolean;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export function passiveHoverTargetAt(
  cursor: PassiveHoverPoint,
  windowOrigin: PassiveHoverPoint,
  targets: PassiveHoverTarget[],
): string | null {
  const x = cursor.x - windowOrigin.x;
  const y = cursor.y - windowOrigin.y;
  const target = targets.find(({ disabled, rect }) => (
    !disabled
      && x >= rect.left
      && x <= rect.right
      && y >= rect.top
      && y <= rect.bottom
  ));
  return target?.id ?? null;
}
