const puppeteer = require("puppeteer");
const SpotifyWebApi = require("spotify-web-api-node");
const dotenv = require("dotenv");
dotenv.config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  accessToken: process.env.SPOTIFY_ACCESS_TOKEN,
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
    ...new Set(body.tracks.items.map((track) => track.track.artists[0].name)),
  ];
};

const countGenres = async (playlistId) => {
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
};

const playlistId = process.env.SPOTIFY_PLAYLIST_ID;

if (!playlistId) {
  console.error("SPOTIFY_PLAYLIST_ID environment variable is not set.");
  process.exit(1);
}

countGenres(playlistId).then(console.log).catch(console.error);
