'use strict';

/**
 * webpack middleware for koa
 * Copyright(c) 2015 KIT Mobile Internet Pty Ltd, Australia
 * MIT Licensed
 */

const _ = require('underscore');
const path = require('path');
const mime = require('mime');
const webpack = require('webpack');
const URL = require('url-parse');
const MemoryFileSystem = require('memory-fs');

/**
 * Expose webpack middleware
 *   opt.config
 */

module.exports = function (opt) {
    //override default options
    opt = Object.assign({
        config: './webpack.config.js',
        watchOptions: {
            aggregateTimeout: 300
        },
        log: {
            level: 'info'
        },
        stats: {
            colors: true
        },
        defaultPage: 'index.html'
    }, opt);

    const LEVELS = { emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7 };

    let expectedLevel = LEVELS[opt.log.level];
    let logger = opt.log.logger || ({
            log: function (level, message, meta) {
                let v = LEVELS[level];
                if (v <= expectedLevel) {
                    console.log('[' + level + ']' + message + (meta ? ' Related: ' + JSON.stringify(meta) : ''));
                }
            }
        });

    let webpackConfig = _.isString(opt.config) ? require(opt.config) : opt.config;
    let compiler = webpack(webpackConfig);

    webpackConfig = compiler.options;

    let compiling = true;
    function watchDone(err, stats) {
        compiling = false;
        if (err) {
            logger.log('error', err.message || err, err.message && err);
            throw err;
        }

        if (stats.errors && stats.errors.length > 0) {
            logger.log('error', 'Error occurred during compiling.', stats.errors);
            throw new Error();
        }

        if (stats.warnings && stats.warnings.length > 0) {
            logger.log('warning', 'Warnings recorded during compiling.', stats.warnings);
        } else {
            logger.log('info', 'Rebuild completed.');
            logger.log('verbose', stats.toString(opt.stats));
        }
    }

    function invalid() {
        compiling = true;
        logger.log('info', 'Assets are now invalid.');
    }

    function compile() {
        compiling = true;
        logger.log('info', 'Compiling assets...');
    }

    // Thunk generator for compiling
    function waitTillDone() {
        return function done(cb) {
            compiler.run(cb);
        }
    }

    // Create memory files system
    let mfs = new MemoryFileSystem();
    // Attach memory fs to compiler
    compiler.outputFileSystem = mfs;

    compiler.plugin('invalid', invalid);
    compiler.plugin('compile', compile);
    compiler.watch(opt.watchOptions, watchDone);

    return function* (next) {
        if (this.method !== 'GET') return yield next;

        let url = new URL(this.url);
        let requestFile = path.join(webpackConfig.output.path, url.pathname);

        // If compiling, wait until finish
        if (compiling) {
            yield waitTillDone();
        }

        try {
            let stat = mfs.statSync(requestFile);
            if (!stat.isFile()) {
                if (stat.isDirectory()) {
                    requestFile = path.join(requestFile, opt.defaultPage);
                    stat = mfs.statSync(requestFile);
                    if (!stat.isFile()) return yield next;
                } else {
                    return yield next;
                }
            }
        } catch (e) {
            return yield next;
        }

        // Serve content
        let content = mfs.readFileSync(requestFile);
        this.set("Access-Control-Allow-Origin", "*"); // To support XHR, etc.

        this.set("Content-Type", mime.lookup(requestFile));
        this.set("Content-Length", content.length);

        this.body = content;
    };
};