// Client-side helpers that build operations (new ids are chosen here, never in the reducer).

import {
  createRegiment,
  makeId,
  presetFor,
  REGIMENT_DEFAULTS,
  regimentLocalBox,
  type Battle,
  type Character,
  type PlayerSeat,
  type Regiment,
  type StandType,
  type Terrain,
} from '@conquest/shared';
import { dispatch, useStore } from '../store';
import { poseCentredAt, seatFacing } from '../board/theme';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pose at the centre of the owner's reinforcement edge, just inside the board, facing the enemy. */
export function edgePose(b: Battle, owner: PlayerSeat, w: number, d: number) {
  const angle = seatFacing(owner);
  const cy = owner === 'p1' ? b.board.depth - d / 2 - 0.05 : d / 2 + 0.05;
  const p = poseCentredAt(w, d, angle, { x: b.board.width / 2, y: cy });
  return { x: round2(p.x), y: round2(p.y), angle };
}

export function deployRegiment(b: Battle, r: Regiment) {
  const box = regimentLocalBox(r);
  dispatch({ type: 'setRegimentLocation', id: r.id, location: 'board', pose: edgePose(b, r.owner, box.u1, box.v1) });
  useStore.getState().select({ kind: 'regiment', id: r.id });
}

export function deployCharacter(b: Battle, c: Character) {
  dispatch({ type: 'setCharacterLocation', id: c.id, location: 'board', pose: edgePose(b, c.owner, c.standW, c.standD) });
  useStore.getState().select({ kind: 'character', id: c.id });
}

export function addRegiment(
  b: Battle,
  p: { owner: PlayerSeat; name: string; standType: StandType; stands: number; files: number; wounds: number; w?: number; d?: number; size?: number },
) {
  const preset = presetFor(b.settings, p.standType);
  const reg = createRegiment({
    id: makeId(),
    owner: p.owner,
    name: p.name,
    standType: p.standType,
    preset: { w: p.w ?? preset.w, d: p.d ?? preset.d, size: p.size ?? preset.size },
    stands: p.stands,
    files: p.files,
    woundsMax: p.wounds,
    location: 'reserve',
  });
  if (dispatch({ type: 'addRegiment', regiment: reg })) useStore.getState().select({ kind: 'regiment', id: reg.id });
}

export function addCharacter(b: Battle, owner: PlayerSeat) {
  const preset = presetFor(b.settings, 'infantry');
  const c: Character = {
    id: makeId(),
    owner,
    name: 'New character',
    notes: '',
    standType: 'infantry',
    standW: preset.w,
    standD: preset.d,
    woundsMax: 5,
    wounds: 0,
    location: 'reserve',
  };
  if (dispatch({ type: 'addCharacter', character: c })) useStore.getState().select({ kind: 'character', id: c.id });
}

export function duplicateRegiment(r: Regiment) {
  const id = makeId();
  const remap = (s: Regiment['stands'][number], i: number) => ({ ...s, id: `${id}-s${i}`, wounds: 0 });
  const all = [...r.stands, ...r.casualties];
  const { characterId: _c, characterSlot: _s, garrisonId: _g, ...rest } = r;
  const copy: Regiment = {
    ...rest,
    id,
    name: `${r.name} (copy)`,
    stands: all.map(remap),
    casualties: [],
    location: 'reserve',
    tags: [],
  };
  if (dispatch({ type: 'addRegiment', regiment: copy })) useStore.getState().select({ kind: 'regiment', id });
}

export function duplicateTerrain(t: Terrain) {
  const id = makeId();
  const { garrison, ...rest } = t;
  const copy: Terrain = {
    ...rest,
    id,
    x: t.x + 3,
    y: t.y + 3,
    locked: false,
    ...(garrison ? { garrison: { defense: garrison.defense, capacity: garrison.capacity } } : {}),
  };
  if (dispatch({ type: 'addTerrain', terrain: copy })) useStore.getState().select({ kind: 'terrain', id });
}

export const regimentDefaults = REGIMENT_DEFAULTS;

/** Save a JSON file in the browser. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
