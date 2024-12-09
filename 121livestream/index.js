import express from "express";
const app = express();

import https from "httpolyglot";
import fs from "fs";
import path from "path";
import mediasoup from "mediasoup";
const __dirname = path.resolve();

import { Server } from "socket.io";

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use("/sfu", express.static(path.join(__dirname, "public")));

const options = {
  key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
  passphrase: "mediasoup",
};

const httpsServer = https.createServer(options, app);
httpsServer.listen(3000, () => {
  console.log("listening on port 3000");
});

const io = new Server(httpsServer);

const peers = io.of("/mediasoup");

let worker = null;
let router = null;
let producerTransport = null;
let consumerTransport = null;
let producer = null;
let consumer = null;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid: ${worker.pid}`);

  worker.on("died", (error) => {
    console.error("mediasoup worker has died!", error);
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  return worker;
};

worker = await createWorker();

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const createWebrtcTransport = async (callback) => {
  try {
    const webrtcTransportOptions = {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "127.0.0.1",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    let transport = await router.createWebRtcTransport(webrtcTransportOptions);
    console.log(`transport id: ${transport.id}`);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });
    transport.on("close", () => {
      console.log("transport closed");
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (error) {
    console.log(error);
    callback({
      params: { error: error },
    });
  }
};

peers.on("connection", async (socket) => {
  console.log(`user connected: ${socket.id}`);
  socket.emit("connection-success", { socketId: socket.id });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });

  router = await worker.createRouter({ mediaCodecs });

  socket.on("getRtpCapabilities", (callback) => {
    const rtpCapabilities = router.rtpCapabilities;

    console.log("rtp capabilities", rtpCapabilities);

    callback(rtpCapabilities);
  });

  socket.on("createWebRtcTransport", async ({ sender }, callback) => {
    console.log(`Is this a sender request? ${sender}`);
    if (sender) {
      producerTransport = await createWebrtcTransport(callback);
    } else {
      consumerTransport = await createWebrtcTransport(callback);
    }
  });

  socket.on("transport-connect", async ({ dtlsParameters }) => {
    console.log("dlts parameters: ", dtlsParameters);

    await producerTransport.connect({ dtlsParameters });
  });

  socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
    console.log("dlts parameters: ", dtlsParameters);
    await consumerTransport.connect({ dtlsParameters });
  });
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      producer = await producerTransport.produce({ kind, rtpParameters });

      producer.on("transportclose", () => {
        console.log("producer transport closed");
        producer.close();
      });

      callback({ id: producer.id });
    }
  );

  socket.on("consume", async ({ rtpCapabilities }, callback) => {
    try {
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on("transportclose", () => {
          console.log("transport close from consumer");
        });

        consumer.on("producerclose", () => {
          console.log("producer of consumer closed");
        });

        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        callback({ params });
      }
    } catch (error) {
      console.log(error.message);
      callback({
        params: {
          error: error,
        },
      });
    }
  });

  socket.on("consumer-resume", async () => {
    console.log("consumer resume");
    await consumer.resume();
  });
});
