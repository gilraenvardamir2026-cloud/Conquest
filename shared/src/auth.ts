// Who may send which operation. The server enforces this; clients use it to
// explain why something is not allowed before sending.
//
// Defaults:
//  - spectators may only chat;
//  - a player moves and edits only their own regiments and characters, but
//    either player may apply wounds (the attacker often does);
//  - both players edit terrain, objectives and the board until the board is
//    locked (objective markers can still be damaged and removed afterwards);
//  - the "anyone can edit anything" room setting lifts the ownership rules;
//  - dice, undo (restore) and whole-battle replacement come from the server.

import { SERVER_ONLY_OPS, type Op } from './ops';
import type { Battle, PlayerSeat } from './types';

export type Actor = PlayerSeat | 'spectator';

/** Returns null when allowed, otherwise a short reason. */
export function authorize(b: Battle, actor: Actor, op: Op): string | null {
  if (SERVER_ONLY_OPS.includes(op.type)) return 'Only the server can do that';
  if (actor === 'spectator') return op.type === 'chat' ? null : 'Spectators can only chat';
  const casual = !!b.settings.anyoneCanEdit;
  const locked = !!b.settings.boardLocked;

  const ownRegiment = (id: string) => {
    const r = b.regiments.find((x) => x.id === id);
    if (!r) return null; // the reducer reports missing things
    return casual || r.owner === actor ? null : `${r.name} belongs to the other player`;
  };
  const ownCharacter = (id: string) => {
    const c = b.characters.find((x) => x.id === id);
    if (!c) return null;
    return casual || c.owner === actor ? null : `${c.name} belongs to the other player`;
  };
  const board = () => (locked && !casual ? 'The board is locked for the game' : null);

  switch (op.type) {
    // Regiments
    case 'addRegiment':
      return casual || op.regiment.owner === actor ? null : 'You can only add regiments to your own army';
    case 'updateRegiment':
      if (op.patch.owner && op.patch.owner !== actor && !casual) return 'You cannot give a regiment away';
      return ownRegiment(op.id);
    case 'moveRegiment':
    case 'setRegimentLocation':
    case 'removeRegiment':
    case 'addStands':
    case 'deleteStand':
    case 'setWoundsPerStand':
    case 'setCommandStand':
    case 'updateStand':
    case 'reformRegiment':
      return ownRegiment(op.id);
    // Wounds, casualties and their corrections: either player.
    case 'applyWounds':
    case 'adjustStandWounds':
    case 'removeStand':
    case 'restoreStand':
    case 'adjustCharacterWounds':
      return null;
    // Characters
    case 'addCharacter':
      return casual || op.character.owner === actor ? null : 'You can only add characters to your own army';
    case 'updateCharacter':
      if (op.patch.owner && op.patch.owner !== actor && !casual) return 'You cannot give a character away';
      return ownCharacter(op.id);
    case 'setCharacterLocation':
      return op.location === 'destroyed' ? null : ownCharacter(op.id);
    case 'moveCharacter':
    case 'removeCharacter':
      return ownCharacter(op.id);
    case 'attachCharacter':
      return ownCharacter(op.characterId) ?? ownRegiment(op.regimentId);
    case 'detachCharacter':
      return ownCharacter(op.characterId);
    // Board, scenario, terrain and objectives
    case 'setScenario':
    case 'updateBoard':
    case 'setTerrainLayout':
    case 'clearTerrain':
    case 'addTerrain':
    case 'updateTerrain':
    case 'removeTerrain':
    case 'addZone':
    case 'updateZone':
    case 'removeZone':
    case 'addObjectiveMarker':
    case 'updateObjectiveMarker':
    case 'removeObjectiveMarker':
      // The grid is only a view setting: always allowed.
      if (op.type === 'updateBoard' && Object.keys(op.patch).every((k) => k === 'grid')) return null;
      return board();
    case 'occupyGarrison': {
      if (op.regimentId) return ownRegiment(op.regimentId);
      const t = b.terrain.find((x) => x.id === op.terrainId);
      return t?.garrison?.occupiedBy ? ownRegiment(t.garrison.occupiedBy) : null;
    }
    case 'damageObjectiveMarker':
    case 'setObjectiveMarkerDestroyed':
      return null;
    // Players and settings
    case 'updatePlayer':
      return casual || op.seat === actor ? null : 'You can only rename your own seat';
    case 'renameBattle':
    case 'updateSettings':
      return null;
    // Everything shared
    case 'addMarker':
    case 'updateMarker':
    case 'removeMarker':
    case 'addMeasurement':
    case 'removeMeasurement':
    case 'clearMeasurements':
    case 'chat':
    case 'logNote':
      return null;
    case 'rollDice':
    case 'rerollDice':
    case 'restore':
    case 'replaceBattle':
      return 'Only the server can do that';
  }
}
