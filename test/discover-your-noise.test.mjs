import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionRequiredError,
  buildReportData,
  decodeHtml,
  extractSpotifyPage,
  formatReport,
  inferGenres,
  parseBrowserPayload,
  parsePlaylistId,
} from "../packages/core/index.mjs";

const PLAYLIST_ID = "76yxaCsawHQZuuVQgSGlvG";
const ARTIST_A = "1CsZ0ihKPWBDUERlQt8ekr";
const ARTIST_B = "4l8S3gH7kFBB9XcI7EtUoT";
const TRACK_A = "3z1TYDSkZ425XidGE3go4L";
const TRACK_B = "4LmS9HhbDrnXCK0uGQXsTw";

test("parses Spotify playlist URLs, URIs, and IDs", () => {
  assert.equal(parsePlaylistId(PLAYLIST_ID), PLAYLIST_ID);
  assert.equal(parsePlaylistId(`spotify:playlist:${PLAYLIST_ID}`), PLAYLIST_ID);
  assert.equal(
    parsePlaylistId(`https://open.spotify.com/intl-pt/playlist/${PLAYLIST_ID}?si=x`),
    PLAYLIST_ID,
  );
  assert.throws(() => parsePlaylistId("https://example.com/playlist/nope"));
});

test("decodes artist names from Spotify HTML", () => {
  assert.equal(decodeHtml("A &amp; B &#x2014; C"), "A & B — C");
});

test("extracts a complete public playlist", () => {
  const html = `
    <meta property="og:title" content="Small &amp; Good">
    <meta name="description" content="Playlist · Spotify · 2 items · 10 saves">
    <a href="/track/${TRACK_A}">Track A</a>
    <a href="/artist/${ARTIST_A}">Artist &amp; One</a>
    <a href="/track/${TRACK_B}">Track B</a>
    <a href="/artist/${ARTIST_B}">Artist Two</a>
  `;
  const page = extractSpotifyPage(html, `https://open.spotify.com/playlist/${PLAYLIST_ID}`);
  assert.equal(page.playlist.title, "Small & Good");
  assert.equal(page.playlist.expectedTrackCount, 2);
  assert.equal(page.trackIds.length, 2);
  assert.equal(page.artists.length, 2);
  assert.equal(page.artists[0].name, "Artist & One");
  assert.equal(page.isComplete, true);
});

test("detects Spotify's truncated public HTML", () => {
  const html = `
    <meta name="description" content="Playlist · Spotify · 50 items · 10 saves">
    <a href="/track/${TRACK_A}">Track A</a>
    <a href="/artist/${ARTIST_A}">Artist One</a>
  `;
  const page = extractSpotifyPage(html, `https://open.spotify.com/playlist/${PLAYLIST_ID}`);
  assert.equal(page.playlist.expectedTrackCount, 50);
  assert.equal(page.trackIds.length, 1);
  assert.equal(page.isComplete, false);
});

test("requires a complete browser handoff and deduplicates artists", () => {
  const payload = {
    playlist: {
      url: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
      title: "Browser playlist",
      expectedTrackCount: 2,
    },
    tracks: [
      { id: TRACK_A, artists: [{ id: ARTIST_A, name: "Artist One" }] },
      {
        id: TRACK_B,
        artists: [
          { id: ARTIST_A, name: "Artist One" },
          { id: ARTIST_B, name: "Artist Two" },
        ],
      },
    ],
  };
  const parsed = parseBrowserPayload(payload);
  assert.equal(parsed.artists.length, 2);

  payload.tracks.pop();
  assert.throws(
    () => parseBrowserPayload(payload),
    (error) => error instanceof ActionRequiredError,
  );
});

test("matches Every Noise's related-artist inference rule", () => {
  const genreMap = {
    a: ["ambient", "focus", "singleton-a"],
    b: ["ambient", "focus"],
    c: ["ambient", "other"],
  };
  assert.deepEqual(inferGenres(["a", "b", "c"], genreMap), [
    "ambient",
    "focus",
  ]);
  assert.deepEqual(inferGenres(["a"], genreMap), [
    "ambient",
    "focus",
    "singleton-a",
  ]);
});

test("counts artists and distinguishes direct from inferred genres", () => {
  const playlist = {
    title: "Test playlist",
    url: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
    expectedTrackCount: 2,
  };
  const report = buildReportData(playlist, [
    { id: ARTIST_A, name: "A", kind: "direct", genres: ["ambient", "ambient"] },
    { id: ARTIST_B, name: "B", kind: "inferred", genres: ["ambient", "focus"] },
  ]);
  assert.deepEqual(report.genres[0], {
    genre: "ambient",
    direct: 1,
    inferred: 1,
    total: 2,
  });
  const output = formatReport(report);
  assert.match(output, /Coverage: 1 direct/);
  assert.match(output, /Inferred from related artists/);
});
