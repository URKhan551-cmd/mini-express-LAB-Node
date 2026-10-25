'use strict';

const net = require('net');
const reasons = {
    100: "Continue", 200: "OK", 201: "Created", 204: 'No Content',
    400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed",
    408: "Request Timeout", 413: "Payload Too Large",
    431: "Request Header Fields Too Large", 
    500: "Internal Server Error", 501: "Not Implemented",
    503: "Service Unavailable", 505: "HTTP Version Not Supported",

};

const defaults = {
    maxHeadersBytes: 16 * 1024,
    maxBodyBytes: 1024 * 1024,
    headerTimeoutMs: 10_000, // slow protection: whole head must arrive in this time
    bodyTimeoutMs: 30_000,
    keepAliveTimeoutMs: 5_000, // idle /stop time allowed between request
    maxRequestsPerConnection: 1000,
};


