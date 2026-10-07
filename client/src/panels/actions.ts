// Client-side helpers that build operations (new ids are chosen here, never in the reducer).

import {
  armyFromBattle,
  armyOps,
  createRegiment,
  deployPose,
  makeId,
  presetFor,
  REGIMENT_DEFAULTS,
  parseArmy,
  type ArmyList,
  type DeployEdge,
  type Battle,
  type Character,
  type PlayerSeat,
  type Regiment,
  type StandType,
  type Terrain,
} from '@conquest/shared';
import { dispatch, useStore } from '../store';

/** Deploy from reserve: off the table, front rank touching the own long edge or a side edge (see shared/src/deploy.ts). */
export function deployRegiment(b: Battle, r: Regiment, edge: DeployEdge = 'own') {
  if (dispatch({ type: 'setRegimentLocation', id: r.id, location: 'board', pose: deployPose(b, r, edge) })) useStore.getState().select({ kind: 'regiment', id: r.id });
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

const LAST_ARMY_KEY = 'conquest.army.last';

/** The army list loaded last in this browser, if any. */
export function lastArmy(): ArmyList | null {
  try {
    const raw = localStorage.getItem(LAST_ARMY_KEY);
    const r = raw ? parseArmy(JSON.parse(raw)) : null;
    return r?.ok ? r.army : null;
  } catch {
    return null;
  }
}

export function saveArmy(b: Battle, seat: PlayerSeat) {
  const list = armyFromBattle(b, seat);
  if (!list.regiments.length && !list.characters.length) return useStore.getState().notify('Nothing to save: this army has no units yet');
  downloadJson(`${list.name.replace(/[^\w-]+/g, '_')}.army.json`, list);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Add an army list to a seat's reserve. */
export function loadArmy(b: Battle, seat: PlayerSeat, army: ArmyList) {
  const st = useStore.getState();
  const has = b.regiments.some((r) => r.owner === seat) || b.characters.some((c) => c.owner === seat);
  if (has && !confirm(`${b.players[seat].name} already has units. Add "${army.name}" to them?`)) return;
  let added = 0;
  for (const op of armyOps(army, seat, makeId)) if (dispatch(op)) added++;
  if (!added) return;
  try {
    localStorage.setItem(LAST_ARMY_KEY, JSON.stringify(army));
  } catch {
    /* storage full or blocked: only the shortcut is lost */
  }
  st.notify(`Loaded "${army.name}": ${plural(army.regiments.length, 'regiment')} and ${plural(army.characters.length, 'character')} in reserve`);
}

/** Read an army list file chosen by the user. */
export async function readArmyFile(file: File): Promise<ArmyList | null> {
  try {
    const r = parseArmy(JSON.parse(await file.text()));
    if (r.ok) return r.army;
    useStore.getState().notify(r.error);
  } catch {
    useStore.getState().notify('That file is not valid JSON');
  }
  return null;
}
