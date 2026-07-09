const fs = require('fs');
const dotenv = require('dotenv');
const SpotifyWebApi = require('spotify-web-api-node');
const sharp = require('sharp');

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
  
  // Create a 500x500 red image using sharp
  const imageBuffer = await sharp({
    create: {
      width: 500,
      height: 500,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 }
    }
  })
  .jpeg({ quality: 80 })
  .toBuffer();
  
  const sampleBase64 = imageBuffer.toString('base64');
  
  const newPl = await spotifyApi.createPlaylist("Test image upload 2", { public: true });
  console.log("Created playlist:", newPl.body.id);

  console.log("Uploading 500x500 red jpeg...");
  const response = await fetch(`https://api.spotify.com/v1/playlists/${newPl.body.id}/images`, {
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
