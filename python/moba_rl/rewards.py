"""Reward shaping computed from per-step game counters reported by the simulator.

Counters (per team, accumulated over the frame-skipped step):
    dmgToChamp, dmgTakenChamp, dmgTakenOther, dmgToStructure, gold, xp,
    lastHits, kills, deaths, towerKills, towersLost, healed
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RewardConfig:
    weights: dict = field(
        default_factory=lambda: {
            "dmgToChamp": 0.004,
            "dmgTakenChamp": -0.003,
            "dmgTakenOther": -0.002,
            "dmgToStructure": 0.001,
            "gold": 0.001,
            "xp": 0.0005,
            "lastHits": 0.1,
            "kills": 2.0,
            "deaths": -2.0,
            "towerKills": 1.5,
            "towersLost": -1.5,
            "healed": 0.001,
        }
    )
    win: float = 10.0
    loss: float = -10.0
    # Subtract the opponent's shaped reward (makes self-play zero-sum).
    zero_sum: bool = False
    time_penalty: float = 0.0

    def shaped(self, counters: dict) -> float:
        return sum(w * counters.get(k, 0.0) for k, w in self.weights.items())

    def __call__(self, stats: list[dict], team: int, done: bool, winner: int) -> float:
        r = self.shaped(stats[team])
        if self.zero_sum:
            r -= self.shaped(stats[1 - team])
        r -= self.time_penalty
        if done and winner >= 0:
            r += self.win if winner == team else self.loss
        return r
