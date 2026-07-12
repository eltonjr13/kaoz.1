const fs = require('fs');
const dotenv = require('dotenv');
const SpotifyWebApi = require('spotify-web-api-node');

dotenv.config({ path: 'D:\\apps\\spotify-mcp\\.env' });

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
});

async function run() {
  const data = await spotifyApi.refreshAccessToken();
  const accessToken = data.body['access_token'];
  spotifyApi.setAccessToken(accessToken);
  
  // Get latest playlist
  const playlists = await spotifyApi.getUserPlaylists({ limit: 1 });
  const latestPlaylist = playlists.body.items[0];
  console.log('Latest playlist:', latestPlaylist.name, latestPlaylist.id);

  // Read a sample image base64 (we can just create a small red square base64 for testing)
  // 1x1 red pixel jpeg
  const sampleBase64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  
  console.log("Uploading 1x1 red pixel image...");
  const response = await fetch(`https://api.spotify.com/v1/playlists/${latestPlaylist.id}/images`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "image/jpeg",
    },
    body: sampleBase64,
  });

  if (!response.ok) {
    console.error("Failed!", response.status, await response.text());
  } else {
    console.log("Success! HTTP", response.status);
    console.log("Response body:", await response.text());
  }
}

run().catch(console.error);
