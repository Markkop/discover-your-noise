# 🎧 Discover Your Noise

This is a simple Node.js script that counts the genres of songs in a Spotify playlist. The script uses the Spotify Web API to get the playlist's artists, and then it uses Puppeteer to scrape the genres of each artist from everynoise.com.

## Prerequisites

Before you begin, ensure you have met the following requirements:

- You have installed Node.js and npm.
- You have a Spotify account.

## Installation

To install Genre-Scrapper, follow these steps:

```bash
git clone git@github.com:Markkop/discover-your-noise.git
cd genre-scrapper
npm install # or yarn install
```

## Obtaining Spotify API Keys

In order to use this script, you will need a Spotify Client ID, Client Secret, and an access token. Here's how you get them:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/login).
2. Log in to your Spotify account.
3. Click on 'Create an App', fill out the form, and click 'Create'.
4. Now you are in your application's dashboard, you can see your Client ID and Client Secret. Copy them somewhere safe.
5. To get an access token, make this POST request: https://developer.spotify.com/documentation/web-api/tutorials/getting-started#request-an-access-token

**Note:** Access tokens expire after a certain period of time, so you may need to refresh it if your script stops working.

## Obtaining Spotify Playlist ID

1. Open the Spotify app (desktop or web version) and navigate to the desired playlist.
2. Click on the three-dot menu next to the "PLAY" button.
3. Select "Share" from the drop-down menu, then click on "Copy Playlist Link". This will copy a URL to your clipboard.
4. The URL you copied should look something like this: `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=12345abc6789`. The Playlist ID is the alphanumeric string after `/playlist/` and before the `?`. In this case, `37i9dQZF1DXcBWIGoYBM5M` is the Playlist ID.

## Setting Up Environment Variables

Copy `.env.example`, rename it to `.env` and insert your keys and tokens like this:

```
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=your-app-redirect-uri
SPOTIFY_ACCESS_TOKEN=your-spotify-access-token
SPOTIFY_PLAYLIST_ID=your-spotify-playlist-id
```

## Running the Script

To run Genre-Scrapper, use this command:

```bash
npm start # or yarn start
```

This will start the script, and it will print the count of genres in the specified Spotify playlist to the console.

Eg. for playlist:
https://open.spotify.com/playlist/2i2vaDkkinuropvyOSCm2B

```js
[
  [ 'indietronica', 7 ],
  [ 'brazilian indie', 7 ],
  [ 'nova mpb', 6 ],
  [ 'rock', 6 ],
  [ 'indie rock', 5 ],
  [ 'art pop', 4 ],
  [ 'latin alternative', 4 ],
  [ 'modern rock', 4 ],
  [ 'nova musica carioca', 3 ],
  [ 'neo-psychedelic', 3 ],
  [ 'neo-psicodelia brasileira', 3 ],
  [ 'downtempo', 3 ],
  [ 'classic rock', 3 ],
  [ 'permanent wave', 3 ],
  [ 'chamber pop', 3 ],
  [ 'metropopolis', 2 ],
  [ 'indie soul', 2 ],
  [ 'tropicalia', 2 ],
  [ 'mpb', 2 ],
  [ 'psicodelia brasileira', 2 ],
  [ 'bossa nova', 2 ],
  [ 'samba', 2 ],
  [ 'synthwave', 2 ],
  [ 'world', 2 ],
  [ 'french psychedelic', 2 ],
  [ 'acid rock', 2 ],
  [ 'psychedelic rock', 2 ],
  [ 'hard rock', 2 ],
  [ 'album rock', 2 ],
  [ 'pop lgbtq+ brasileira', 2 ],
  [ 'pov: indie', 2 ],
  [ 'pop', 2 ],
  [ 'latin afrobeat', 2 ],
  [ 'garage rock', 2 ],
  [ 'chicha', 2 ],
  [ 'argentine indie', 2 ],
  [ 'manguebeat', 2 ],
  [ 'dream pop', 2 ],
  [ 'deep downtempo fusion', 1 ],
  [ 'downtempo fusion', 1 ],
  [ 'pop nacional', 1 ],
  [ 'psychedelic pop', 1 ],
  [ 'portland hip hop', 1 ],
  [ 'kiwi rock', 1 ],
  [ 'nu jazz', 1 ],
  [ 'balkan beats', 1 ],
  [ 'electro swing', 1 ],
  [ 'samba-rock', 1 ],
  [ 'french indie pop', 1 ],
  [ 'french indietronica', 1 ],
  [ 'french rock', 1 ],
  [ 'uk alternative pop', 1 ],
  [ 'proto-metal', 1 ],
  [ 'folk rock', 1 ],
  [ 'blues rock', 1 ],
  [ 'singer-songwriter', 1 ],
  [ 'mellow gold', 1 ],
  [ 'tecnobrega', 1 ],
  [ 'musica popular paraense', 1 ],
  [ 'vaporwave', 1 ],
  [ 'future funk', 1 ],
  [ 'chillsynth', 1 ],
  [ 'hardvapour', 1 ],
  [ 'hypnagogic pop', 1 ],
  [ 'mallsoft', 1 ],
  [ 'slushwave', 1 ],
  [ 'trap beats', 1 ],
  [ 'canadian electropop', 1 ],
  [ 'neo-synthpop', 1 ],
  [ 'grave wave', 1 ],
  [ 'rock paraibano', 1 ],
  [ 'musica campista', 1 ],
  [ 'musica paraibana', 1 ],
  [ 'psychedelic soul', 1 ],
  [ 'funk rock', 1 ],
  [ 'funk', 1 ],
  [ 'p funk', 1 ],
  [ 'soul', 1 ],
  [ 'art rock', 1 ],
  [ 'glam rock', 1 ],
  [ 'electronica', 1 ],
  [ 'bedroom pop', 1 ],
  [ 'indie pop', 1 ],
  [ 'shimmer psych', 1 ],
  [ 'chillwave', 1 ],
  [ 'vapor twitch', 1 ],
  [ 'wonky', 1 ],
  [ 'brooklyn indie', 1 ],
  [ 'umbanda', 1 ],
  [ 'brazilian rock', 1 ],
  [ 'brazilian reggae', 1 ],
  [ 'afrobeat brasileiro', 1 ],
  [ 'brass band brasileiro', 1 ],
  [ 'afrofuturismo brasileiro', 1 ],
  [ 'instrumental funk', 1 ],
  [ 'brazilian indie rock', 1 ],
  [ 'sheffield indie', 1 ],
  [ 'baroque pop', 1 ],
  [ 'quebec indie', 1 ],
  [ 'canadian indie', 1 ],
  ... 49 more items
]
```
