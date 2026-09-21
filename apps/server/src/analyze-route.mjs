import {
  ActionRequiredError,
  analyzeFromTracks,
  analyzePublicPlaylist,
  classifyTrackGenres,
  fetchAlbumTracksForAnalysis,
  fetchArtistTopTracksForAnalysis,
  fetchLikedForAnalysis,
  fetchPlaylistForAnalysis,
  fetchRecentForAnalysis,
  fetchTrackArtists,
  parsePlaylistId,
} from "@discover-your-noise/core";

function spotifyProgress(onProgress, message) {
  onProgress?.({ phase: "spotify", pct: 8, message });
}

function everyNoiseOptions(onProgress) {
  if (!onProgress) return {};
  return {
    onProgress: (progress) => {
      onProgress({
        ...progress,
        pct: Math.min(99, 10 + Math.round((progress.pct ?? 0) * 0.89)),
      });
    },
  };
}

export async function analyzePlaylistId(playlistId, accessToken, onProgress) {
  spotifyProgress(onProgress, "Loading playlist from Spotify…");
  const { playlist, tracks } = await fetchPlaylistForAnalysis(playlistId, accessToken);
  if (tracks.length === 0) {
    throw new Error("Spotify returned no tracks for this playlist.");
  }
  const report = await analyzeFromTracks(
    { ...playlist, expectedTrackCount: playlist.expectedTrackCount || tracks.length },
    tracks,
    fetch,
    everyNoiseOptions(onProgress),
  );
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", report };
}

export async function analyzePlaylistUrl(url, accessToken, onProgress) {
  try {
    spotifyProgress(onProgress, "Reading public playlist…");
    const report = await analyzePublicPlaylist(url, fetch, everyNoiseOptions(onProgress));
    onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
    return { status: "ok", report };
  } catch (error) {
    if (!(error instanceof ActionRequiredError)) throw error;
    if (!accessToken) {
      return {
        status: "auth_required",
        message: error.message,
        details: error.details ?? {},
      };
    }
    const playlistId = parsePlaylistId(url);
    return analyzePlaylistId(playlistId, accessToken, onProgress);
  }
}

export async function analyzeLiked(accessToken, limit = 50, onProgress) {
  spotifyProgress(onProgress, "Loading liked songs from Spotify…");
  const fetchLimit = limit === "all" ? 5000 : limit;
  const { playlist, tracks } = await fetchLikedForAnalysis(accessToken, fetchLimit);
  const report = await analyzeFromTracks(playlist, tracks, fetch, everyNoiseOptions(onProgress));
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", report };
}

export async function analyzeRecent(accessToken, limit = 50, onProgress) {
  spotifyProgress(onProgress, "Loading recently played from Spotify…");
  const { playlist, tracks } = await fetchRecentForAnalysis(accessToken, limit);
  if (tracks.length === 0) {
    throw new Error("No recently played tracks found.");
  }
  const report = await analyzeFromTracks(playlist, tracks, fetch, everyNoiseOptions(onProgress));
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", report };
}

export async function analyzeAlbum(albumId, accessToken, onProgress) {
  spotifyProgress(onProgress, "Loading album tracks from Spotify…");
  const { playlist, tracks } = await fetchAlbumTracksForAnalysis(albumId, accessToken);
  if (tracks.length === 0) {
    throw new Error("Spotify returned no tracks for this album.");
  }
  const report = await analyzeFromTracks(playlist, tracks, fetch, everyNoiseOptions(onProgress));
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", report };
}

export async function analyzeArtist(artistId, accessToken, onProgress) {
  spotifyProgress(onProgress, "Loading artist top tracks from Spotify…");
  const { playlist, tracks } = await fetchArtistTopTracksForAnalysis(artistId, accessToken);
  if (tracks.length === 0) {
    throw new Error("Spotify returned no top tracks for this artist.");
  }
  const report = await analyzeFromTracks(playlist, tracks, fetch, everyNoiseOptions(onProgress));
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", report };
}

export async function analyzeTrack(trackId, accessToken, onProgress) {
  spotifyProgress(onProgress, "Loading track from Spotify…");
  const artists = await fetchTrackArtists(trackId, accessToken);
  if (artists.length === 0) {
    throw new Error("No artists found for this track.");
  }
  const genres = await classifyTrackGenres(artists, fetch, everyNoiseOptions(onProgress));
  onProgress?.({ phase: "done", pct: 100, message: "Analysis complete." });
  return { status: "ok", genres };
}
