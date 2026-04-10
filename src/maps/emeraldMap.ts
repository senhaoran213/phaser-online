// 一块地砖使用 16x16，和经典 GBA 像素风地图尺寸接近。
export const TILE_SIZE = 16;

// 这里不是图片资源，而是“地块编号”的语义定义。
// 后面地图数组里写 0/1/2 可读性太差，所以用名字映射会更清楚。
export const TerrainTile = {
  Grass: 0,
  Path: 1,
  Water: 2,
  Tree: 3,
  Bush: 4,
  Rock: 5
} as const;

const G = TerrainTile.Grass;
const P = TerrainTile.Path;
const W = TerrainTile.Water;
const T = TerrainTile.Tree;
const B = TerrainTile.Bush;
const R = TerrainTile.Rock;

// groundData 是底层地图：
// 每个数字都代表一块基础地形，比如草地、路、水、树。
// 这层通常用来铺满整个世界。
export const groundData = [
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T],
  [T, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, G, G, P, P, P, P, P, G, G, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, P, P, P, P, P, P, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, W, W, W, W, G, P, P, P, P, P, P, P, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, W, W, W, W, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, W, W, W, W, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, P, P, P, P, P, P, P, P, P, G, G, G, G, G, G, G, G, G, T],
  [T, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, T],
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T]
];

// detailData 是上层装饰：
// -1 表示这个位置不放任何地块
// 其他编号表示在该格子上额外叠一层草丛、石头之类的物件。
// 这类层很适合做“装饰 + 碰撞物”。
export const detailData = [
  [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  [-1, -1, B, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1],
  [-1, -1, -1, -1, R, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, R, -1, -1, -1, B, -1, -1, -1, -1, -1, -1],
  [-1, -1, -1, B, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, B, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, R, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, R, -1, -1, -1, -1, -1, -1, -1, -1],
  [-1, -1, B, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, B, -1, -1, -1, -1, -1, -1],
  [-1, -1, -1, -1, R, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, R, -1, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, R, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, B, -1, -1],
  [-1, -1, B, -1, -1, -1, B, -1, -1, R, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, B, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, R, -1, -1, B, -1, -1, -1, -1, -1, R, -1, -1, -1, -1, -1],
  [-1, -1, -1, B, -1, -1, -1, R, -1, -1, -1, -1, B, -1, -1, -1, -1, B, -1, -1, -1, R, -1, -1, -1, -1, -1, B, -1, -1],
  [-1, -1, -1, -1, -1, B, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, R, -1, -1, -1, B, -1, -1, -1, -1, B, -1, -1, -1, -1],
  [-1, -1, B, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, R, -1],
  [-1, -1, -1, -1, -1, -1, R, -1, -1, -1, -1, -1, B, -1, -1, -1, -1, B, -1, -1, -1, -1, -1, R, -1, -1, -1, B, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]
];

// 下面这些是根据地图数组自动计算出来的尺寸信息，
// 场景里会拿它们来设置世界边界和相机边界。
export const mapWidth = groundData[0].length;
export const mapHeight = groundData.length;
export const worldWidth = mapWidth * TILE_SIZE;
export const worldHeight = mapHeight * TILE_SIZE;

// 玩家初始出生点。这里用像素坐标，不是 tile 坐标。
export const PLAYER_SPAWN = {
  x: 14 * TILE_SIZE + TILE_SIZE / 2,
  y: 8 * TILE_SIZE + TILE_SIZE / 2
};
