// 项目入口：
// 1. 引入 Phaser 本体
// 2. 引入我们整理好的游戏配置
// 3. 引入全局样式，让页面容器能正确显示游戏画布
import Phaser from "phaser";
import { gameConfig } from "./config/gameConfig";
import "./style.css";

// 创建 Phaser.Game 之后，Phaser 会自动进入配置里的第一个场景。
new Phaser.Game(gameConfig);
