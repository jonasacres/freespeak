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

define(["lib/shared"], function(Shared) {
  function Console() {
  }

  Console.commands = {};

  Console.addCommand = function(command, description, help, handler) {
    if(handler == null) {
      handler = help;
      help = null;
    }

    Console.commands[command] = { "command":command, "description":description, "help":help, "handler":handler };
  }

  Console.out = function(message) {
    var active = Shared.sessionManager.activeSession;
    if(active) active.addMessage("system", message, {"notify":false});
  }

  Console.processLine = function(line) {
    if(line.substring(0, 1) == "/") {
      Console.processSlashCommand(line);
      return;
    }

    Console.processMessage(line);
  }

  Console.processMessage = function(msg) {
    if(Shared.sessionManager.activeSession.connected) {
      Shared.client.sendMsg(Shared.sessionManager.activeSession.peerId, msg);
    } else if(Shared.sessionManager.activeSession.peerId == "system") {
      Shared.sessionManager.activeSession.addMessage("system", "You cannot talk in this window.");
    } else {
      Shared.sessionManager.activeSession.addMessage("system", "You are not connected.");
    }
  }

  Console.processSlashCommand = function(line) {
    var args = line.split(/\s+/),
        command = Console.commands[args[0]];

    if(!command) {
      Console.out("Unrecognized command: " + command);
      return;
    }

    return command.handler(line, args);
  }

    // * /open <peerid> -- open a window with a peer
    // * /connect -- reconnect with the server
    // * /disconnect -- disconnect form the server
    // * /alias <name> -- set peer alias

  Console.addCommand("/alias", "Set display name for current window", "Assigns a display name to the user in the current window. This name is not sent over the network, and is visible only to you.", function(line, args) {
    if(args.length != 2) {
      Console.out("Usage: /alias display_name");
      return;
    }

    var active = Shared.sessionManager.activeSession;
    if(!active) return;

    active.setDisplayName(args[1]);
  });

  Console.addCommand("/close", "Close current chat window", function(line, args) {
    var active = Shared.sessionManager.activeSession;
    if(!active) return;

    if(active.peerId == "system") {
      Console.out("You cannot close this window.");
      return;
    }

    Shared.sessionManager.closeSession(active.peerId);
  });

  Console.addCommand("/clear", "Clear message history from current chat window", function(line, args) {
    var active = Shared.sessionManager.activeSession;
    if(!active) return;
    active.clear();
  });

  Console.addCommand("/clearall", "Clear message history from all chat windows", function(line, args) {
    Shared.sessionManager.allSessions().forEach(function(session) {
      session.clear();
    });
  });

  Console.addCommand("/say", "Say a message in the current window", "Says the literal value of a message in the current window. For instance, `/say /clear` will cause you to say `/clear` instead of clearing your current window.", function(line, args) {
    Console.processMessage(line.substring(args[0].length+1));
  });

  return Console;
});
