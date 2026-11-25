import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_SHOWS,
  BUILT_IN_SHOWS_STORAGE_KEY,
  addBuiltInShows,
  readSongShowsWithBuiltIns,
} from "../src/lib/builtInShows";
import {
  MAX_SONG_SHOWS,
  SONG_SHOW_STORAGE_KEY,
  createSongShow,
  mainSongProfile,
  readSongShows,
  validSongShow,
} from "../src/lib/songShow";
import type { SongShow } from "../src/lib/songShow";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const blindingLights = BUILT_IN_SHOWS[0];

test("Blinding Lights is built in with The Weeknd profile on every cue", () => {
  assert.equal(BUILT_IN_SHOWS.length, 1);
  assert.equal(blindingLights.name, "blinding light (half version)");
  assert.equal(blindingLights.id, "617960cf-dfba-49e8-ac7d-c577eba1f761");
  assert.equal(blindingLights.cues.length, 237);
  assert.ok(validSongShow(blindingLights));
  assert.ok(
    blindingLights.cues.every((cue) => cue.lighting.profile === "The Weeknd"),
  );
  assert.equal(mainSongProfile(blindingLights), "The Weeknd");
});

test("a browser without shows gets the built-in show, once", () => {
  const storage = memoryStorage();
  const first = readSongShowsWithBuiltIns(storage);
  assert.equal(first.error, undefined);
  assert.deepEqual(
    first.shows.map((show) => show.id),
    [blindingLights.id],
  );
  assert.deepEqual(
    first.added.map((show) => show.name),
    [blindingLights.name],
  );
  assert.deepEqual(readSongShows(storage).shows, first.shows);
  assert.deepEqual(JSON.parse(storage.data.get(BUILT_IN_SHOWS_STORAGE_KEY)!), [
    blindingLights.id,
  ]);

  const again = readSongShowsWithBuiltIns(storage);
  assert.equal(again.added.length, 0);
  assert.equal(again.shows.length, 1);
});

test("a deleted built-in show is not added again", () => {
  const storage = memoryStorage({
    [SONG_SHOW_STORAGE_KEY]: "[]",
    [BUILT_IN_SHOWS_STORAGE_KEY]: JSON.stringify([blindingLights.id]),
  });
  const result = readSongShowsWithBuiltIns(storage);
  assert.deepEqual(result.shows, []);
  assert.deepEqual(result.added, []);
});

test("the user's own copy with the same id is left as it is", () => {
  const own: SongShow = structuredClone(blindingLights);
  own.cues[0].lighting.profile = "Taylor Swift";
  const storage = memoryStorage({
    [SONG_SHOW_STORAGE_KEY]: JSON.stringify([own]),
  });
  const result = readSongShowsWithBuiltIns(storage);
  assert.equal(result.added.length, 0);
  assert.equal(result.shows.length, 1);
  assert.equal(result.shows[0].cues[0].lighting.profile, "Taylor Swift");
  assert.deepEqual(JSON.parse(storage.data.get(BUILT_IN_SHOWS_STORAGE_KEY)!), [
    blindingLights.id,
  ]);
});

test("saved shows that cannot be read are never written over", () => {
  const storage = memoryStorage({ [SONG_SHOW_STORAGE_KEY]: "{not json" });
  const result = readSongShowsWithBuiltIns(storage);
  assert.ok(result.error);
  assert.deepEqual(result.shows, []);
  assert.equal(storage.data.get(SONG_SHOW_STORAGE_KEY), "{not json");
  assert.equal(storage.data.has(BUILT_IN_SHOWS_STORAGE_KEY), false);
});

test("a full list gets the built-in show later, when there is room", () => {
  const full = Array.from({ length: MAX_SONG_SHOWS }, () => createSongShow());
  const none = addBuiltInShows(full, []);
  assert.equal(none.shows.length, MAX_SONG_SHOWS);
  assert.deepEqual(none.added, []);
  assert.deepEqual(none.given, []);

  const later = addBuiltInShows(full.slice(1), none.given);
  assert.equal(later.shows.at(-1)?.id, blindingLights.id);
  assert.deepEqual(later.given, [blindingLights.id]);
});

test("the main profile is the one most cues use", () => {
  const show = createSongShow();
  assert.equal(mainSongProfile({ ...show, cues: [] }), undefined);
  show.cues[0].lighting.profile = "The Weeknd";
  show.cues[1].lighting.profile = "The Weeknd";
  show.cues[2].lighting.profile = "Taylor Swift";
  assert.equal(mainSongProfile(show), "The Weeknd");
});
