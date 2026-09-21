import {
  ActionRequiredError,
  analyzeFromTracks,
  analyzePublicPlaylist,
  fetchLikedForAnalysis,
  fetchPlaylistForAnalysis,
  parsePlaylistId,
} from "@discover-your-noise/core";

export async function analyzePlaylistUrl(url, accessToken) {
  try {
    return { status: "ok", report: await analyzePublicPlaylist(url) };
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
    const { playlist, tracks } = await fetchPlaylistForAnalysis(playlistId, accessToken);
    if (tracks.length === 0) {
      throw new Error("Spotify returned no tracks for this playlist.");
    }
    const report = await analyzeFromTracks(
      { ...playlist, expectedTrackCount: playlist.expectedTrackCount || tracks.length },
      tracks,
    );
    return { status: "ok", report };
  }
}

export async function analyzeLiked(accessToken, limit = 100) {
  const { playlist, tracks } = await fetchLikedForAnalysis(accessToken, limit);
  const report = await analyzeFromTracks(playlist, tracks);
  return { status: "ok", report };
}
