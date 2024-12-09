const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const socket = io("/mediasoup");

socket.on("connection-success", (data, existsProducer) => {
    console.log(data, existsProducer);
});

let device,
    routerRtpCapabilities,
    producerTransport,
    producer,
    consumerTransport,
    consumer,
    isProducer = false;

const btnLocalVideo = document.getElementById("btnLocalVideo");
const localVideo = document.getElementById("localVideo");
const btnRecvSendTransport = document.getElementById("btnRecvSendTransport");
const remoteVideo = document.getElementById("remoteVideo");

let params = {
    // mediasoup params
    encoding: [
        {
            rid: "r0",
            maxBitrate: 100000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r1",
            maxBitrate: 300000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r2",
            maxBitrate: 900000,
            scalabilityMode: "S1T3",
        },
    ],
    codecOptions: {
        videoGoogleStartBitrate: 1000,
    },
};

const streamSuccess = async (stream) => {
    localVideo.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    params = {
        track,
        ...params,
    };

    goConnect(true);
};

const getLocalStream = async () => {
    try {
        let stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: {
                    min: 640,
                    max: 1920,
                },
                height: {
                    min: 400,
                    max: 1080,
                },
            },
            audio: false,
        });
        streamSuccess(stream);
    } catch (error) {
        console.error(error.message);
    }
};

const goConnect = (producerOrConsumer) => {
    isProducer = producerOrConsumer;
    !device ? getRtpCapabilities() : goCreateTransport();
};

const goConsume = () => {
    goConnect(false);
};

const goCreateTransport = () => {
    isProducer ? createSendTransport() : createRecvSendTransport();
};

const createDevice = async () => {
    try {
        device = new mediasoupClient.Device();
        await device.load({
            routerRtpCapabilities: routerRtpCapabilities,
        });
        console.log("Device Rtp capabilities", routerRtpCapabilities);

        goCreateTransport();
    } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError") {
            console.error("browser not supported");
        }
    }
};

const getRtpCapabilities = () => {
    socket.emit("createRoom", (rtpData) => {
        console.log(`rtpCapabilities: `, rtpData);
        routerRtpCapabilities = rtpData;

        createDevice();
    });
};

const createSendTransport = () => {
    socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
        if (params.error) {
            console.error(params.error);
            return;
        }
        console.log(params);

        producerTransport = device.createSendTransport(params);

        producerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    // signal local dtls parameters to server transport
                    socket.emit("transport-connect", {
                        // transportId: producerTransport.id,
                        dtlsParameters,
                    });

                    // tell the transport that parameers were transmitted
                    callback();
                } catch (error) {
                    errback(error);
                }
            }
        );

        producerTransport.on(
            "produce",
            async (parameters, callback, errback) => {
                console.log(parameters);
                try {
                    await socket.emit(
                        "transport-produce",
                        {
                            transportId: producerTransport.id,
                            kind: parameters.kind,
                            rtpParameters: parameters.rtpParameters,
                            appData: parameters.appData,
                        },
                        ({ id }) => {
                            callback({ id });
                        }
                    );
                } catch (error) {
                    errback(error);
                }
            }
        );
        connectSendTransport();
    });
};

const connectSendTransport = async () => {
    producer = await producerTransport.produce(params);

    producer.on("trackended", () => {
        console.log("track ended");
    });
    producer.on("transportclose", () => {
        console.log("transport ended");
    });
};

const createRecvSendTransport = async () => {
    await socket.emit(
        "createWebRtcTransport",
        { sender: false },
        ({ params }) => {
            if (params.error) {
                console.log(params.error);
                return;
            }
            console.log(params);

            // create recv transport
            consumerTransport = device.createRecvTransport(params);

            consumerTransport.on(
                "connect",
                async ({ dtlsParameters }, callback, errback) => {
                    try {
                        await socket.emit("transport-recv-connect", {
                            // transportId: consumerTransport.id,
                            dtlsParameters,
                        });

                        callback();
                    } catch (error) {
                        errback(error);
                    }
                }
            );
            connectRecvTransport();
        }
    );
};

const connectRecvTransport = async () => {
    await socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
        },
        async ({ params }) => {
            if (params.error) {
                console.log("cannot consume");
                return;
            }

            console.log(params);

            consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            const { track } = consumer;
            remoteVideo.srcObject = new MediaStream([track]);
            socket.emit("consumer-resume");
        }
    );
};

btnLocalVideo.addEventListener("click", getLocalStream);
btnRecvSendTransport.addEventListener("click", goConsume);
