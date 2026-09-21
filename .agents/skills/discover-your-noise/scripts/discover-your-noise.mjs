#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ActionRequiredError,
  analyzeArtists,
  analyzePublicPlaylist,
  formatReport,
  parseBrowserPayload,
} from "../../../../packages/core/index.mjs";

export {
  ActionRequiredError,
  analyzeArtists,
  analyzePublicPlaylist,
  buildReportData,
  classifyArtists,
  decodeHtml,
  extractSpotifyPage,
  formatReport,
  inferGenres,
  parseBrowserPayload,
  parsePlaylistId,
} from "../../../../packages/core/index.mjs";

async function readStdin() {
  const inputChunks = [];
  for await (const chunk of process.stdin) inputChunks.push(chunk);
  return Buffer.concat(inputChunks).toString("utf8");
}

async function analyzeBrowserFile(path, fetchImpl = fetch) {
  if (!path) throw new Error("Provide the browser JSON path or '-' for stdin.");
  const source = path === "-" ? await readStdin() : await readFile(path, "utf8");
  const payload = JSON.parse(source);
  const data = parseBrowserPayload(payload);
  return analyzeArtists(data.playlist, data.artists, fetchImpl);
}

function usage() {
  return [
    "Usage:",
    "  discover-your-noise <spotify-playlist-url-or-id>",
    "  discover-your-noise from-browser <json-path|->",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }
  let report;
  if (args[0] === "from-browser") {
    report = await analyzeBrowserFile(args[1]);
  } else {
    report = await analyzePublicPlaylist(args[0]);
  }
  console.log(formatReport(report));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    if (error instanceof ActionRequiredError) {
      console.error(`Action needed: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
