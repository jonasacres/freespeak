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

//
// Session management
//

define(["lib/util"], function(Util) {
  function ChatSession(peerId, callback) {
    this.peerId = this.displayName = peerId;
    this.messages = [];
    this.callback = callback;
    this.connected = false;
  }

  ChatSession.prototype.addMessage = function(sender, text, options) {
    options = options || {}
    if(options.notify === undefined) options.notify = true

    var message = { "timestamp":(options.timestamp || Util.currentTime()), "sender":sender, "text":text, "notify":options.notify };
    this.messages.push(message);
    this.callback({"name":"addMessage", "message":message});
  }

  ChatSession.prototype.clear = function() {
    this.messages = [];
    this.callback({"name":"clearMessages"});
    this.setUnread(false);
  }

  ChatSession.prototype.setDisplayName = function(displayName) {
    var oldName = this.displayName;
    this.displayName = displayName;
    this.callback({"name":"changeDisplayName", "displayName":displayName, "oldDisplayName":oldName});
  }

  ChatSession.prototype.setUnread = function(unread) {
    if(this.unread == unread) return;
    this.unread = unread;
    this.callback({"name":"updateUnread", "unread":unread});
  }

  return ChatSession;
});
