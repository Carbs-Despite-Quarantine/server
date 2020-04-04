const express = require("express");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

const db = require("./db");
const helpers = require("./helpers");

// A selection of Font Awesome icons suitable for profile pictures
const icons = ["apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish", "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw", "pepper-hot", "pizza-slice", "spider"];

/**
 * User:
 *  - id (int)
 *  - name (string)
 *  - icon (string)
 *  - roomId (int)
 *  - socket (<socket>)
 **/
var users = {}

// Returns all the icons which are not already taken
function getAvailableIcons(roomIcons) {
  var availableIcons = [];

  icons.forEach(icon => {
    // Add all the unused icons to the final list
    if (!roomIcons.includes(icon))  availableIcons.push(icon);
  });

  return availableIcons;
}

function getUser(userId, requireRoom=false) {
  if (!users.hasOwnProperty(userId)) return {error: "Invalid User"};
  if (requireRoom && !users[userId].roomId) return {error: "Not in a room"};
  return users[userId];
}

/*****************
 * Web Endpoints *
 *****************/

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/inc/*", function(req, res) {
  res.sendFile(path.join(__dirname, "public/", req.path));
});

app.get("/status", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

/*******************
 * Socket Handling *
 *******************/

function initSocket(socket, userId) {

  /*****************
   * Room Handling *
   *****************/

  socket.on("setIcon", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!icons.includes(data.icon)) return fn({error: "Invalid Icon"});

    db.setUserIcon(userId, data.icon);

    if (user.roomId) {
      db.getRoomUsers(user.roomId, response => {
        if (response.error) {
          console.warn("Failed to get users for room #" + user.roomId);
          return fn({error: "Room error"});
        }

        response.userIds.forEach(roomUserId => {
          roomUser = response.users[roomUserId];

          // Can't share an icon with another active user
          if (roomUserId != userId && users.hasOwnProperty[roomUserId] && users[roomUserId].roomId == user.roomId && roomUser.icon) {
            if (roomUser.icon == data.icon) {
              return fn({error: "Icon in use"});
            }
          }
        });

        user.icon = data.icon;
        fn({});

        // Notify users who are yet to choose an icon that the chosen icon is now unavailable
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          socketUser = users[roomUserId];

          if (roomUserId != userId && socketUser.roomId == user.roomId && !response.users[roomUserId].icon) {
            socketUser.socket.emit("iconTaken", {
              icon: data.icon
            });
          }
        });
      });
    } else {
      user.icon = data.icon;
      return fn({});
    }
  });

  socket.on("createRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    var token = helpers.makeHash(8);

    db.query(`INSERT INTO rooms (token) VALUES (?);`, [
      token
    ], (err, result) => {
      if (err) {
        console.warn("Failed to create room:", err);
        return fn({error: "MySQL Error"});
      }

      var roomId = result.insertId;
      db.addUserToRoom(userId, roomId);

      // Create the room
      var room = {
        id: roomId,
        token: token,
        users: [userId],
        messages: {}
      };

      // Update the users detaiils
      user.name = helpers.stripHTML(data.userName);
      user.roomId = roomId;

      db.setUserName(userId, user.name);

      // Get a list of editions to give the client
      db.query(`SELECT id, name FROM versions WHERE type = 'base';`, (err, results) => {
        if (err) {
          console.warn("Failed to retrieve edition list when creating room:", err);
          return fn({error: "MySQL Error"});
        }

        var editions = {};
        results.forEach(result => editions[result.id] = result.name);

        // Wait for the join message to be created before sending a response
        db.createMessage(userId, "created the room", true, message => {
          if (message.error) console.warn("Failed to create join message:", message.error);
          else room.messages[message.id] = message;

          console.log("Created room #" + roomId + " for user #" + userId);
          fn({
            room: room,
            editions: editions
          });
        });
      });
    });
  });

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);
    db.getRoomWithToken(data.roomId, data.token, room => {
      if (room.error) return fn(room);

      // Do this before getting messages since it doubles as a check for room validity
      db.getRoomUsers(room.id, response => {
        if (response.error) {
          console.warn("Failed to get user ids when joining room #" + room.id);
          return fn(response);
        } if (response.userIds == 0) {
          return fn({error: "Can't join empty or invalid room"});
        }

        // Cache the user lists so wse can reuse the response variable
        var roomUsers = response.users;
        var roomUserIds = response.userIds;

        // Add the client to the user list
        roomUsers[userId] = {
          id: userId,
          icon: user.icon,
          name: user.name,
          roomId: room.id
        };
        roomUserIds.push(userId);

        db.getRoomMessages(room.id, 15, response => {
          if (response.error) {
            console.warn("failed to get latest messages from room #" + room.id + ": " + response.error);
            room.messages = {};
          } else {
            room.messages = response.messages;
          }

          // Add the user to the room
          user.roomId = room.id;
          db.addUserToRoom(userId, room.id);

          // Make aa list of the icons currently in use
          var roomIcons = [];

          roomUserIds.forEach(roomUserId => {
            var roomUser = roomUsers[roomUserId];
            // If the user is active, add their icon to the list
            if (roomUserId != userId && users.hasOwnProperty(roomUserId) && users[roomUserId].roomId == data.roomId && roomUser.icon) {
              roomIcons.push(roomUser.icon)    
              // I'm not sure if we still need this on the client but it dosen't hurt
              roomUsers[roomUserId].roomId = room.id;
            }
          });

          fn({
            room: room,
            users: roomUsers,
            iconChoices: getAvailableIcons(roomIcons)
          });
        });
      });
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    db.getRoomUsers(data.roomId, response => {
      if (response.error) {
        console.warn("Failed to get user list for room #" + data.roomId);
        return fn({error: "Unexpected error"});
      } else if (response.userIds.length == 0) {
        return fn({error: "Invalid Room"});
      } else if (!response.userIds.includes(userId)) {
        return fn({error: "Can't enter room that hasn't been joined"});
      }

      user.name = helpers.stripHTML(data.userName);
      db.setUserName(userId, user.name);

      db.createMessage(userId, "joined the room", true, message => {
        fn({message: message});

        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          // Send the new users info to all other active room users
          if (roomUserId != userId && socketUser.roomId == data.roomId) {
            socketUser.socket.emit("userJoined", {
              user: {
                id: userId,
                name: user.name,
                icon: user.icon,
                roomId: user.roomId
              },
              message: message
            });
          }
        });
      });
    });
  });

  socket.on("userLeft", (data) => {
    var user = getUser(userId, true);
    if (user.error) return;

    var activeUsers = 0;

    db.getRoomUsers(user.roomId, response => {
      if (response.error) return console.warn("Failed to get user list when leaving room #" + user.roomId);
      else if (response.userIds.length == 0) {
        user.roomId = null;
        return;
      };

      // If the user never entered the room, don't inform users of leave
      if (!response.users[userId].name) {
        // We have to do this twice to prevent users who haven't entered leaving the room open indefinitely
        response.userIds.forEach(roomUserId => {
          if (roomUserId != userId && users.hasOwnProperty(roomUserId) && users[roomUserId].roomId == user.roomId) activeUsers++;
        });

        if (activeUsers == 0) db.deleteRoom(user.roomId);

        // If we aren't returning here, we still need the roomId for createMessage()
        user.roomId = null;
        return;
      }

      db.createMessage(userId, "left the room", true, message => {
          response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          // Notify active users that the user left
          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            activeUsers++;
            socketUser.socket.emit("userLeft", {
              userId: userId,
              message: message
            });
          }
        });

        // Delete the room once all users have left
        if (activeUsers == 0) db.deleteRoom(user.roomId);
        user.roomId = null;
      });
    });
  });

  // TODO: expansions!
  socket.on("roomSettings", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    // Validate the edition
    db.query(`SELECT id FROM versions WHERE id = ? AND type = 'base';`, [
      data.edition
    ], (err, result, fields) => {
      if (err) {
        console.warn("Failed to get edition '" + data.edition + "' from versions table:", err);
        return fn({error: "MySQL Error"});
      } else if (result.length == 0) return fn({error: "Invalid Edition"});

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        else if (room.edition) return fn({error: "Room is already setup!"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when configuring room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length == 0) return fn({error: "Invalid Room"});

          var rotateCzar = data.rotateCzar == true;

          db.query(`UPDATE rooms SET edition = ?, rotate_czar = ? WHERE id = ?;`, [
            data.edition,
            rotateCzar,
            user.roomId
          ], (err, result) => {
            if (err) {
              console.warn("Failed to apply room settings:", err);
              return fn({error: "MySQL Error"});
            }

            fn({});

            response.userIds.forEach(userId => {
              if (!users.hasOwnProperty(userId)) return;
              users[userId].socket.emit("roomSettings", {
                edition: data.edition,
                rotateCzar: rotateCzar
              });
            });
          });
        });
      });
    });
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);
    if (!helpers.validateString(data.content)) return fn({error: "Invalid Message"});

    db.createMessage(userId, data.content, false, message => {
      fn({message: message});

      db.getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get users for room #" + user.roomId);
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          // Send the message to other active users
          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            socketUser.socket.emit("chatMessage", {message: message});
          }
        });
      });
    });
  });

  socket.on("likeMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    // We need to check that the user is actually in the room 
    // where the message was sent and, that it isn't a system message
    var sql = `
      SELECT system_msg 
      FROM messages 
      WHERE id = ? AND room_id = ?;
    `;
    db.query(sql, [
      data.msgId,
      user.roomId
    ],(err, msgInfo, fields) => {
      if (err) {
        console.warn("Failed to get msg #" + data.msgId + ":", err);
        return fn({error: "MySQL Error"});
      } else if (msgInfo.length == 0) {
        return fn({error: "Invalid Message ID"});
      } else if (msgInfo[0].system_msg == 1) {
        return fn({error: "Can't like a system message"});
      }

      // Now we can actually add the like
      db.query(`INSERT INTO message_likes (message_id, user_id) VALUES (?, ?);`, [
        data.msgId,
        userId
      ], (err, insertResult) => {
        if (err) {
          console.warn("Failed to add like:", err);
          return fn({error: "MySQL Error"});
        }
        fn({});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) return console.warn("Failed to get user ids for room #" + user.roomId);
          response.userIds.forEach(roomUserId => {
            if (!users.hasOwnProperty(roomUserId)) return;
            var socketUser = users[roomUserId];

            // Send the like information to other active users
            if (roomUserId != userId && socketUser.roomId == user.roomId) {
              socketUser.socket.emit("likeMessage", {msgId: data.msgId, userId: userId});
            }
          });
        });
      });
    });
  });

  socket.on("unlikeMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    db.query(`DELETE FROM message_likes WHERE message_id = ? AND user_id = ?;`, [
      data.msgId,
      userId
    ], (err, result) => {
      if (err) {
        console.warn("Failed to remove like:", err);
        return fn({error: "MySQL Error"});
      } else if (result.affectedRows == 0) {
        return fn({error: "Can't unlike a message that hasn't been liked!"})
      }
      fn({});

      // Inform other active users that the like was removed
      db.getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get users for room #" + user.roomId);
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            socketUser.socket.emit("unlikeMessage", {msgId: data.msgId, userId: userId});
          }
        });
      });
    });
  });
}

io.on("connection", (socket) => {

  // Add user to the database
  db.query(`INSERT INTO users VALUES ();`, (err, result) => {
    if (err) {
      console.warn("Failed to create user:", err);
      return;
    }

    var userId = result.insertId;

     // Save the users details
    users[userId] = {
      id: userId,
      name: null,
      icon: null,
      roomId: null,
      socket: socket
    };

    // Send the generated userId
    socket.emit("init", {
      userId: userId,
      icons: icons
    });

    // Only register socket callbacks now that we have a userId
    initSocket(socket, userId);
  });
});

/**************
 * Web Server *
 **************/

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});
