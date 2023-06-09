const puppeteer = require("puppeteer");
const axios = require("axios");
const SpotifyWebApi = require("spotify-web-api-node");
const dotenv = require("dotenv");
dotenv.config();

async function getAccessToken() {
  try {
    const response = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      params: {
        grant_type: "client_credentials",
      },
      auth: {
        username: process.env.SPOTIFY_CLIENT_ID,
        password: process.env.SPOTIFY_CLIENT_SECRET,
      },
    });

    return response.data.access_token;
  } catch (error) {
    console.error("Error getting access token:", error);
    throw error;
  }
}

async function countGenres(playlistId) {
  try {
    const accessToken = await getAccessToken();
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
      accessToken,
    });

    const getGenres = async (browser, artist) => {
      const page = await browser.newPage();
      const url = `https://everynoise.com/lookup.cgi?who=${encodeURIComponent(
        artist
      )}`;
      await page.goto(url);
      const genres = await page.evaluate(() => {
        const anchorTags = document.querySelectorAll("div>a:not([title])");
        return Array.from(anchorTags).map((a) => a.textContent);
      });
      await page.close();
      return genres;
    };

    const getPlaylistArtists = async (playlistId) => {
      const { body } = await spotifyApi.getPlaylist(playlistId);
      return [
        ...new Set(
          body.tracks.items.map((track) => track.track.artists[0].name)
        ),
      ];
    };
    const artists = await getPlaylistArtists(playlistId);

    if (!artists || artists.length === 0) {
      console.log("No artists found in the playlist.");
      return;
    }

    const browser = await puppeteer.launch();

    let genresCount = {};

    for (const artist of artists) {
      const genres = await getGenres(browser, artist);
      console.log(`Genres for ${artist}: ${genres}`);

      for (const genre of genres) {
        genresCount[genre] = (genresCount[genre] || 0) + 1;
      }
    }

    await browser.close();

    const sortedGenresCount = Object.entries(genresCount).sort(
      (a, b) => b[1] - a[1]
    );

    console.log(sortedGenresCount);
    return sortedGenresCount;
  } catch (error) {
    console.error("Error counting genres:", error);
    throw error;
  }
}

function extractPlaylistId(input) {
  const spotifyUrlRegex =
    /https:\/\/open\.spotify\.com\/playlist\/([\w\d]+)(\?si=.+)?/;
  const matches = input.match(spotifyUrlRegex);
  return matches ? matches[1] : null;
}

function getPlaylistIdFromArgs(args) {
  if (args.length === 0) {
    return null;
  }

  const input = args[0];
  if (input.startsWith("https://")) {
    return extractPlaylistId(input);
  }

  return input;
}

async function main() {
  const args = process.argv.slice(2);
  const playlistId =
    getPlaylistIdFromArgs(args) || process.env.SPOTIFY_PLAYLIST_ID;

  if (!playlistId) {
    console.error(
      "Please provide the playlist ID or URL as a command line argument or set SPOTIFY_PLAYLIST_ID environment variable."
    );
    process.exit(1);
  }

  const result = await countGenres(playlistId);
  console.log(result);
}

main();
