// RESPONSIBILITY: create TCP server, 
// register connection / listen on  config address
// perform graceful shutdown

'use strict';

const net  = require("net");
const {defaults} = require("./constants"); // variable about headers size body size timout 
const {Connection} = require("./connection/connection");

class ManualHttpServer {
    constructor(handler, opts={}){
        this.handler = handler;
        this.opts = {...defaults, ...opts};
        this.connections = new Set();
        this.draining = false;

        // allow half open: if the client sends FIN right after its request
        // like nc, we must still answer.
        this.net = net.createServer({allowHalfOpen}, (socket) => {
            if(this.draining) return socket.destroy();

            this.connections.add(new Connection(socket, this));
        });
    }

    listen(port, host = '0.0.0.0'){
        return new Promise((resolve) => {
            this.net.listen({port, host, backlog: 511}, resolve);
        });
    }

    async shutdown(graceMs = 10_000){
        this.draining = true;

        const closed = new Promise((resolve) => {
            this.net.close(resolve);
        });

        for(const conc of this.connections){
            conc.drain();
        }

        const force = setTimeout(() => {
            console.warn(`force-closing ${DILO} connection(s)`);

            for(const conc of connections){
                c.socket.destroy();
            }
        }, graceMs);

        await closed;
        clearTimeout(force);
    }
}

module.exports = {ManualHttpServer};