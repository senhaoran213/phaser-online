import Phaser from "phaser";
import { TILE_SIZE } from "../maps/emeraldMap";

// 一个小工具函数：用纯色画矩形像素块。
// 因为我们现在没有正式 tileset 图片，所以先用代码画出临时地块。
function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

// 下面这些 drawXxx 函数分别负责画一种地块的“单帧贴图”。
// 它们最终会横向拼成一个 terrain 贴图集，再交给 Tilemap 使用。
function drawGrass(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "#57b45a");
  fillRect(ctx, offsetX + 1, 1, 6, 6, "#6ccb63");
  fillRect(ctx, offsetX + 9, 2, 5, 5, "#75d66d");
  fillRect(ctx, offsetX + 4, 9, 5, 5, "#6ccb63");
  fillRect(ctx, offsetX + 11, 10, 3, 3, "#3d8b44");
}

function drawPath(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "#d7b479");
  fillRect(ctx, offsetX + 1, 1, 14, 14, "#e2c98d");
  fillRect(ctx, offsetX + 3, 4, 3, 3, "#c79c5f");
  fillRect(ctx, offsetX + 9, 7, 2, 2, "#c79c5f");
  fillRect(ctx, offsetX + 11, 11, 3, 2, "#c79c5f");
}

function drawWater(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "#3c7fe0");
  fillRect(ctx, offsetX, 0, TILE_SIZE, 4, "#71b6ff");
  fillRect(ctx, offsetX + 2, 6, 4, 2, "#71b6ff");
  fillRect(ctx, offsetX + 9, 5, 5, 2, "#71b6ff");
  fillRect(ctx, offsetX + 5, 11, 6, 2, "#99d7ff");
}

function drawTree(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "#2f6c34");
  fillRect(ctx, offsetX + 1, 1, 14, 10, "#3f8f43");
  fillRect(ctx, offsetX + 3, 3, 10, 5, "#61bf53");
  fillRect(ctx, offsetX + 6, 10, 4, 6, "#8b5a2b");
}

function drawBush(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "rgba(0,0,0,0)");
  fillRect(ctx, offsetX + 1, 7, 14, 8, "#418d3c");
  fillRect(ctx, offsetX + 3, 5, 10, 6, "#5cbc55");
  fillRect(ctx, offsetX + 6, 3, 4, 4, "#7dd66d");
}

function drawRock(ctx: CanvasRenderingContext2D, offsetX: number) {
  fillRect(ctx, offsetX, 0, TILE_SIZE, TILE_SIZE, "rgba(0,0,0,0)");
  fillRect(ctx, offsetX + 3, 5, 10, 8, "#7f8790");
  fillRect(ctx, offsetX + 5, 3, 6, 4, "#939ca6");
  fillRect(ctx, offsetX + 7, 8, 2, 2, "#cbd2d9");
}

export function createTerrainTileset(scene: Phaser.Scene, textureKey: string) {
  // 避免重复创建同一个纹理。
  if (scene.textures.exists(textureKey)) {
    return;
  }

  // 创建一张画布纹理：宽度 = 6 种地块 * TILE_SIZE，高度 = 1 个 TILE_SIZE。
  const canvasTexture = scene.textures.createCanvas(textureKey, TILE_SIZE * 6, TILE_SIZE);
  if (!canvasTexture) {
    throw new Error(`Failed to create canvas texture: ${textureKey}`);
  }

  const ctx = canvasTexture.context;

  // 地块编号和这里的绘制顺序要保持一致：
  // 0 草地, 1 路, 2 水, 3 树, 4 草丛, 5 石头
  drawGrass(ctx, 0 * TILE_SIZE);
  drawPath(ctx, 1 * TILE_SIZE);
  drawWater(ctx, 2 * TILE_SIZE);
  drawTree(ctx, 3 * TILE_SIZE);
  drawBush(ctx, 4 * TILE_SIZE);
  drawRock(ctx, 5 * TILE_SIZE);

  // 刷新后 Phaser 才会真正拿到最新画好的纹理内容。
  canvasTexture.refresh();
}
