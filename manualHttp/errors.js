'use strict';
// Responsibility: represent HTTP errors with their associated status codes.

class HttpError extends Error {
    constructor(status, message){
        super(message);
        this.status = status;
    }
}

module.exports = { HttpError };