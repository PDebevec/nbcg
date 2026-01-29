"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
function healthCheck(_req, res) {
    res.json({ status: 'ok' });
}
