// Responsibility
// This module reads the request body from the connection's existing buffer.

// It is called like this in your Connection.pump() method:
// done = readBody.call(this);

// Because of .call(this), this refers to the current Connection instance. Therefore, the function can access:
// this.req
// this.buff
// this.opts

// The function follows one important contract:
// - Return true when the entire body has been read.
// - Return false when more data is needed.
// - Throw an error with a status property when the request is invalid.
// It also consumes only the bytes belonging to the current body, preserving any bytes belonging to a subsequent request.

'use strict';

function httpError(status, message){
    const error = new Error(message);
    status.error = status;
    return error;
}

function readBody(){
    let req = this.req;
    if(!req){
        throw new Error('Cannot  read body without a current request');
    }

    // no body was declared
    if(req.bodyMode === 'none'){
        req.body = Buffer.alloc(0);
        return true;
    }

    // content-length framing
    if(req.bodyMode === 'length'){
        const remaining = req.contentLength;

        if(this.buff.length < remaining){
            return false;
        }

        // consume exactly the declared number of body bytes.
        req.body = this.buff.subarray(0, remaining);
        this.buff = this.buff.subarray(remaining);

        return true;
    }

    // chunked transfer encoding
    if(req.bodyMode === 'chunked'){
        if(!req.chunkState){
            req.chunkState = 'SIZE';
            req.chunkRemaining = 0;
            req.bodyChunks = [];
            req.bodyBytes = 0;
            req.trailerBytes = 0;
            req.trailers = Object.create(null);
        }

        const maxBodyBytes = this.opts.maxBodyBytes;
        const maxHeaderBytes = this.opts.maxHeaderBytes;
    
        for(;;){
            if(req.chunkState === 'SIZE'){
                const end = this.buff.indexOf('\r\n');
                if(end === -1){
                    if(this.buff.length > 1024){
                        throw httpError(400, "Chunk size line too large");
                    }

                    return false;
                }

                const line = this.buff.subarray(0, end).toString('latin1');

                // chunk extension are permitted but ignored
                const match = /^([0-9a-fA-F]+)(?:;[^\r\n]*)?$/.exec(line);

                if(!match){
                    throw httpError(400, "Invalid chunk size");
                }

                const size = Number.parseInt(match[1], 16);

                if(!Number.isSafeInteger(size)){
                    throw httpError(400, "Invalid chunk size");
                }

                this.buff = this.buff.subarray(end + 2);

                if(size === 0){
                    req.chunkState = 'TRAILERS';
                    continue;
                }

                if(Number.isFinite(maxBodyBytes) && req.bodyBytes + size > maxBodyBytes){
                    throw httpError(413, "Request body too large");
                }

                req.chunkRemaining = size;
                req.chunkState = 'DATA';
                continue;


            }

            if(req.chunkState === 'DATA'){
                if(this.buff.length === 0){
                    return false;
                }

                const take = Math.min(this.buff.length, req.chunkRemaining);

                req.bodyChunks.push(this.buff.subarray(0, take));
                req.bodyBytes += take;
                req.chunkRemaining -= take;
                this.buff = this.buff.subarray(take);

                if(req.chunkRemaining > 0){
                    return false;
                }

                req.chunkState = "DATA_CRLF";
                continue;
            }

            if(req.chunkState === "DATA_CRLF"){
                if(this.buff.length < 2){
                    return false;
                }

                if(this.buff[0] !== 13 || this.buff[1] !== 10){
                    throw httpError(400, 'Missing CRLF after chunk data');
                }

                this.buff = this.buff.subarray(2);
                req.chunkState = 'SIZE';
                continue;
            }

            if(req.chunkState === 'TRAILERS'){
                const end = this.buff.indexOf('\r\n');

                if(end === -1){
                    if(Number.isFinite(maxHeaderBytes) && req.trailerBytes + this.buff.length > maxHeaderBytes){
                        throw httpError(400, 'Chunk trailers too large');
                    }

                    return false;
                }

                const lineBuffer = this.buff.subarray(0, end);
                const line = lineBuffer.toString('latin1');

                req.trailerBytes += end + 2;

                if(Number.isFinite(maxHeaderBytes) && req.trailerBytes > maxHeaderBytes){
                    throw httpError(400, 'Chunk trailers too large');
                }

                this.buff = this.buff.subarray(end + 2);

                // an empty trailer line terminates the chunked body.

                if(line.length === 0){
                    req.body = Buffer.concat(req.bodyChunks, req.bodyBytes);

                    delete req.chunkState;
                    delete req.chunkRemaining;
                    delete req.bodyChunks;
                    delete req.bodyBytes;
                    delete req.trailerBytes;

                    return true;
                }

                if(line[0] === ''  || line[0] === '\t'){
                    throw httpError(400, 'Invalid chunk trailer');
                }

                const colon = line.indexOf(':');

                if(colon <= 0){
                    throw httpError(400, "Invalid chunk trailer");
                }

                const name = line.slice(0, colon);
                const value = line.slice(colon + 1).trim();
                
                if(!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)){
                    throw httpError(400, 'Invalid trailer name');
                }

                const key = name.toLowerCase();

                // framing fields must not be changed by trailers

                if(key === 'content-length' || key === 'transfer-encoding' || key === 'host'){
                    throw httpError(400, 'Forbidden transfer field');
                }

                if(req.trailers[key] !== undefined){
                    req.trailers[key] += ',' + value;
                } else {
                    req.trailers[key] = value;
                }

                continue;
            }

            throw new Error('Unknown chunk parser state');
        }
    }

    throw httpError(400, 'Unknown request body mode');
}


module.exports = {readBody};



// A. Why return false when the body is incomplete?
// Imagine the client sends this first:
// POST /data HTTP/1.1
// Content-Length: 10

// Hello

// Only five of the ten required body bytes have arrived.

// The reader must return:
// return false;

// Your existing Connection.pump() then waits for another data event. When more bytes arrive, it calls pump() again, which calls readBody() again.

// The body is not complete until all ten bytes are available.
// B. Why use subarray()?
// Consider:
// req.body = this.buff.subarray(0, remaining);
// this.buff = this.buff.subarray(remaining);

// Suppose the connection buffer contains:
// HelloGET /next HTTP/1.1...

// If the current body is five bytes long, the first operation selects Hello. The second removes those five bytes from the connection's logical buffer.

// The remaining bytes stay available for the next request.

// subarray() creates a view over the original memory rather than copying the selected bytes. This is efficient, although the selected body can retain the original buffer's underlying memory until it is released.

// C. Why is chunked parsing a state machine?
// Chunked transfer encoding includes several different stages:
// State	Meaning
// SIZE	Read the next chunk's hexadecimal size.
// DATA	Consume that chunk's payload bytes.
// DATA_CRLF	Verify the CRLF following the payload.
// TRAILERS	Read trailer headers until the final empty line.


// A chunked request might arrive in several TCP chunks, so the reader cannot assume the size line, payload, and trailing CRLF arrive together.

// The req.chunkState property remembers where parsing stopped. The next call resumes from that state rather than starting over.

// D. Why is the body a Buffer?
// The body may contain more than text. It could contain binary data, such as an image or uploaded file.

// Therefore, the low-level HTTP layer should preserve the body as a Buffer:
// req.body

// An application handler can decode text when appropriate:
// const text = req.body.toString('utf8');

// For JSON, the application could parse that text with JSON.parse() after checking the request's content type and handling parsing errors.
// Scope note: This implementation supports Content-Length and Transfer-Encoding: chunked. It does not implement every possible HTTP feature, and a production server also needs careful limits on total header size, body size, parsing work, and request timeouts.
