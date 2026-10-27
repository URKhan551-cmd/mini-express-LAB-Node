// RESPONSIBILITY 
// build http response, determine whether to keep the TCP 
// conection open, and handle socket backpresssure

'use strict';

const {reasons} = require('./constants');

function respond(req, res){
    if(this.socket.destroyed) return;

    const connHdr = (req.headers.connection || "").toLowerCase();

    const clientAllowsKeepAlive = req.httpVersion === '1.1' ?
    !/\bclose\b/.test(connHdr) : /\bkeep-alive\b/.test(connHdr);

    const keep = clientAllowsKeepAlive && 
    !this.closeAfterResponse &&
    !this.server.draining &&
    this.served < this.opts.maxRequestPerConnection;

    const status = res.status || 200;

    const bodyAllowed = !(status === 204 || status === 304 || status < 200);

    const bodyBuf = !bodyAllowed || res.body == null ?
    Buffer.alloc(0) : Buffer.isBuffer(res.body) ?
    res.body : Buffer.from(String(res.body), 'utf8');


    const headers = {
        date: new Date().toUTCString(),
        ...arguments(res.headers || {}),
    };

    if(body.allowed){
        headers['content-length'] = bodyBuf.length;
    }

    headers.connection = keep ? 'keep-alive' : 'close';

    if(keep){
        headers['keep-alive'] = Timeout={};
    }

    let head = HTTP/1.1 {{}};

    for(const [k, v] of Object.entries(headers)){
        head += {{}}; 
    }

    head += '\r\n';

    const out = req.method === 'HEAD' || !bodyAllowed ? 
    Buffer.from(head, 'latin1') :
    Buffer.concat([Buffer.from(head, 'latin1'),
        bodyBuf,
    ]);

    const flushed = this.socket.write(out);

    if(!keep){
        this.state = 'CLOSED';
        this.clearTimer();
        
    }
}