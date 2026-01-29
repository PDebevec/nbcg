"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.minio = void 0;
const minio_1 = require("minio");
const env_1 = __importDefault(require("./env"));
exports.minio = new minio_1.Client({
    endPoint: env_1.default.MINIO_ENDPOINT,
    port: env_1.default.MINIO_PORT,
    accessKey: env_1.default.MINIO_ACCESS_KEY,
    secretKey: env_1.default.MINIO_SECRET_KEY,
    useSSL: env_1.default.MINIO_USE_SSL
});
