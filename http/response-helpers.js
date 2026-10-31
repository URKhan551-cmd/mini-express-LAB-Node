// 4. http/response-helpers.js
// Responsibility
// Your application handler should not have to construct raw HTTP response bytes every time it wants to send a message.

// Instead, it should be able to return a response object:
// return text(200, 'Server is working');

// The helper constructs that object. The separate response.js module converts it into HTTP bytes.

'use strict';

function text(status, message, headers={}){
    const body = Buffer.from(String(message), 'utf8');
     // return an object 
    return {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            ...headers
        },
        body
    };
}


function json(status, data, headers={}){
    const serialized = JSON.stringify(data);
    const body = Buffer.from(serialized, 'utf8');

    return {
        status,
        headers: {
            "Content-Type": 'application/json; charset=utf-8',
            ...headers
        },
        body
    };
}


function empty(status=204, headers= {}){
    return {
        status,
        headers,
        body: Buffer.alloc(0)
    };
}

module.exports = {
    empty,
    json,
    text
}


// A. The helper returns an object, not a socket response
// For example:
// const result = text(200, 'Hello');

// The result is approximately:
// {
//     status: 200,

//     headers: {
//         'Content-Type': 'text/plain; charset=utf-8'
//     },

//     body: Buffer.from('Hello')
// }

// No bytes have been sent to the client yet.
// The helper only describes the response. Your response.js module is responsible for serializing and sending it.
// This separation makes application code easier to read and test.

// B. Why use a Buffer for the body?
// const body = Buffer.from(String(message), 'utf8');

// HTTP transmits bytes. A JavaScript string's character count is not necessarily its UTF-8 byte count.

// For example:
// const body = Buffer.from('Hello', 'utf8');

// console.log(body.length); // 5

// The response writer can use body.length to calculate the correct Content-Length.

// C. Why provide three helpers?
// Helper	Purpose	Example
// text()	Return plain text	text(200, 'OK')
// json()	Return JSON	json(200, { ok: true })
// empty()	Return an empty response	empty(204)


// The application can now express what it wants to return without managing HTTP framing.

// For example, in your handler:
// const { text, json, empty } = require('./http/response-helpers');

// async function handler(req) {
//     if (req.path === '/health') {
//         return json(200, { status: 'ok' });
//     }

//     if (req.path === '/delete') {
//         return empty(204);
//     }

//     return text(404, 'Route not found');
// }

// This assumes your application handler receives the req.path property populated by Connection.dispatch().
