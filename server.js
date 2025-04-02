const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { murmur2 } = require('murmurhash-js');
const buffers = require('./buffers');
const algorithm = require('./algorithm');
const Reader = require('./reader');
const Entity = require('./entity');
const requester = require("request-promise");
const logger = require("./logger.js");
const config = require('./config.json');

// تحديد المسار المطلق لملف proxies.txt
const proxiesPath = path.resolve(__dirname, 'proxies.txt');

// التحقق من وجود الملف قبل قراءته
let proxies = [];
if (fs.existsSync(proxiesPath)) {
    proxies = fs.readFileSync(proxiesPath, 'utf-8').split('\n').filter(Boolean);
} else {
    logger.error(`[SERVER] ملف proxies.txt غير موجود في: ${proxiesPath}`);
    process.exit(1); // إنهاء البرنامج لتجنب تشغيله بدون البروكسيات
}

const userBots = [];
let userWS = null, stoppingBots = false, connectedBots = 0, spawnedBots = 0, serverPlayers = 0;

// التحقق من التحديثات
if (config.server.update) {
    requester(config.server.link, (err, req, data) => {
        if (err) return logger.error('[SERVER] فشل في التحقق من التحديثات!');
        try {
            const requesterConfig = JSON.parse(Buffer.from(data).toString());
            if (config.server.version < requesterConfig.server.version) {
                logger.warn(`[SERVER] يوجد تحديث جديد! حمله من: https://github.com/AX123AA/agar.io-BOTS.git`);
            } else {
                logger.good(`[SERVER] لا يوجد تحديثات جديدة.`);
            }
        } catch (error) {
            logger.error(`[SERVER] خطأ في تحليل بيانات التحديث: ${error.message}`);
        }
    });
} else {
    logger.error('[SERVER] التحقق من التحديثات معطل!');
}

logger.good(`[SERVER] يعمل بالإصدار ${config.server.version} على المنفذ ${config.server.port}`);

// باقي الكود بدون تغيير...

const game = { url: '', protocolVersion: 0, clientVersion: 0 };
const user = { ws: null, bots: [], startedBots: false, stoppingBots: false, isAlive: false, mouseX: 0, mouseY: 0 };
const bots = { name: '', amount: 0, ai: false };

const dataBot = {
    ws: null, buffersKey: 0, isConnected: false, playersAmount: 0, lastPlayersAmount: 0,
    connect() {
        this.reset();
        this.ws = new WebSocket(game.url);
        this.ws.onopen = this.onopen.bind(this);
        this.ws.onmessage = this.onmessage.bind(this);
        this.ws.onclose = this.onclose.bind(this);
    },
    reset() {
        this.buffersKey = 0;
        this.isConnected = false;
        this.playersAmount = 0;
        this.lastPlayersAmount = 0;
    },
    send(buffer) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buffer);
    },
    onopen() {
        this.send(buffers.protocolVersion(game.protocolVersion));
        this.send(buffers.clientVersion(game.clientVersion));
    },
    onmessage(message) {
        if (this.buffersKey) message.data = algorithm.rotateBufferBytes(message.data, this.buffersKey);
        this.handleBuffer(message.data);
    },
    onclose() {
        if (this.isConnected) {
            this.isConnected = false;
            this.connect();
            logger.error('[SERVER] DataBot disconnected!');
        }
    },
    handleBuffer(buffer) {
        const reader = new Reader(buffer);
        switch (reader.readUint8()) {
            case 54:
                this.playersAmount = 0;
                serverPlayers = 0;
                reader.byteOffset += 2;
                while (reader.byteOffset < reader.buffer.byteLength) {
                    const flags = reader.readUint8();
                    if (flags & 2) reader.readString();
                    if (flags & 4) reader.byteOffset += 4;
                    this.playersAmount++;
                    serverPlayers++;
                }
                this.lastPlayersAmount = this.playersAmount;
                break;
            case 241:
                this.buffersKey = reader.readInt32() ^ game.clientVersion;
                this.isConnected = true;
                logger.good('[SERVER] DataBot connected!');
                break;
        }
    }
};

new WebSocket.Server({ port: config.server.port }).on('connection', ws => {
    userWS = ws;
    logger.good('[SERVER] User connected!');
    ws.on('message', buffer => {
        const reader = new Reader(buffer);
        switch (reader.readUint8()) {
            case 0:
                if (!user.startedBots) {
                    game.url = reader.readString();
                    game.protocolVersion = reader.readUint32();
                    game.clientVersion = reader.readUint32();
                    user.isAlive = !!reader.readUint8();
                    bots.name = reader.readString();
                    bots.amount = reader.readUint8();
                    dataBot.connect();
                    setInterval(() => {
                        if (dataBot.lastPlayersAmount < 195 && connectedBots < bots.amount && !stoppingBots) userBots.push(new Bot());
                    }, 150);
                    logger.good('[SERVER] Starting bots...');
                }
                break;
            case 1:
                stoppingBots = true;
                ws.send(Buffer.from([1]));
                setTimeout(() => process.exit(), 30000);
                break;
        }
    });
    ws.on('close', () => {
        stoppingBots = true;
        logger.error('[SERVER] User disconnected!');
    });
});
