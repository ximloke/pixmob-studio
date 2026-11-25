import blindingLights from "../shows/blinding-light-half-version.pixmob-show.json";
import {
  MAX_SONG_SHOWS,
  importSongShow,
  readSongShows,
  saveSongShows,
} from "./songShow";
import type { SongShow } from "./songShow";

/**
 * Shows that come with the site. Each one is added once to a browser's saved
 * shows, so it is there on a new address or device without importing a file.
 * A show never contains its audio.
 */
export const BUILT_IN_SHOWS: readonly SongShow[] = [
  // The user's own show (exported 14 Nov 2026). Built in on 25 Nov 2026 at
  // the user's request, with every cue on The Weeknd wristband profile (two
  // cues were Taylor Swift).
  importSongShow(JSON.stringify(blindingLights)),
];

/** The ids of the built-in shows this browser has already been given. */
export const BUILT_IN_SHOWS_STORAGE_KEY = "pixmob-song-shows-built-in-v1";

/**
 * The saved shows plus every built-in show this browser has not been given
 * yet, added at the end. A built-in show the user deleted is not added again,
 * a saved show with the same id is left as it is, and nothing is added beyond
 * the show limit (that show is offered again once there is room).
 */
export function addBuiltInShows(
  shows: readonly SongShow[],
  given: readonly string[],
  builtIn: readonly SongShow[] = BUILT_IN_SHOWS,
): { shows: SongShow[]; given: string[]; added: SongShow[] } {
  const next = [...shows];
  const nextGiven = [...given];
  const added: SongShow[] = [];
  for (const show of builtIn) {
    if (nextGiven.includes(show.id)) continue;
    if (next.some((item) => item.id === show.id)) {
      nextGiven.push(show.id);
      continue;
    }
    if (next.length >= MAX_SONG_SHOWS) continue;
    const copy = structuredClone(show);
    next.push(copy);
    nextGiven.push(show.id);
    added.push(copy);
  }
  return { shows: next, given: nextGiven, added };
}

function readGiven(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(BUILT_IN_SHOWS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(0, 256)
      : [];
  } catch {
    return [];
  }
}

/**
 * readSongShows plus the built-in shows this browser has not been given yet,
 * saved straight away. Saved shows that cannot be read are never written over.
 */
export function readSongShowsWithBuiltIns(
  storage: Pick<Storage, "getItem" | "setItem">,
  builtIn: readonly SongShow[] = BUILT_IN_SHOWS,
): { shows: SongShow[]; error?: string; added: SongShow[] } {
  const saved = readSongShows(storage);
  if (saved.error) return { ...saved, added: [] };
  const given = readGiven(storage);
  const result = addBuiltInShows(saved.shows, given, builtIn);
  if (result.given.length === given.length)
    return { shows: saved.shows, added: [] };
  try {
    if (result.added.length) saveSongShows(result.shows, storage);
    storage.setItem(BUILT_IN_SHOWS_STORAGE_KEY, JSON.stringify(result.given));
    return { shows: result.shows, added: result.added };
  } catch {
    return { shows: saved.shows, added: [] };
  }
}
