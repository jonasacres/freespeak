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

define(["lib/shared", "lib/crypto"], function(Shared, Crypto) {
  function DecoyTrafficGenerator(client) {
    var self = this;

    this.client = client;
    this.replyProb = 0.7;
    this.continuationProb = 0.1;

    this.rngDefs = {};

    this.setRNG("reply", this.binomialRNG(0.9));
    this.setRNG("replyDelay", this.uniformRNG(1*1000, 120*1000));
    this.setRNG("replyLength", this.uniformRNG(1, 128));
    
    this.setRNG("spontaneousDelay", this.uniformRNG(1*60*1000, 10*60*1000));
    this.setRNG("spontaneousLength", this.uniformRNG(30, 128));
    
    this.setRNG("continuation", this.binomialRNG(0.1));
    this.setRNG("continuationDelay", this.uniformRNG(1*60*1000, 10*60*1000));
    this.setRNG("continuationLength", this.uniformRNG(1, 128));

    this.msgTimestamps = {};

    client.on("established", function(event) { self.sendDecoy(event.data.id, "spontaneous") });
    client.on("sendMsg.text", function(event) { self.setupMessage(event.data.id, "continuation") });
    client.on("msg", function(event) { self.setupMessage(event.data.id, "reply") });
    
    client.on("disconnect", function(event) { self.updateTimer(event.data.id) });
    client.on("cryptofail", function(event) { self.updateTimer(event.data.id) });
  };

  DecoyTrafficGenerator.prototype.uniformRNG = function(min, max) {
    return function() { return Crypto.randInt(max-min)+min; }
  }

  DecoyTrafficGenerator.prototype.binomialRNG = function(p) {
    return function() { return Crypto.randFloat() < p; }
  }

  DecoyTrafficGenerator.prototype.updateTimer = function(peerId) {
    this.msgTimestamps[event.data.id] = new Date().getTime();
  }

  DecoyTrafficGenerator.prototype.setRNG = function(key, rngFunc) {
    this.rngDefs[key] = rngFunc;
  }

  DecoyTrafficGenerator.prototype.rng = function(key) {
    if(!this.rngDefs[key]) {
      throw "Missing RNG key: " + key;
    }

    return this.rngDefs[key]();
  }

  DecoyTrafficGenerator.prototype.uniformRandomVariable = function(min, max) {
    return Crypto.randInt(max-min) + min;
  }

  DecoyTrafficGenerator.prototype.setupMessage = function(peerId, cause) {
    var self = this,
        checkTimestamp = this.msgTimestamps[peerId] = new Date().getTime();

    var actualCause = (!this.rngDefs[cause] || this.rng(cause)) ? cause : "spontaneous";
    setTimeout(function() {
      self.sendDecoy(peerId, actualCause, checkTimestamp);
    }, self.rng(actualCause + "Delay"));
  }
  
  DecoyTrafficGenerator.prototype.sendDecoy = function(peerId, cause, checkTimestamp) {
    if(this.msgTimestamps[peerId] && checkTimestamp && this.msgTimestamps[peerId] != checkTimestamp) return;
    this.client.sendMsgDecoy(peerId, this.rng(cause + "Length"));
  }

  return DecoyTrafficGenerator;
});
