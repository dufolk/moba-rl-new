// Headless RL bridge: newline-delimited JSON over stdin/stdout.
// Runs N independent games in one process. Observations are returned as
// base64-encoded little-endian float32 / uint8 buffers for speed.
//
// Requests ({"cmd": ...}):
//   init   {num_envs, config, frame_skip, replay_dir, replay_every}
//   reset  {env_ids?, seeds?}
//   step   {actions: [[ [type,dir,target] | {raw cmd} , ...per agent], ...per env]}
//   command {env, team, cmd}               raw game command (any format game.command accepts)
//   state  {env}                           full JSON snapshot
//   save_replay {env, path}
//   spec / close

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Game } from '../src/sim/game.js';
import { encodeObs, decodeAction, OBS_DIM, MASK_DIM, ACTION_NVEC, ACTION_TYPES, TARGET_SLOTS } from '../src/sim/obs.js';
import { CHAMPION_KEYS } from '../src/sim/champions/index.js';
import { TICK_RATE } from '../src/sim/util.js';

let envs = [];
let opts = { num_envs: 1, config: {}, frame_skip: 4, replay_dir: null, replay_every: 0 };
let agentTeams = [0];
let episodeCounter = 0;

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function resolveConfig(base, seed, envIndex) {
  const cfg = { ...base, seed };
  // champions: fixed pair, or "random" per slot
  const champs = (cfg.champions || ['garen', 'darius']).map((c, i) => {
    if (c !== 'random') return c;
    const h = (seed * 2654435761 + envIndex * 97 + i * 31) >>> 0;
    return CHAMPION_KEYS[h % CHAMPION_KEYS.length];
  });
  cfg.champions = champs;
  cfg.controllers = cfg.controllers || ['external', 'bot'];
  cfg.autoLevel = cfg.autoLevel || [true, true];
  cfg.autoBuy = cfg.autoBuy || [true, true];
  return cfg;
}

function spec() {
  return {
    obs_dim: OBS_DIM, mask_dim: MASK_DIM, action_nvec: ACTION_NVEC, action_types: ACTION_TYPES,
    target_slots: TARGET_SLOTS, agent_teams: agentTeams, num_envs: envs.length, tick_rate: TICK_RATE,
    frame_skip: opts.frame_skip, champions: CHAMPION_KEYS,
  };
}

function newEnv(i, seed) {
  const cfg = resolveConfig(opts.config, seed, i);
  const g = new Game(cfg);
  g.drainDelta();
  g.drainEvents();
  return { game: g, seed, cfg, episodeReturn: 0, targets: agentTeams.map(() => []) };
}

function packObs(ids) {
  const obs = new Float32Array(ids.length * agentTeams.length * OBS_DIM);
  const masks = new Uint8Array(ids.length * agentTeams.length * MASK_DIM);
  ids.forEach((ei, row) => {
    const env = envs[ei];
    agentTeams.forEach((team, a) => {
      const k = row * agentTeams.length + a;
      const r = encodeObs(env.game, team, obs.subarray(k * OBS_DIM, (k + 1) * OBS_DIM));
      masks.set(r.mask, k * MASK_DIM);
      env.targets[a] = r.targets;
    });
  });
  return {
    obs: Buffer.from(obs.buffer).toString('base64'),
    masks: Buffer.from(masks.buffer).toString('base64'),
  };
}

function envInfo(env) {
  const g = env.game;
  return {
    seed: env.seed, tick: g.tick, time: g.time, over: g.over, winner: g.winner, timeout: g.timeout,
    champions: g.champions.map((c) => c.champ),
    levels: g.champions.map((c) => c.level),
    kills: g.champions.map((c) => c.kills),
    cs: g.champions.map((c) => c.cs),
    towers: g.towers.map((ts) => ts.filter((t) => t.alive).length),
  };
}

function maybeSaveReplay(env) {
  if (!opts.replay_dir || !opts.replay_every) return;
  episodeCounter++;
  if (episodeCounter % opts.replay_every !== 0) return;
  fs.mkdirSync(opts.replay_dir, { recursive: true });
  const g = env.game;
  const name = `ep${String(episodeCounter).padStart(6, '0')}_${g.champions.map((c) => c.champ).join('-vs-')}_w${g.winner}.json`;
  fs.writeFileSync(path.join(opts.replay_dir, name), JSON.stringify(g.exportReplay({ episode: episodeCounter })));
}

const handlers = {
  init(msg) {
    opts = { ...opts, ...msg };
    const ctrl = (opts.config.controllers || ['external', 'bot']);
    opts.config.controllers = ctrl;
    agentTeams = [0, 1].filter((t) => ctrl[t] === 'external');
    if (!agentTeams.length) throw new Error('at least one controller must be "external"');
    envs = [];
    for (let i = 0; i < opts.num_envs; i++) envs.push(newEnv(i, (opts.seed ?? 0) + i + 1));
    return { spec: spec() };
  },

  spec() {
    return { spec: spec() };
  },

  reset(msg) {
    const ids = msg.env_ids || envs.map((_, i) => i);
    ids.forEach((ei, j) => {
      const seed = msg.seeds && msg.seeds[j] != null ? msg.seeds[j] : (envs[ei].seed + envs.length);
      envs[ei] = newEnv(ei, seed);
    });
    return { ...packObs(ids), info: ids.map((i) => envInfo(envs[i])), env_ids: ids };
  },

  step(msg) {
    const ids = envs.map((_, i) => i);
    const stats = [];
    const done = [];
    const events = [];
    ids.forEach((ei) => {
      const env = envs[ei];
      const g = env.game;
      if (!g.over) {
        agentTeams.forEach((team, a) => {
          const act = msg.actions[ei][a];
          if (act == null) return;
          const cmd = Array.isArray(act) ? decodeAction(g, team, act, env.targets[a]) : act;
          if (cmd) g.command(team, cmd);
        });
        for (let k = 0; k < opts.frame_skip && !g.over; k++) g.step();
      }
      const evs = g.drainEvents();
      if (msg.want_events) events.push(evs);
      stats.push(g.drainDelta());
      done.push(g.over);
      if (g.over && !env.reported) {
        env.reported = true;
        maybeSaveReplay(env);
      }
    });
    return { ...packObs(ids), stats, done, info: ids.map((i) => envInfo(envs[i])), ...(msg.want_events ? { events } : {}) };
  },

  command(msg) {
    envs[msg.env].game.command(msg.team, msg.cmd);
    return {};
  },

  state(msg) {
    return { state: envs[msg.env ?? 0].game.snapshot() };
  },

  save_replay(msg) {
    const g = envs[msg.env ?? 0].game;
    fs.mkdirSync(path.dirname(path.resolve(msg.path)), { recursive: true });
    fs.writeFileSync(msg.path, JSON.stringify(g.exportReplay(msg.meta || {})));
    return { path: path.resolve(msg.path) };
  },

  close() {
    setImmediate(() => process.exit(0));
    return {};
  },
};

const rl = readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
    const h = handlers[msg.cmd];
    if (!h) throw new Error(`unknown cmd ${msg.cmd}`);
    out({ ok: true, ...h(msg) });
  } catch (err) {
    out({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
});
rl.on('close', () => process.exit(0));
