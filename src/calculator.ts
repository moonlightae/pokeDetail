export function calculateSpeed(
  baseStat: number,
  level: number,
  iv: number,
  ev: number,
  nature: number,
): number {
  const evPoint = Math.floor(ev / 4);
  const scaled = Math.floor(((baseStat * 2 + iv + evPoint) * level) / 100);
  return Math.floor((scaled + 5) * nature);
}

export function calculateRange(baseStat: number, level: number) {
  return {
    min: calculateSpeed(baseStat, level, 0, 0, 0.9),
    neutralMin: calculateSpeed(baseStat, level, 0, 0, 1),
    neutralMax: calculateSpeed(baseStat, level, 31, 252, 1),
    max: calculateSpeed(baseStat, level, 31, 252, 1.1),
  };
}
