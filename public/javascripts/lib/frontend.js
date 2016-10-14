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

define(["lib/util", "lib/shared"], function(Util, Shared) {
  function Frontend() {}

  Frontend.urlBase = function(url) {
    var match = /^((ws|wss|http|https):\/\/[^\/]+)\//.exec(url);
    if(!match) throw "Unable to parse URL: " + url;
    return match[1];
  }

  Frontend.urlPrefix = function() {
    return Frontend.urlBase(window.location.href);
  }

  Frontend.webSocketUrl = function() {
    return Frontend.urlBase(window.location.href.replace(/^http/, "ws")) + "/ws";
  }

  Frontend.clearMessages = function() {
    var table = document.getElementById("terminal").firstChild;
    table.innerHTML = "";
  }

  Frontend.terminalAtBottom = function() {
    return terminal.scrollTop >= terminal.scrollHeight - terminal.clientHeight;
  }

  Frontend.snapTerminalToBottom = function() {
    if(Shared.sessionManager.activeSession) Shared.sessionManager.activeSession.unread = false;
    terminal.scrollTop = terminal.scrollHeight - terminal.clientHeight;
    Frontend.setTitle();
  }

  Frontend.setTitle = function() {
    if(Shared.sessionManager.hasUnread()) {
      document.title = "<!> Freespeak";
    } else {
      document.title = "Freespeak";
    }
  }


  Frontend.printMessage = function(sender, messages, timestamp) {
    if(!(messages instanceof Array)) messages = [ messages ];

    var atBottom = Frontend.terminalAtBottom(),
        table = document.getElementById("terminal").firstChild,
        row = table.insertRow(-1),
        timestampCell = row.insertCell(0),
        nickCell = row.insertCell(1),
        messageCell = row.insertCell(2);

    row.className = ["you", "system"].indexOf(sender) == -1 ? "them" : sender;
    timestampCell.className = "timestamp";
    nickCell.className = "nick";
    messageCell.className = "message";
    
    timestampCell.innerHTML = timestamp;
    nickCell.innerHTML = sender;

    var html = "<ul>"
    messages.forEach(function(message) {
      html += "<li"
      if(!(message instanceof Array)) message = [ null, message ];
      if(message[0]) html += ' class="'+message[0]+'"';
      html += ">" + Util.escapeHtml(message[1]) + "</li>";
    });
    html += "</ul>"

    messageCell.innerHTML = html;
    if(atBottom) Frontend.snapTerminalToBottom();
  }

  Frontend.addSessionTab = function(session) {
    var list = document.getElementById("sidebar").firstChild;
    var entry = document.createElement('li');
    if(session.peerId == "system") entry.className = "system";
    entry.appendChild(document.createTextNode(session.peerId));
    
    entry.onclick = function() {
      Shared.sessionManager.activateSession(session.peerId);
    }

    list.appendChild(entry);
  }

  Frontend.markSessionTab = function(session, className) {
    var list = document.getElementById("sidebar").firstChild;

    for(var child = list.firstChild; child !== null; child = child.nextSibling) {
      if(child.innerHTML == session.peerId) {
        child.className = className;
        return;
      }
    }
  }

  Frontend.fixElementSizes = function() {
    var terminal = document.getElementById("terminal");
    var sidebar = document.getElementById("sidebar");
    var typebox = document.getElementById("typebox");

    var height = "" + (typebox.getBoundingClientRect().top + window.scrollY) + "px";
    var termWidth = "" + (window.innerWidth - sidebar.getBoundingClientRect().right + window.scrollX) + "px";

    terminal.style.height = height;
    terminal.style.width = termWidth;
    sidebar.style.height = height;

    terminal.onscroll = function() {
      if(Shared.sessionManager.activeSession && Frontend.terminalAtBottom()) {
        Shared.sessionManager.activeSession.unread = false;
        Frontend.markSessionTab(Shared.sessionManager.activeSession, "active");
      }
    }

    Frontend.setTitle();
  }

  Frontend.setupNotifications = function() {
    if(Notification.permission == 'default') {
      Notification.requestPermission().then(function(result) {
        if(Notification.permission == 'granted') showNotifications = true  
      });
    } else {
      showNotifications = Notification.permission == 'granted'
    }
  }

  Frontend.setupEventListeners = function() {
    document.addEventListener('keydown', function(event) {
      if([91, 93, 224].indexOf(event.keyCode) != -1) return;
      if(event.metaKey && event.keyCode == 67) return;

      if(event.keyCode == 13) {
        var typebox = document.getElementById("typebox"),
            msg = typebox.value;

        typebox.value = '';

        if(Shared.sessionManager.activeSession.connected) {
          Shared.client.sendMsg(Shared.sessionManager.activeSession.peerId, msg);
        } else if(Shared.sessionManager.activeSession.peerId == "system") {
          Shared.sessionManager.activeSession.addMessage("system", "You cannot talk in this window.");
        } else {
          Shared.sessionManager.activeSession.addMessage("system", "You are not connected.");
        }
      }

      document.getElementById('typebox').focus();
    });

    document.addEventListener('keyup', function(event) {
      if(event.keyCode == 13) {
        document.getElementById('typebox').value = '';
      }
    });

    window.onresize = function() {
      var snap = Frontend.terminalAtBottom();
      Frontend.fixElementSizes();
      if(snap) Frontend.snapTerminalToBottom();
    }

    document.addEventListener("visibilitychange", function() {
      notificationList = {};

      if(!Shared.sessionManager.activeSession || !Shared.sessionManager.activeSession.unread) return;

      if(Frontend.terminalAtBottom()) {
        Shared.sessionManager.activeSession.unread = false;
        Frontend.markSessionTab(Shared.sessionManager.activeSession, "active");
        Frontend.setTitle();
      }
    });
  }

  return Frontend;
});
