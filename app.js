// Freespeak, a zero-knowledge ephemeral chat server
// Copyright (C) 2016 Jonas Acres

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

var crypto = require('crypto');
var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
// var cookieParser = require('cookie-parser');
// var bodyParser = require('body-parser');
var SocketServer = require('ws').Server;
var socketIdMap = {};

var app = express();

var routes = require('./routes/index');
// var ws = require('./routes/ws');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: false }));
// app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
// app.use('/ws', ws);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

app.setupWebSocket = function(server) {
  app.wss = new SocketServer({ server });

  app.wss.on('connection', (ws) => {
    var state = {};
    var handlers = {};

    function reject(message) {
      throw message;
    }

    // register a key
    //   arguments:
    //     1: public key, encoded in base64
    //     2: public nonce used for handshaking
    handlers.key = function(args) {
      var key = args[1], nonce = args[2];

      if(typeof(key) != "string") reject("Must specify key object");
      // TODO: check key is base64 and valid

      var hash = crypto.createHash('sha256').update(key).digest('hex'),
            id = hash.substring(hash.length-8, hash.length);
      socketIdMap[id] = { "socket":ws, "key":key, "id":id, "nonce":nonce, "peers":{} };
      ws.id = id;

      var motd = "Use Tor or a proxy server for privacy.";

      ws.send(JSON.stringify(["key", id, motd]));
    };

    // get a key for a given id
    //   arguments:
    //     1: key id
    handlers.getkey = function(args) {
      var id = args[1];

      if(!id) reject("Missing key ID");
      if(typeof id != "string") reject("Must specify string key ID");

      var info = socketIdMap[id];
      if(!info) {
        ws.send(JSON.stringify(["getkey", id, null, null]));
        return;
      }

      ws.send(JSON.stringify(["getkey", id, info.key, info.nonce]));
    };

    // relay a handshake request to a peer
    //   arguments:
    //     1: key id of remote peer
    //     2: base64-encoded 256-bit random nonce, encrypted with shared secret presumed from both keys
    //     3: sha256 of nonce 
    handlers.offer = function(args) {
      if(!ws.id) reject("You must register a public key to do that");
      var id = args[1], encryptedNonce = args[2], hash = args[3];

      // TODO: validate id, payload, hash

      var peer = socketIdMap[id];
      if(!peer) reject("No such peer");

      // TODO: gracefully handle case where we send a duplicate offer

      peer.socket.send(JSON.stringify(["offer", ws.id, socketIdMap[ws.id].key, socketIdMap[ws.id].nonce, encryptedNonce, hash]));
    };

    // accept a handshake from a peer
    //   arguments:
    //     1: key id of remote peer
    //     2: base64-encoded hash, encrypted with random symmetric key from offer, used to prove knowledge of session key to remote peer
    handlers.accept = function(args) {
      if(!ws.id) reject("You must register a public key to do that");
      var id = args[1], encryptedHash = args[2];

      // TODO: validate encryptedHash

      var peer = socketIdMap[id], client = socketIdMap[ws.id];
      if(!peer) reject("No such peer");

      // TODO: gracefully handle case where we send a duplicate accept

      peer.peers[ws.id] = client;
      client.peers[id] = peer;

      peer.socket.send(JSON.stringify(["accept", ws.id, encryptedHash]));
    };

    // send a message to a peer
    //   arguments:
    //     1: a key in socketIdMap identifying remote peer we are sending this message to
    //     2: base64( encrypt(symkey, plaintext) )
    handlers.msg = function(args) {
      var id = args[1], ciphertext = args[2], client = socketIdMap[ws.id], peer = socketIdMap[id];

      if(!client) reject("You must register a public key to do that");
      if(!client.peers[id]) reject("You are not connected to that peer");
      if(typeof ciphertext != "string") reject("Message must be a string.");
      if(!peer) reject("Peer has disconnected.");

      peer.socket.send(JSON.stringify(["msg", client.id, ciphertext]));
    };

    // process a heartbeat request
    handlers.heartbeat = function() {
      ws.send(JSON.stringify(["heartbeat"]));
    }

    function processWrapper(msg) {
      if(msg.length > 1024) reject("Request is too long");
      try {
        args = JSON.parse(msg);
        if(!(args instanceof Array)) reject("Request must be an array");
        if(args.length < 1) reject("Request must contain message type");
        if(typeof args[0] != "string") reject("First argument must be method");
        if(handlers[args[0]] == null) reject("Unsupported method");
        handlers[args[0]](args);
      } catch(exc) {
        if(exc instanceof SyntaxError) {
          reject("Request is not valid JSON");
        } else {
          throw exc;
        }
      }
    }

    ws.on("message", function(msg) {
      try {
        processWrapper(msg);
      } catch(exc) {
        console.log(exc);
        ws.send(JSON.stringify(["error", exc]));
      }
    });

    ws.on("close", function() {
      var info = socketIdMap[ws.id];
      if(info) {
        Object.keys(info.peers).forEach(function(id) {
          if(!socketIdMap[id]) return;
          info.peers[id].socket.send(JSON.stringify(["disconnect", ws.id]));
        });
      }

      delete socketIdMap[ws.id];
    });
  });
}

module.exports = app;
