// Responsbility manage one TCP connetion, 
// its state machine, timers, incoming bytes, request dispatch, and connection lifecycle

// the parsing, body reading, response writting implementations now live in seperate modules.

'use strict';
const {parseHead} = require('../http/parse-head');
const {readBody} = require('../http/read-body');
const {respond} = require('../http/response');
const {HttpError} = require('../errors');
const {text} = require("../http/response-helpers");

let nextConnectId = 1;

class Connection {
    constructor(socket, server){
        this.id = nextConnectId++;
        this.socket = socket;
        this.server = server;
        this.opts = server.opts;
        this.buff = Buffer.alloc(0);
        this.state = "HEAD";
        this.req = null;
        this.served = 0;
        this.timer = null;
        this.headerTimerArmed = false;
        this.bodyTimerArmed = false;
        this.closeAfterResponse = false;

        socket.setNoDelay(true);

        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('end', () => this.onPeerFin());
        socket.on('error', () => socket.destroy());
        socket.on("close", () => this.onClose());
        
        this.setTimer(this.opts.keepAliveTimeoutMs);
    }

    // timers
    setTimer(ms){
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onTimeout(), ms);
    }

    clearTimer(){
        clearTimeout(this.timer);
        this.timer = null;
    }

    onTimeout(){
        if(this.state === "HEAD" && this.buff.length === 0){
            this.state = "CLOSED";
            this.socket.destroySoon();
        } else if(this.state === "HEAD" || this.state === "BODY"){
            this.fail(408, "Request Timeout");
        }
    }

    isIdle(){
        return this.state === "HEAD" && this.buff.length === 0;
    }

    // input
    onData(chunk){
        if(this.state === "CLOSED") return;

        this.buff = this.buff.length ? Buffer.concat([this.buff, chunk]) : chunk;

        if(this.state === "HEAD" || this.state === "BODY"){
            this.pump();
        } else if(this.buff.length > this.opts.maxHeaderBytes + this.opts.maxBodyBytes){
            this.socket.destroy();
        }
    }
 
    onPeerFin(){
        if(this.state === 'BUSY'){
            this.closeAfterResponse = true;
            return;
        }

        this.state = 'CLOSED';
        this.socket.end();
    }

    onClose(){
        this.state = 'CLOSED';
        this.clearTimer();
        this.server.connections.delete(this);
    }

    pump(){
        for(;;){
            if(this.state === "HEAD"){
                if(this.buff.length === 0) return;

                if(!this.headerTimerArmed){
                    this.setTimer(this.opts.headerTimeoutMs);
                    this.headerTimerArmed = true;
                }

                const end = this.buff.indexOf('\r\n\r\n');

                if(end === 1){
                    if(this.buff.length > this.opts.maxHeaderBytes){
                        return this.fail(431, "Header Too large");
                    }
                    
                    return;
                }

                if(end > this.opts.maxHeaderBytes){
                    return this.fail(431, "Header Too Large");
                }

                try{
                    this.req = parseHead.call(this, this.buff.subarray(0, end));
                } catch (e){
                    return this.fail(e.status || 400, e.message);
                }

                this.buff = this.buff.subarray(end + 4);
                this.clearTimer();
                this.headerTimerArmed = false;
                this.state = "BODY";

                if(this.req.expectContinue){
                    this.socket.write('HTTP/1.1 100 Continue\r\n\r\n');
                }
            }

            if(this.state === "BODY"){
                let done;
                try{
                    done = readBody.call(this);
                } catch (e) {
                    return this.fail(e.status || 400, e.message);
                }

                if(!done){
                    if(!this.bodyTimerArmed){
                        this.setTimer(this.opts.bodyTimeoutMs);
                        this.bodyTimerArmed = true;
                    }

                    return;
                }

                this.clearTimer();
                this.bodyTimerArmed = false;
                return this.dispatch();
            }

            return;
        }
    }


    // dispatch

    async dispatch(){
        this.state = "BUSY";
        const req = this.req;
        this.req = null;
        this.served++;

        req.connId = this.id;
        req.nthOnConnection = this.served;

        let res;
         try{
            const url = new URL(req.target, 'http://' + (req.headers.host || 'localhost'));

            req.path  = url.pathname;
            req.query = url.searchParams;

            res = await this.server.handler(req);
         } catch (err){
            if(err instanceof HttpError){
                res = text(err.status, err.message);
            } else if(err instanceof TypeError && /Invalid URL/.test(err.message)){
                res = text(400, "Bad request target");
            } else{
                console.error(err)
                res = text(500, "internal");
                
            }
         }


         this.respond(req, res);
    }
    respond(req, res){
            respond.call(this, req, res);
    }

    // error
    fail(status, message){
        if(this.state === "CLOSED") return;

        this.state = 'CLOSED';
        this.clearTimer();

        const body = Buffer.from(message + '\n');

        const head = HTTP/1.1 $DIL0 $DIL1\r\n +
            content-type: text/plain; charset=utf-8\r\n +
            content-length: $DIL2\r\n +
            connection: close\r\n\r\n;
       
            this.socket.end(Buffer.concat([
                Buffer.from(head, 'latin1'), 
                body, 
            ])
        );

        setTimeout(() => this.socket.destroy(), 1000).unref();

    }

    // shutdown

    drain(){
        if(this.isIdle()){
            this.state = 'CLOSED';
            this.clearTimer();
            this.socket.end();
        } else {
            this.closeAfterResponse = true;
        }
    }
}

module.exports = {Connection}; 