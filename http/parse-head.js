// Responsibility
// This module converts raw HTTP header bytes into a JavaScript request object.

'use strict';

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function httpError(status, message){
    let error = new Error(message);
    error.status = status;
    return error;
}

function parseHead(headerBuffer){
    if(!Buffer.isBuffer(headerBuffer)){
        throw new TypeError("Header Buffer must be a buffer");
    }

    let raw = headerBuffer.toString("latin1");
    let lines = raw.split("\r\n");

    if(lines.length === 0 || lines[0].length === 0){
        throw httpError(400, "Missing request line");
    }

    // Example: GET /products?id=42 HTTP/1.1
    const requestLine = lines.shift();
    const match = /^([^ \t]+) ([^ \t]+) HTTP\/(1\.[01])$/.exec(requestLine);

    if(!match){
        throw httpError(400, "Malformed request line");
    }

    const [method, target, version] = match;

    if(!TOKEN.test(method)){
        throw httpError(400, "Invalid http method");
    }

    if(target.length === 0 || /[\x00-\x20\x7f]/.test(target)){
        throw httpError(400, "Target not specified");
    }

    const headers = Object.create(null);

    for(let line of lines){
        if(line.length === 0){
            throw httpError(400, "Unexpected empty header line");
        }

        if(line[0] === 0 || line[0] === "\t"){
            throw httpError(400, "Folded headers are not supported");
        }

        const colon  = line.indexOf(":");  // will give us an index position of colon
        if(colon <= 0){
            throw httpError(400, "Malformed header");
        }

        let name = line.slice(0, colon); // before colon in header so called name
        let value = line.slice(colon + 1).trim();

        if(!TOKEN.test(name)){
            throw httpError(400, "Invalid headers name");
        }

        if(/[\x00-\x08\x0a-\x1f\x7f]/.test(value)){
           throw httpError(400, "Invalid header value");
        }

        const key = name.toLowerCase();

        if(key === "content-length" || key === "transfer-encoding"){
            // Keep these as arrays so duplicate framing headers can be
            // checked explicitly instead of silently overwriting them.
            if(!headers[key]){
                headers[key] = [];
            }

            headers[key].push(value);
        } else {
            if(headers[key] !== undefined){
                headers[key] += "," + value;
            } else {
                headers[key] = value;
            }
        }
    }

    if(version === "1.1" &&  !headers.host){
        throw httpError(400, "Host headers is required for http 1.1");
    }

    if(Array.isArray(headers.host)){
        throw httpError(400, "Multiple host headers are not supported");
    }

    // parse content-length
    let contentLength = 0;
    if(headers[content-length]){
        let values = headers['content-length'];

        if(values.length === 0 || values.some(value => !/^\d+$/.test(value))){
            throw httpError(400, "Invalid content length");
        }

        let lengths = values.map(Number);

        if(lengths.some(length => !Number.isSafeInteger(length))
         || lengths.some(length =>  length !== length[0])
        ){
            throw httpError(400, "Conflicting content length headers");
        }

        contentLength = lengths[0];

    }

    // parse transfer-encoding
    let bodyMode = "none";
    if(headers["transfer-encoding"]){
        let values  = headers['transfer-encoding'];
        
        if(values.length !== 1 ||values[0].toLowerCase().trim() !== "chunked" ){
            throw httpError(501, "Transfer encoding not supported");
        } 

        if(headers['content-length']){
            throw httpError(400, 'content-length and transfer encoding cannot be combined');
        };

        bodyMode = "chunked";

    } else if(contentLength > 0){
        bodyMode = 'length';
    }

    if(Number.isFinite(this.opts.maxBodyBytes) && contentLength > this.opts.maxBodyBytes){
        throw httpError(413, 'Request body too large');
    }

    // parse expect
let expectContinue = false;
if(headers.expect !== undefined){
    if(headers.expect.toLowerCase() !== '100-continue'){
        throw httpError(417, 'Expectation not supported');
    }

    expectContinue = bodyMode !== 'none';
}

 // HTTP/1.1 connections remain persistent unless told otherwise.
    // HTTP/1.0 connections close unless keep-alive is requested.

    const connectionTokens = (headers.connection || '').split(',').map(value => value.trim().toLowerCase());

    const keepAlive = !connectionTokens.includes('close') && 
    (version === '1.1' || connectionTokens.includes('keep-alive'));


    return {
        method,
        target,
        version,
        headers,
        contentLength,
        bodyMode,
        expectContinue,
        keepAlive,
        body: Buffer.alloc(0)
    };
}
module.exports = {parseHead};


// For example, the client might send:
// GET /products?id=42 HTTP/1.1
// Host: localhost:3000
// Accept: application/json
// Connection: keep-alive


// Your connection buffer contains bytes, not a JavaScript object. parse-head.js turns those bytes into something like:
// {
//     method: "GET",
//     target: "/products?id=42",
//     version: "1.1",

//     headers: {
//         host: "localhost:3000",
//         accept: "application/json",
//         connection: "keep-alive"
//     },

//     contentLength: 0,
//     bodyMode: "none",
//     expectContinue: false,
//     keepAlive: true
// }

// The body itself is handled separately by read-body.js.


// Why toString('latin1')?
// const raw = headerBuffer.toString('latin1');

// The TCP socket delivers a Buffer containing bytes. We need to inspect the HTTP syntax, so we convert the header bytes into a string.

// latin1 maps each byte to a corresponding character, avoiding UTF-8 decoding changes while examining the wire representation. HTTP header syntax itself uses ASCII-compatible characters.
// B. Why convert header names to lowercase?
// const key = name.toLowerCase();

// HTTP header names are case-insensitive. These are equivalent:
// Content-Length: 5
// content-length: 5
// CONTENT-LENGTH: 5

// Storing all names in lowercase means the rest of your server only needs to look up:
// req.headers['content-length']

// C. Why validate Content-Length?
// if (headers['content-length']) {
//     // Validate its value.
// }

// Content-Length determines how many bytes belong to the request body.

// Suppose a client sends:
// POST /data HTTP/1.1
// Host: localhost
// Content-Length: 5

// Hello

// The body contains five bytes. Your server must consume exactly five bytes—not all the bytes currently available in the socket buffer.


// Otherwise, if the client sends another request immediately afterward, the parser could accidentally consume bytes belonging to that next request.

// The parser also rejects conflicting lengths and requests that exceed your configured body-size limit.
// D. Why support chunked transfer encoding?
// A client can send a body without knowing its final size in advance:
// POST /data HTTP/1.1
// Host: localhost
// Transfer-Encoding: chunked

// 5
// Hello
// 0


// In an actual HTTP message, the chunk-size lines and chunk data are separated by CRLF characters. The body reader must remove this framing and assemble the actual payload.

// That is why parse-head.js records:
// bodyMode: 'chunked'

// It does not decode the chunks itself. That is the responsibility of read-body.js.
// E. Why calculate keepAlive?
// HTTP/1.1 normally allows multiple requests over the same TCP connection. The Connection: close header tells the server not to keep that connection available for subsequent requests.

// The connection manager uses req.keepAlive to decide whether to return to the HEAD state after sending a response or close the socket.

