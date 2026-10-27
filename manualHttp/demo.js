// Responsiblity 
// demonstrate the server routes and handle process signals.
// the demo is seperate from the http server implementation

'use strict';

const {ManualHttpServer} = require('./server');
const {json, text} = require('./http/response-helpers');

if(require.main === module){
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const server = new ManualHttpServer(async (req) =>  {
        if(req.method === "GET" && req.path === '/'){
            // connId + nthOnConnection reveal TCP reuse,
            // same connId , risiing counter,
            return json(200, {
                connection: req.connId,
                requestOnThisConnection: req.nthOnConnection,
            });
        }

        if(req.method === 'GET' && req.path === '/slow'){
            await sleep(Number(req.query.get('ms')) || 3000);
            return json(200, {
                slept: true,
                connection: req.connId,
            });
        }

        if(req.method === 'POST' && req.path === '/echo'){
            return json(200, {
                bytes: req.body.length,
                body: req.body.toString('utf8'),
            });
        }

        return text(404, "Not Found");
    });

    const port = Number(process.env.PORT) || 3000;
    server.listen(port).then(() => {
        console.log()
    });

    const stop = async (sig) => {
        console.log();

        await server.shutdown(8000);
        console.log('drained, exiting');
        process.exit(0);
    };

    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
}