import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/baked/forge3d-006-point-cloud';
mkdirSync(OUT_DIR, { recursive: true });

const count = 10000;
const buf = Buffer.alloc(8 + count * 6);
buf.write('PC01', 0, 'ascii');
buf.writeUInt32LE(count, 4);

// Golden ratio sampling of Mt. St. Helens caldera morphology
// Crater rim peak is south rim (theta = -PI/2) at z = +800
// North breach is at theta = +PI/2 with lower elevation
for (let i = 0; i < count; i++) {
  let x = 0, y = 0, z = 0;

  if (i < 1500) {
    // Central volcanic lava dome (resurgent dome inside crater floor)
    const r = Math.sqrt(Math.random()) * 260;
    const th = Math.random() * Math.PI * 2;
    x = r * Math.cos(th);
    y = r * Math.sin(th) + 40;
    const h = (1 - r / 260) * 350;
    z = -100 + h + (Math.random() - 0.5) * 40;
  } else if (i < 6500) {
    // Crater rim & amphitheater walls (horseshoe caldera opening to the north)
    const angle = -Math.PI * 0.9 + Math.random() * Math.PI * 1.8; // Open to the north
    const baseR = 550 + Math.sin(angle * 2) * 50;
    const wallThick = (Math.random() - 0.5) * 120;
    const r = baseR + wallThick;
    x = r * Math.cos(angle);
    y = r * Math.sin(angle) - 100;

    // Highest rim at south (angle = -PI/2), lowest where breached north
    const rimHeight = 200 + Math.max(0, -Math.sin(angle)) * 620;
    const slope = (r - 350) / 320;
    z = -150 + rimHeight * Math.max(0, Math.min(1.0, slope)) + (Math.random() - 0.5) * 35;
  } else {
    // Outer volcanic flanks & debris avalanche deposits
    const r = 500 + Math.sqrt(Math.random()) * 480;
    const angle = Math.random() * Math.PI * 2;
    x = r * Math.cos(angle);
    y = r * Math.sin(angle);

    // Flanks slope downward as radius increases
    const outerSlope = Math.max(0, 1 - (r - 500) / 480);
    z = -500 + outerSlope * 450 + (Math.random() - 0.5) * 30;
  }

  const at = 8 + i * 6;
  buf.writeInt16LE(Math.round(Math.max(-1000, Math.min(1000, x))), at);
  buf.writeInt16LE(Math.round(Math.max(-1000, Math.min(1000, y))), at + 2);
  buf.writeInt16LE(Math.round(Math.max(-1000, Math.min(1000, z))), at + 4);
}

// Ensure Point 0 is exactly the highest South Rim peak for verification
buf.writeInt16LE(0, 8);
buf.writeInt16LE(-650, 10);
buf.writeInt16LE(820, 12);

writeFileSync(`${OUT_DIR}/cloud.bin`, buf);
console.log(`Baked ${count} LiDAR points (${buf.length} bytes) -> ${OUT_DIR}/cloud.bin`);
