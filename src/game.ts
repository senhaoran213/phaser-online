import Phaser from "phaser";


export class MyGame extends Phaser.Scene {
  private haruka!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  constructor() {
    super({ key: "MyGame" });
  }

  preload() {
    this.load.aseprite('haruka', '/player/haruka/Sprite-0002.png', '/player/haruka/Sprite-0002.json');
  }

  create() {
    this.anims.createFromAseprite('haruka');
    this.physics.world.setBounds(0, 0, 300, 300);

    this.haruka = this.physics.add.sprite(100, 100, 'haruka');
    this.haruka.play('stand');
    this.haruka.setCollideWorldBounds(true);

    this.cursors = this.input.keyboard!.createCursorKeys();
  }

  update() {
    this.haruka.setVelocity(0);

    const speed = 100;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left?.isDown) {
      vx = -speed;
      this.haruka.play('walk_left', true);
    } else if (this.cursors.right?.isDown) {
      vx = speed;
      this.haruka.play('walk_right', true);
    } else if (this.cursors.up?.isDown) {
      vy = -speed;
      this.haruka.play('walk_up', true);
    } else if (this.cursors.down?.isDown) {
      vy = speed;
      this.haruka.play('walk_down', true);
    } else {
      this.haruka.play('stand', true);
    }

    this.haruka.setVelocity(vx, vy);
  }
}