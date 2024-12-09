import express from "express";
const app = express();

import https from "httpolyglot";
import fs from "fs";
import path from "path";
import mediasoup from "mediasoup";
const __dirname = path.resolve();

import { Server } from "socket.io";

app.use("/", express.static(path.join(__dirname, "public")));

const httpsServer = https.createServer(
  {
    key: fs.readFileSync("./ssl/key.pem", "utf-8"),
    cert: fs.readFileSync("./ssl/cert.pem", "utf-8"),
    passphrase: "mediasoup",
  },
  app
);

httpsServer.listen(3000, () => {
  console.log("listening on https://localhost:3000");
});

const io = new Server(httpsServer);
const peers = io.of("/mediasoup");

const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log("worker id: ", worker.pid);

  worker.on("died", () => {
    console.error("mediasoup worker died");
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });
  return worker;
};

/**
 * create worker
 * @param {mediasoup.types.Worker} worker
 * @returns
 */
const createRouter = async (worker) => {
  return await worker.createRouter({
    mediaCodecs: [
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
    ],
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });
};

const worker = await createWorker();
const router = await createRouter(worker);

const createWebrtcTransport = async (callback) => {
  const webRtcTransportOptions = {
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
  let transport = await router.createWebRtcTransport(webRtcTransportOptions);

  console.log("transport id: ", transport.id);

  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed") {
      transport.close();
    }
  });

  transport.on("close", () => {
    console.log("transport closed");
  });
  const { id, iceParameters, iceCandidates, dtlsParameters } = transport;
  callback({
    params: {
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
    },
  });
  return transport;
};

/**
 * @type {mediasoup.types.WebRtcTransport<mediasoup.types.AppData>}
 */
let producerTransport;
/**
 * @type {mediasoup.types.WebRtcTransport<mediasoup.types.AppData>[]}
 */
let consumerTransports = [];
/**
 * @type {mediasoup.types.Producer<mediasoup.types.AppData>}
 */
let producer = null;
/**
 * @type {mediasoup.types.Consumer<mediasoup.types.AppData>[]}
 */
let consumers = [];

peers.on("connection", (socket) => {
  console.log(socket.id, "connected");

  socket.on("disconnect", () => {
    console.log(socket.id, "disconnected");
  });

  socket.on("join-room", (roomId, callback) => {
    if (!roomId) return callback("room not found");

    socket.join(roomId);
    console.log(socket.id, "joined", roomId);
    callback(roomId);
  });

  socket.on("get:rtp-capabilities", (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    callback(rtpCapabilities);
  });

  socket.on(
    "create:webrtc-transport",
    async function ({ isProducer }, callback) {
      if (isProducer && producerTransport) {
        console.log("producer transport already exists");
        callback({
          error: "producer transport already exists",
        });
        return;
      }
      if (isProducer && !producerTransport) {
        producerTransport = await createWebrtcTransport(callback);
      } else {
        const consumerTransport = await createWebrtcTransport(callback);
        consumerTransports.push(consumerTransport);
        console.log(consumerTransports.map((e) => e.id));
      }
    }
  );

  socket.on(
    "connect:webrtc-transport",
    async ({ transportId, dtlsParameters }, callback) => {
      console.log("requested transport", transportId);
      const transport =
        producerTransport.id === transportId
          ? producerTransport
          : consumerTransports.find((t) => t.id === transportId);
      if (transport) {
        console.log("transport found!");
        await transport.connect({ dtlsParameters });
        callback();
      } else {
      }
    }
  );

  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    });

    producer.on("transportclose", () => {
      console.log("producer transport closed");
      producer.close();
      producer = null;
      producerTransport = null;
    });

    callback({ id: producer.id });
  });

  socket.on("consume", async ({ rtpCapabilities, consumerId }, callback) => {
    try {
      if (!producer) {
        callback({ error: "producer not found" });
        return;
      }
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        const selectedConsumerTransport = consumerTransports.find(
          (t) => t.id === consumerId
        );

        if (!selectedConsumerTransport) {
          callback({ error: "consumer transport not found" });
          return;
        }
        const consumer = await selectedConsumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on("transportclose", () => {
          console.log("transport close from consumer");
          // remove the consumer from the consumers and consumerTransports
          consumers = consumers.filter((c) => c.id !== consumer.id);
          selectedConsumerTransport.close();
          consumerTransports = consumerTransports.filter(
            (t) => t.id !== selectedConsumerTransport.id
          );
        });

        consumer.on("producerclose", () => {
          console.log("producer of consumer closed");
        });

        consumers.push(consumer);

        const { id, kind, rtpParameters } = consumer;

        callback({
          id,
          producerId: producer.id,
          kind,
          rtpParameters,
        });
      }
    } catch (error) {
      callback({
        error: error,
      });
    }
  });

  socket.on("consumer-resume", async ({ consumerId }) => {
    const consumer = consumers.find((c) => c.id === consumerId);
    console.log(consumer.id, consumerId);
    await consumer.resume();
  });
});
