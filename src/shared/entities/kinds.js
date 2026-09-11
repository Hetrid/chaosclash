// Entity kind helpers (shared by sim, AI, client, server).
export const isHero = u => u?.kind === 'hero';
export const isMinion = u => u?.kind === 'minion';
export const isMonster = u => u?.kind === 'monster';
export const isTurret = u => u?.kind === 'turret';
export const isCore = u => u?.kind === 'core';
export const isStructure = u => isTurret(u) || isCore(u);
export const isSummon = u => u?.kind === 'summon';
export const isUnit = u => u && (isHero(u) || isMinion(u) || isMonster(u) || isSummon(u));
export const isCombatUnit = u => isUnit(u) || isStructure(u);
