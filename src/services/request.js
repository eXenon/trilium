"use strict";

const utils = require('./utils');
const log = require('./log');
const url = require('url');

// this service provides abstraction over node's HTTP/HTTPS and electron net.client APIs
// this allows to support system proxy

function exec(opts) {
    const client = getClient(opts);
    const parsedTargetUrl = url.parse(opts.url);

    return new Promise(async (resolve, reject) => {
        try {
            const headers = {
                Cookie: (opts.cookieJar && opts.cookieJar.header) || "",
                'Content-Type': 'application/json'
            };

            if (opts.auth) {
                const token = Buffer.from(opts.auth.user + ":" + opts.auth.pass).toString('base64');

                headers['Authorization'] = `Basic ${token}`;
            }

            let host = parsedTargetUrl.hostname;
            let protocol = parsedTargetUrl.protocol;
            let port = parsedTargetUrl.port;
            let path = parsedTargetUrl.path;

            if (opts.proxy) {
                // see https://stackoverflow.com/questions/3862813/how-can-i-use-an-http-proxy-with-node-js-http-client
                const parsedProxyUrl = url.parse(opts.proxy);

                protocol = parsedProxyUrl.protocol;
                host = parsedProxyUrl.hostname;
                port = parsedProxyUrl.port;
                path = opts.url;

                headers['Host'] = parsedTargetUrl.host; // host also includes port
            }

            const request = client.request({
                method: opts.method,
                // url is used by electron net module
                url: opts.url,
                // 4 fields below are used by http and https node modules
                protocol,
                host,
                port,
                path,
                timeout: opts.timeout,
                headers
            });

            request.on('error', err => reject(generateError(opts, err)));

            request.on('response', response => {
                if (![200, 201, 204].includes(response.statusCode)) {
                    reject(generateError(opts, response.statusCode + ' ' + response.statusMessage));
                }

                if (opts.cookieJar && response.headers['set-cookie']) {
                    opts.cookieJar.header = response.headers['set-cookie'];
                }

                let responseStr = '';

                response.on('data', chunk => responseStr += chunk);

                response.on('end', () => {
                    try {
                        const jsonObj = responseStr.trim() ? JSON.parse(responseStr) : null;

                        resolve(jsonObj);
                    }
                    catch (e) {
                        log.error("Failed to deserialize sync response: " + responseStr);

                        reject(generateError(opts, e.message));
                    }
                });
            });

            request.end(opts.body ? JSON.stringify(opts.body) : undefined);
        }
        catch (e) {
            reject(generateError(opts, e.message));
        }
    })
}

function getClient(opts) {
    // it's not clear how to explicitly configure proxy (as opposed to system proxy)
    // so in that case we always use node's modules
    if (utils.isElectron() && !opts.proxy) {
        return require('electron').net;
    }
    else {
        // in case there's explicit proxy then we need to use protocol of the proxy since we're actually
        // connecting to the proxy server and not to the end-target server
        const {protocol} = url.parse(opts.proxy || opts.url);

        if (protocol === 'http:' || protocol === 'https:') {
            return require(protocol.substr(0, protocol.length - 1));
        }
        else {
            throw new Error(`Unrecognized protocol "${protocol}"`);
        }
    }
}

function generateError(opts, message) {
    return new Error(`Request to ${opts.method} ${opts.url} failed, error: ${message}`);
}

module.exports = {
    exec
};