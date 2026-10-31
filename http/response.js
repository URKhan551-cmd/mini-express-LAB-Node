// RESPONSIBILITY
// this is the module that converts the response object into valid HTTP response 
// writes it to TCP socket .   it mean hand over it to socket = write socket which 
// take the response to show it to the client.

// example : 
// {
//     status: 200,
//     headers: {
//         'Content-Type': 'text/plain; charset=utf-8'
//     },
//     body: Buffer.from('Hello')
// } 

// The response writer turns that into these bytes:
// HTTP/1.1 200 OK
// Content-Type: text/plain; charset=utf-8
// Content-Length: 5
// Connection: keep-alive

// Hello

// The actual HTTP message uses \r\n line endings. The blank line between the headers and Hello marks the end of the header section.

'use strict';


const statusMsg = {
    100: 'Continue',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    206: 'Partial Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    413: 'Content Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    417: 'Expectation Failed',
    418: "I'm a Teapot",
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
};


const headerName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;


function normalizeBody(body){
    if(body === undefined || body === null){
        return Buffer.alloc(0);
    }

    if(Buffer.isBuffer(body)){
        return body;
    }

    if(typeof body === 'string'){
        return Buffer.from(body, 'utf8');
    }
    throw new TypeError('Response body must be a Buffer or string');
}


function response(req, res){
    // do not continue writting after the connection has been closed.
    // writting to socket mean = put data on socket to take it as TCP towards client as response.

    if(this.state === 'CLOSED' || this.socket.destroyed){
        return;
    }

    try{
        if(!res || typeof res !== 'object'){
            throw new TypeError('Handler must return a response object');
        }

        const status = res.status;

        if(!Number.isInteger(status) || status < 200 || status > 599){
            throw new TypeError('Invalid final HTTP response status');
        } 

        const reason = statusMsg[status];

        if(!reason){
            throw new TypeError(`Unsupported response status: ${status}`);
        }

        const body = normalizeBody(res.body);
        const headers = Object.create(null);

        // Validate application - provided headers.

        for(const [name, rawValue] of Object.entries(res.headers || {})){
            if(!headerName.test(name)){
                throw new TypeError(`Invalid response header name: ${name}`);
            }

            const key = name.toLowerCase();
            const value = String(rawValue);

            // prevent CRLF/header injection
            if(/[\x00-\x08\x0a-\x1f\x7f]/.test(value)){
                throw new TypeError(`Invalid response header value: ${name}`);
            }

            if(key === 'content-length' || key === 'transfer-encoding'){
                throw new TypeError('Content-Length and Transfer-Encoding are managed by the server');
            }

            if(key === 'connection'){
            throw new TypeError('Connection is managed by the server');
            }

            headers[key] = value;
        }

        const noBodyStatus = (status >= 100 && status < 200) || status === 204 || status === 304;

        const isHeadRequest = req.method === 'HEAD';

        const shouldClose = this.closeAfterResponse === true || req.keepAlive !== true;

        const lines = [`HTTP/1.1 ${status} ${reason}`];

        for(const [name, value] of Object.entries(headers)){
            lines.push(`${name}: ${value}`);
        }

        // head responses describe the representation but do not transmit
        // its body 204 and 304 responses also have no transmitted body.

        if(!noBodyStatus){
            lines.push(`content-length: ${body.length}`);
        }

        lines.push(`connection: ${shouldClose ? 'close' : 'keep-alive'}`);

        // the final empty line terminates the HTTP header section.
        const head = lines.join('\r\n') + '\r\n\r\n';

        const headBuffer = Buffer.from(head, 'latin1');

        const bodyBuffer = noBodyStatus || isHeadRequest ? Buffer.alloc(0) : body;

        const output = Buffer.concat([headBuffer, bodyBuffer]);

        this.clearTimer();

        if(shouldClose){
            this.state = 'CLOSED';
            this.socket.end(output);
            return;
        }

        // keep-alive : send this response and prepare for another request.
        this.socket.write(output);
        this.closeAfterResponse = false;
        this.req = null;
        this.state = 'HEAD';

        this.headerTimerArmed = false;
        this.bodyTimerArmed = false;

        this.setTimer(this.opts.keepAliveTimeoutMs);


        // the next request already be buffered. process it 
        // without waiting for another TCP data event

        if(this.buff.length > 0){
            this.pump();
        }

        
    } catch (error){
        console.error('Failed to construct HTTP response: ', error);


        // avoid recurssively calling this response writer if response 
        // construction itself failed.
        this.state = 'CLOSED';
        this.clearTimer();

        if(!this.socket.destroyed){
            const body = Buffer.from('Internal Server Error\n', 'utf8');

            const fallback = 'HTTP/1.1 500 Internal Server Error\r\n' + 
            'Content-Type: text/plain; charset=utf-8\r\n' +
            'content-Length: ${body.length}\r\n' +
            'Connection : close\r\n' + 
            '\r\n';

            this.socket.end(
                Buffer.concat(
                    [ Buffer.from(fallback, 'latin1'),
                        body
                    ]
                )
            )
        }
    }
}

module.exports = {respond: response};

// A. Why is the response a sequence of bytes?
// The application creates a logical response object:
// {
//     status: 200,
//     headers: {
//         'Content-Type': 'text/plain; charset=utf-8'
//     },
//     body: Buffer.from('Hello')
// }

// The response writer converts that into an HTTP message:

// The response writer converts that into an HTTP message:
// HTTP/1.1 200 OK
// content-type: text/plain; charset=utf-8
// content-length: 5
// connection: keep-alive

// Hello

// The status line, headers, and body are all transmitted through the TCP socket. The HTTP header section ends at \r\n\r\n.

// B. Why calculate Content-Length from the buffer?
// lines.push(`content-length: ${body.length}`);

// The length must be measured in bytes, not JavaScript characters.

// For example:
// const body = Buffer.from('Hello', 'utf8');

// console.log(body.length); // 5

// For text containing non-ASCII characters, the byte count may differ from the string's character count. Calculating the length from the encoded buffer avoids that problem.
// C. Why handle HEAD requests separately?
// A HEAD request asks for the same response metadata as a corresponding GET request, but without the response body.
// const bodyBuffer =
//     noBodyStatus || isHeadRequest
//         ? Buffer.alloc(0)
//         : body;

// The server can report the representation's length while sending no representation bytes.

// The response writer also suppresses bodies for statuses such as 204 No Content and 304 Not Modified.

// D. Why is Connection managed by the server?
// const shouldClose =
//     this.closeAfterResponse === true ||
//     req.keepAlive !== true;

// Your server needs to coordinate the response with the connection state machine.

// If the connection is supposed to close, the response includes:
// Connection: close

// If the connection can be reused, the response includes:
// Connection: keep-alive

// The writer then either ends the socket or returns the connection to the HEAD state.

// This is important because the application handler should not independently decide whether the TCP connection remains open.

// E. Why call pump() after responding?
// if (this.buff.length > 0) {
//     this.pump();
// }

// Consider a client that sends two requests over one TCP connection:
// GET /first HTTP/1.1
// Host: localhost

// GET /second HTTP/1.1
// Host: localhost


// Both requests might arrive in the same TCP data chunk.

// The first request is parsed and dispatched. The bytes for the second request remain in this.buff.

// Once the first response is written, the connection must check whether another complete request is already buffered. Otherwise, the second request might remain unprocessed indefinitely if no new data arrives.


