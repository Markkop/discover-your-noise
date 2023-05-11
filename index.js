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
  const url =
    "https://everynoise.com/lookup.cgi?who=" + encodeURIComponent(artist);
  await page.goto(url);
  const genres = await page.evaluate(() => {
    const anchorTags = document.querySelectorAll("div>a:not([title])");
    return Array.from(anchorTags).map((a) => a.textContent);
  });
  await page.close();
  return genres;
};

const getPlaylistArtists = async (playlistId) => {
  const data = await spotifyApi.getPlaylist(playlistId);
  const tracks = data.body.tracks.items;
  const artists = tracks.map((track) => track.track.artists[0].name);
  return [...new Set(artists)];
};

const countGenres = async (playlistId) => {
  const artists = await getPlaylistArtists(playlistId);
  const browser = await puppeteer.launch();

  let genresCount = {};
  for (const artist of artists) {
    const genres = await getGenres(browser, artist);
    console.log(`Genres for ${artist}: ${genres}`);

    for (const genre of genres) {
      if (genre in genresCount) {
        genresCount[genre]++;
      } else {
        genresCount[genre] = 1;
      }
    }
  }
  await browser.close();

  const sortedGenresCount = Object.entries(genresCount).sort(
    (a, b) => b[1] - a[1]
  );

  console.log(sortedGenresCount);
  return sortedGenresCount;
};

countGenres(process.env.SPOTIFY_PLAYLIST_ID)
  .then(console.log)
  .catch(console.error);
