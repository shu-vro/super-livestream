const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const socket = io("/mediasoup");

socket.on("connection-success", (data, existsProducer) => {
    console.log(data, existsProducer);

    getLocalStream();
});

let device,
    routerRtpCapabilities,
    producerTransport,
    producer,
    consumerTransports = [],
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

    joinRoom(true);
};

const joinRoom = (producerOrConsumer) => {
    socket.emit("joinRoom", { roomName }, (data) => {
        console.log("Router Rtp Capabilities", data.rtpCapabilities);
        rtpCapabilities = data.rtpCapabilities;
        createDevice();
    });
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

        createSendTransport();
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

socket.on("");

const getProducers = () => {
    socket.emit("getProducers", (producers) => {
        producers.forEach(signalNewConsumerTransport);
    });
};

const createSendTransport = () => {
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
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
                        ({ id, producerExists }) => {
                            callback({ id });

                            if (producerExists) {
                                getProducers();
                            }
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

const signalNewConsumerTransport = async (remoteProducerId) => {
    await socket.emit(
        "createWebRtcTransport",
        { consumer: true },
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
            connectRecvTransport(
                consumerTransport,
                remoteProducerId,
                params.id
            );
        }
    );
};

const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId
) => {
    await socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId,
        },
        async ({ params }) => {
            if (params.error) {
                console.log("cannot consume");
                return;
            }

            console.log(params);

            const consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            consumerTransports.push(...consumerTransports, {
                consumerTransport,
                serverConsumerTransportId: params.id,
                producerId: remoteProducerId,
                consumer,
            });

            const newElem = document.createElement("div");
            newElem.id = "td-" + remoteProducerId;
            newElem.className = "remoteVideo";
            newElem.innerHTML = `<video id="remoteVideo-${remoteProducerId}" autoplay class="video"></video>`;
            videoContainer.appendChild(newElem);

            const { track } = consumer;
            // remoteVideo.srcObject = new MediaStream([track]);
            const remoteVideo = document.getElementById(
                `remoteVideo-${remoteProducerId}`
            );
            remoteVideo.srcObject = new MediaStream([track]);
            socket.emit("consumer-resume", {
                serverConsumerId: params.serverConsumerId,
            });
        }
    );
};

// btnLocalVideo.addEventListener("click", getLocalStream);
btnRecvSendTransport.addEventListener("click", goConsume);
