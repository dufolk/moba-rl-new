// Cumulative XP needed to reach level (index = level - 1).
export const XP_TABLE = [
  0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960, 11440, 13020, 14700, 16480, 18360,
];
export const MAX_LEVEL = 18;

export const DEFAULT_CONFIG = {
  startLevel: 3,
  startGold: 1400,
  passiveGoldPerSec: 3,
  firstWaveTime: 15,
  waveInterval: 25,
  cannonEvery: 3,
  minionXpRange: 1600,
  maxGameTime: 1800,
  respawnBase: 5,
  respawnPerLevel: 1.6,
  autoAttack: true,
  // Per team: 'human' | 'bot' | 'external' | 'idle'
  controllers: ['human', 'bot'],
  champions: ['garen', 'darius'],
  autoLevel: [false, true],
  autoBuy: [false, true],
  botDifficulty: 1.0,
  recordInputs: true,
};

export const MINIONS = {
  melee: { hp: 477, hpPer90s: 22, ad: 12, adPer90s: 0.6, as: 1.25, range: 110, ms: 325, armor: 0, mr: 0, radius: 48, gold: 21, xp: 61.75, windup: 0.4 },
  caster: { hp: 296, hpPer90s: 8, ad: 23, adPer90s: 1.5, as: 0.667, range: 550, ms: 325, armor: 0, mr: 0, radius: 48, gold: 14, xp: 30.4, windup: 0.3, projectileSpeed: 650 },
  cannon: { hp: 912, hpPer90s: 30, ad: 41, adPer90s: 2.5, as: 1.0, range: 300, ms: 325, armor: 15, mr: 0, radius: 65, gold: 60, xp: 92, windup: 0.3, projectileSpeed: 1200 },
};

export const TOWER = {
  hp: 3600,
  nexusTowerHp: 3000,
  armor: 40,
  mr: 40,
  range: 750,
  ad: 170,
  adPerMin: 6,
  as: 0.833,
  radius: 88,
  projectileSpeed: 1200,
  warmupPerShot: 0.4,
  warmupMax: 1.2,
  vsMinionPct: { melee: 0.45, caster: 0.7, cannon: 0.14 },
  minionDamageMult: 0.5,
};

export const NEXUS = { hp: 5500, armor: 0, mr: 0, regen: 5, radius: 230 };

export const RELIC = { firstSpawn: 30, respawn: 40, healFlat: 90, healPct: 0.08, radius: 90 };

export const SUMMONERS = {
  D: { name: 'Flash', cd: 300, range: 400 },
  F: { name: 'Ignite', cd: 180, range: 600, duration: 5 },
};

// Item catalog. `cost` is the total cost; owned components listed in `from`
// are consumed and discounted when buying, like the LoL shop.
export const ITEMS = {
  long_sword: { name: '长剑', cost: 350, ad: 10 },
  ruby_crystal: { name: '红水晶', cost: 400, hp: 150 },
  cloth_armor: { name: '布甲', cost: 300, armor: 15 },
  null_mantle: { name: '抗魔斗篷', cost: 450, mr: 25 },
  dagger: { name: '短剑', cost: 300, as: 0.12 },
  boots: { name: '鞋子', cost: 300, ms: 25 },
  pickaxe: { name: '十字镐', cost: 875, ad: 25 },
  giants_belt: { name: '巨人腰带', cost: 900, hp: 350 },
  steelcaps: { name: '铁板靴', cost: 1200, armor: 25, ms: 45, attackDr: 0.12, from: ['boots', 'cloth_armor'] },
  warhammer: { name: '考尔菲德战锤', cost: 1100, ad: 20, haste: 10, from: ['long_sword', 'long_sword'] },
  black_cleaver: { name: '黑色切割者', cost: 3000, ad: 40, hp: 400, haste: 20, cleave: true, from: ['warhammer', 'ruby_crystal'] },
  sterak: { name: '斯特拉克的挑战护手', cost: 3200, hp: 400, adBasePct: 0.45, from: ['giants_belt', 'pickaxe'] },
  trinity: { name: '三相之力', cost: 3333, ad: 36, as: 0.3, hp: 300, haste: 20, sheen: true, from: ['pickaxe', 'dagger', 'ruby_crystal'] },
  sunfire: { name: '日炎圣盾', cost: 2700, hp: 450, armor: 35, haste: 15, immolate: true, from: ['giants_belt', 'cloth_armor'] },
  deaths_dance: { name: '死亡之舞', cost: 3300, ad: 55, armor: 45, haste: 15, from: ['pickaxe', 'cloth_armor', 'long_sword'] },
  spirit_visage: { name: '振奋盔甲', cost: 2900, hp: 450, mr: 40, haste: 10, healAmp: 0.25, from: ['giants_belt', 'null_mantle'] },
};

/** Price and consumed inventory indices when buying `id` with inventory `items`. */
export function itemPrice(items, id) {
  const it = ITEMS[id];
  const inv = items.map((x, i) => [x, i]);
  const used = [];
  let price = it.cost;
  for (const comp of it.from || []) {
    const k = inv.findIndex(([x, i]) => x === comp && !used.includes(i));
    if (k >= 0) {
      used.push(inv[k][1]);
      price -= ITEMS[comp].cost;
    }
  }
  return { price, used };
}
export const ITEM_IDS = Object.keys(ITEMS);
export const MAX_ITEMS = 6;
