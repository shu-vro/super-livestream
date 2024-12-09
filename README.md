## Overview

This project is a WebRTC-based video streaming application using mediasoup for media handling and socket.io
for signaling. It allows users to join a room as either a producer (streaming video) or a consumer (watching video).

## Prerequisites

- Node.js
- OpenSSL

## Setup

### Make the environment

> make sure to correctly type volumes in the docker-compose file. then do this.

```bash
# make the image first
docker build -t ubuntu-ms .
# Make the container
docker compose up --build
# make a shell in the container
docker exec -it ubuntu-ms /bin/bash
```

### Generate SSL Certificates

Generate SSL certificates using OpenSSL:

```bash
openssl req -x509 -newkey rsa:2048 -keyout keytemp.pem -out cert.pem -days 365
```

### Install Dependencies

Navigate to the `myowntest` directory and install the required dependencies:

```bash
cd myowntest
npm install
```

## Running the Application

Start the server:

```bash
npm run dev
```

The server will start on

https://localhost:3000

on another terminal, start the client:

```bash
npm run watch
```

## Project Structure

- app.js: Server-side code to handle WebRTC signaling and media transport using mediasoup.

- index.html: The HTML file that includes the video element and loads the client-side JavaScript.

- index.js: Client-side JavaScript to handle WebRTC connections and media streaming.

- bundle.js: Bundled client-side JavaScript.

- ssl: Directory containing SSL certificates.

## How It Works

### Server-Side

- The server is implemented in app.js.

- It uses `express` to serve static files and `httpolyglot` to create an HTTPS server.

- `mediasoup` is used to handle WebRTC media transport.

- `socket.io` is used for signaling between the client and server.

### Client-Side

- The client-side code is in
  index.js
  .

- It uses
  mediasoup-client
  to handle WebRTC connections.

- The client can join a room as either a producer (streaming video) or a consumer (watching video).
- The video stream is displayed in a `<video>` element in
  index.html
  .
