#!/bin/sh

tar -czf public/freespeak.tgz `git ls-files | xargs`
browserify dist-src/freespeak.js > public/javascripts/freespeak.js
