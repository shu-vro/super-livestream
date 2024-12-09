const io = require("socket.io-client");
const mediasoup = require("mediasoup-client");
const roomId = new URLSearchParams(window.location.search).get("room");
console.log(roomId);

/**
 * @type {import("socket.io-client").Socket}
 */
const socket = io("/mediasoup");
let isProducer = false;
/**
 * @type {mediasoup.types.Transport<mediasoup.types.AppData}
 */
let producerTransport;
/**
 * @type {mediasoup.types.Transport<mediasoup.types.AppData}
 */
let consumerTransport;
/**
 * @type {mediasoup.types.RtpCapabilities}
 */
let routerRtpCapabilities;
/**
 * @type {mediasoup.types.Producer<mediasoup.types.AppData}
 */
let producer;

const createDevice = async function () {
  try {
    const device = new mediasoup.Device();
    await device.load({
      routerRtpCapabilities,
    });

    return device;
  } catch (error) {
    console.log(error);
    if (error.name === "UnsupportedError") {
      console.error("browser not supported");
    }
  }
};

const getLocalStream = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  document.getElementById("myVideo").srcObject = stream;

  return stream;
};

socket.on("connect", () => {
  socket.emit("join-room", roomId, async (roomId2) => {
    console.log("user joined", roomId2);
    await new Promise((resolve) => {
      socket.emit("get:rtp-capabilities", (caps) => {
        console.log("rtp capabilities", caps);
        routerRtpCapabilities = caps;
        resolve();
      });
    });
    const device = await createDevice();
    if (!device) return console.log("device not created");

    console.log("device created");

    isProducer = confirm("Are you a producer?");

    if (isProducer) {
      socket.emit(
        "create:webrtc-transport",
        {
          isProducer,
        },
        async ({ params }) => {
          console.log("params", params);
          if (params?.error) {
            console.log(params.error);
            return;
          }

          producerTransport = device.createSendTransport(params);

          producerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback) => {
              socket.emit(
                "connect:webrtc-transport",
                {
                  transportId: producerTransport.id,
                  dtlsParameters,
                },
                callback
              );
            }
          );
          producerTransport.on("produce", async (parameters, callback) => {
            console.log("produce", parameters);
            socket.emit("produce", parameters, ({ id }) => {
              console.log("id", id);
              callback({ id });
            });
          });

          const stream = await getLocalStream();
          producer = await producerTransport.produce({
            track: stream.getTracks()[0],
          });

          producer.on("trackended", () => {
            console.log("track ended");

            // close video track
          });

          producer.on("transportclose", () => {
            console.log("transport ended");

            // close video track
          });
        }
      );
    } else {
      // consumer
      socket.emit(
        "create:webrtc-transport",
        {
          isProducer,
        },
        async ({ params }) => {
          consumerTransport = device.createRecvTransport(params);
          console.log(consumerTransport);

          consumerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback) => {
              console.log("trying to connect", dtlsParameters);
              socket.emit(
                "connect:webrtc-transport",
                {
                  transportId: consumerTransport.id,
                  dtlsParameters,
                },
                callback
              );
            }
          );
          socket.emit(
            "consume",
            {
              rtpCapabilities: device.rtpCapabilities,
              consumerId: consumerTransport.id,
            },
            async (params) => {
              console.log("consume", params);
              const consumer = await consumerTransport.consume(params);

              console.log("consumer", consumer);
              // await consumer.resume();
              const { track } = consumer;

              document.getElementById("myVideo").srcObject = new MediaStream([
                track,
              ]);

              socket.emit("consumer-resume", { consumerId: consumer.id });
            }
          );
        }
      );
    }
  });
});
