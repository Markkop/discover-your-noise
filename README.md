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
cd discover-your-noise
npm install # or yarn install
```

## Obtaining Spotify API Keys

In order to use this script, you will need a Spotify Client ID, Client Secret, and an access token. Here's how you get them:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/login).
2. Log in to your Spotify account.
3. Click on 'Create an App', fill out the form, and click 'Create'.
4. Now you are in your application's dashboard, you can see your Client ID and Client Secret

## Obtaining Spotify Playlist ID

1. Open the Spotify app (desktop or web version) and navigate to the desired playlist.
2. Click on the three-dot menu next to the "PLAY" button.
3. Select "Share" from the drop-down menu, then click on "Copy Playlist Link". This will copy a URL to your clipboard.
4. The URL you copied should look something like this: `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=12345abc6789`. The Playlist ID is the alphanumeric string after `/playlist/` and before the `?`. In this case, `37i9dQZF1DXcBWIGoYBM5M` is the Playlist ID.

## Setting Up Environment Variables

Copy `.env.example`, rename it to `.env` and insert your keys and tokens like this:

```bash
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=your-app-redirect-uri
SPOTIFY_ACCESS_TOKEN=your-spotify-access-token
SPOTIFY_PLAYLIST_ID=your-spotify-playlist-id # optional, you can provide it as an argument
```

## Running the Script

To run Genre-Scrapper, use this command:

```bash
npm start
# or yarn start

# If you want to provide the playlist id as an argument
npm start -- 76yxaCsawHQZuuVQgSGlvG
# or yarn start 76yxaCsawHQZuuVQgSGlvG
```

This will start the script, and it will print the count of genres in the specified Spotify playlist to the console.

## Example

From this playlist:
https://open.spotify.com/playlist/76yxaCsawHQZuuVQgSGlvG

Output:

```js
[
  ["downtempo", 3],
  ["glitch hop", 2],
  ["hip-hop experimental", 2],
  ["downtempo fusion", 2],
  ["glitch", 2],
  ["electronica", 2],
  ["psychill", 2],
  ["ambient psychill", 2],
  ["glitch beats", 1],
  ["livetronica", 1],
  ["compositional ambient", 1],
  ["neo-classical", 1],
  ["chillhop", 1],
  ["bass trip", 1],
  ["abstract beats", 1],
  ["jazz boom bap", 1],
  ["nu skool breaks", 1],
  ["classic progressive house", 1],
  ["breakbeat", 1],
  ["jazz rap", 1],
  ["ambeat", 1],
  ["abstract hip hop", 1],
  ["german indie pop", 1],
  ["cologne indie", 1],
  ["neo-kraut", 1],
  ["abstract", 1],
  ["intelligent dance music", 1],
  ["instrumental hip hop", 1],
  ["trap beats", 1],
  ["chillsynth", 1],
  ["ambient", 1],
  ["synthwave", 1],
  ["montreal indie", 1],
  ["relaxative", 1],
  ["focus", 1],
  ["atmosphere", 1],
  ["indietronica", 1],
  ["asheville indie", 1],
  ["uk alternative pop", 1],
  ["collage pop", 1],
  ["future ambient", 1],
  ["ambient fusion", 1],
  ["ambient trance", 1],
  ["chill lounge", 1],
  ["german electronica", 1],
  ["new french touch", 1],
];
```
