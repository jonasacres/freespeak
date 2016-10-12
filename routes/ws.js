var express = require('express');
var router = express.Router();

router.ws('/ws', function(ws, req) {
  var state = {};
  var handlers = {};

  function reject(message) {
    throw message;
  }

  // register a key
  //   arguments:
  //     1: public key, encoded in base64
  handlers.key = function(args) {
    var key = args[1];

    if(typeof(key) != "string") reject("Must specify key object");
    // TODO: check key is base64
    if(!is_valid_key(key)) reject("Invalid public key");

    var id = register_key(args)
    socketIdMap[id] = { "socket":ws, "key":key, "id":id };
    ws.id = id;

    var motd = "Use Tor or a proxy server for privacy.";

    ws.send(["key", id, motd]);
  };

  // get a key for a given id
  //   arguments:
  //     1: key id
  handlers.getkey = function(args) {
    var id = args[1];

    if(!id) reject("Missing key ID");
    if(typeof id != "string") reject("Must specify string key ID");

    var key = socketIdMap[data] == null ? null : socketIdMap[data]["key"];
    ws.send(["getkey", id, key]);
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
    if(!peer || peer.peer) reject("No such peer, or peer ID has already been used");

    peer.socket.send(["offer", ws.id, socketIdMap[ws.id].key, encryptedNonce, hash]);
  };

  // accept a handshake from a peer
  //   arguments:
  //     1: key id of remote peer
  //     2: base64-encoded hash, encrypted with random symmetric key from offer, used to prove knowledge of session key to remote peer
  handlers.accept = function(args) {
    if(!ws.id) reject("You must register a public key to do that");
    var id = args[1], encryptedHash = args[2];

    // TODO: validate encryptedHash

    var peer = socketIdMap[id];
    if(!peer || peer.peer) reject("No such peer, or peer ID has already been used");

    peer.socket.send(["accept", ws.id, encryptedHash]);
  };

  // send a message to a peer
  //   arguments:
  //     1: a key in socketIdMap identifying remote peer we are sending this message to
  //     2: base64( encrypt(symkey, plaintext) )
  handlers.msg = function(args) {
    var id = args[1], ciphertext = args[2];

    if(!ws.id) reject("You must register a public key to do that");
    if(ws.peer != id) reject("You are not connected to that peer.");
    if(typeof ciphertext != "string") reject("Message must be a string.");
    if(!socketIdMap[data["id"]]) reject("Peer has disconnected.");

    socketIdMap[id].socket.send(["msg", ws.id, ciphertext]);
  };

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
      ws.send(["error", exc]);
    }
  });

  ws.on("close", function() {
    if(ws.peer && socketIdMap[ws.peer]) {
      socketIdMap[ws.peer].socket.send(["disconnect", ws.id]);
    }

    delete socketIdMap[ws.id];
  });
});


module.exports = router;
