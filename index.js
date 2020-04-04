const express = require("express");
const mysql = require("mysql");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

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

/*******************
 * Data Validation *
 *******************/

function validateHash(hash, length) {
  return typeof hash === "string" && hash.length === length;
}

function validateUInt(uint) {
  return typeof uint === "number" && uint % 1 === 0 && uint >= 0;
}

function validateBoolean(boolean) {
  return typeof boolean === "boolean";
}

function validateString(string) {
  return typeof string === "string" && string.length > 0;
}

/***********************
 * Database Connection *
 ***********************/

var db = mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "cah-online",
  password: process.env.MYSQL_PASS || "password",
  database: process.env.MYSQL_DB || "cah-online"
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to the MySQL Database!");
  getBlackCard("AU");
});

function getBlackCard(edition) {
  var sql = `
    SELECT text, draw, pick
    FROM black_cards
    WHERE id IN (
      SELECT card_id 
      FROM black_cards_link 
      WHERE edition='${edition}'
    )
    ORDER BY RAND();
  `;
  db.query(sql, (err, result, fields) => {
    if (err) return console.warn("Failed to get black card:", err);
    console.debug("Got " + result.length + " results..");
    console.debug("Got black card: " + result[0].text + ` (draw ${result[0].draw} pick ${result[0].pick})}`)
  });
}

function setUserIcon(userId, icon) {
  db.query(`UPDATE users SET icon = ? WHERE id = ?;`, [
    icon,
    userId
  ],(err, result) => {
    if (err) return console.warn("Failed to set icon for user #" + userId + ":", err);
    console.debug("Set icon for user #" + userId + " to '" + icon + "'");
  });
}

function setUserName(userId, name) {
  db.query(`UPDATE users SET name = ? WHERE id = ?;`, [
    name,
    userId
  ],(err, result) => {
    if (err) return console.warn("Failed to set name for user #" + userId + ":", err);
    console.debug("Set name for user #" + userId + " to '" + name + "'");
  });
}

function addUserToRoom(userId, roomId) {
  db.query(`INSERT INTO room_users (user_id, room_id) VALUES (?, ?);`, [
    userId,
    roomId
  ], (err, result) => {
    if (err) return console.warn("Failed to add user #" + userId + " to room #" + roomId + ":", err);
    console.debug("Added user #" + userId + " to room #" + roomId);
  });
}

function getRoomUsers(roomId, fn) {
  var sql = `
    SELECT id, name, icon
    FROM users 
    WHERE id IN (
      SELECT user_id
      FROM room_users
      WHERE room_id = ?
    );
  `;
  db.query(sql, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get users for room #" + roomId + ":", err);
      return fn({error: err});
    }

    var roomUsers = {};
    var roomUserIds = [];

    // Convert arrays to objects (TODO: efficiency?)
    results.forEach(row => {
      roomUserIds.push(row.id);
      roomUsers[row.id] = {
        id: row.id,
        name: row.name,
        icon: row.icon
      };
    });
    fn({users: roomUsers, userIds: roomUserIds});
  });
}

function getRoomWithToken(roomId, token, fn) {
  if (!roomId) return fn({error: "Room ID is required"});
  else if (!validateHash(token, 8)) return fn({error: "Token is required"});
  var sql = `
    SELECT token, edition, rotate_czar as rotateCzar
    FROM rooms
    WHERE id = ?;
  `;
  db.query(sql, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get room #" + roomId + ":", err);
      return fn({error: err});
    } else if (results.length == 0) {
      return fn({error: "Invalid Room ID"});
    } else if (results[0].token != token) {
      return fn({error: "Invalid Token"});
    }
    fn({
      id: roomId,
      token: token,
      edition: results[0].edition,
      rotateCzar: results[0].rotateCzar
    });
  });
}

function getRoomMessages(roomId, limit, fn) {
  var sql = `
    SELECT 
      msg.id, 
      msg.user_id AS userId, 
      msg.content, 
      msg.system_msg AS isSystemMsg, 
      GROUP_CONCAT(likes.user_id SEPARATOR ',') AS likes
    FROM messages msg
    LEFT JOIN message_likes likes ON msg.id = likes.message_id
    WHERE room_id = ?
    GROUP BY msg.id
    ORDER BY msg.id DESC
    LIMIT ?;`;
  db.query(sql, [
    roomId,
    limit
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get messages for room #" + roomId + ":", err);
      return fn({error: err});
    }
    var roomMessages = {};

    results.forEach(row => {
      roomMessages[row.id] = {
        id: row.id,
        userId: row.userId,
        content: row.content,
        isSystemMsg: row.isSystemMsg,
        likes: row.likes ? row.likes.split(",") : []
      }
    });
    fn({messages: roomMessages});
  });  
}

function createMessage(userId, content, isSystemMsg, fn) {
  var user = getUser(userId);
  if (user.error) return fn(user);
  if (!validateString(content)) return fn({error: "Invalid Message"});

  content = stripHTML(content);

  // Try to insert the message into the database
  db.query(`INSERT INTO messages (room_id, user_id, content, system_msg) VALUES (?, ?, ?, ?);`, [
    user.roomId,
    userId,
    content,
    isSystemMsg
  ], (err, result) => {
    if (err) {
      console.warn("Failed to create message:", err);
      return fn({error: err});
    }
    var msgId = result.insertId;

    // Create an object to represent the message on the client
    fn({
      id: msgId,
      userId: userId,
      content: content,
      isSystemMsg: isSystemMsg,
      likes: []
    });
  });
}

function deleteRoom(roomId) {
  db.query(`DELETE FROM rooms WHERE id = ?;`, [
    roomId
  ], (err, result) => {
    if (err) return console.warn("Failed to delete room #" + roomId + ":", err);
    console.log("Deleted room #" + roomId);
  });
}

/***************
 * Data Lookup *
 ***************/

function getUser(userId, requireRoom=false) {
  if (!users.hasOwnProperty(userId)) return {error: "Invalid User"};
  if (requireRoom && !users[userId].roomId) return {error: "Not in a room"};
  return users[userId];
}

/********************
 * Helper Functions *
 ********************/

// generate a random hash
function makeHash(length) {
  var result = "";
  var hexChars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (var i = 0; i < length; i += 1) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }
  return result;
}

// Replace </> characters with 'safe' encoded counterparts
function stripHTML(string) {
  return string.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Returns all the icons which are not already taken
function getAvailableIcons(roomIcons) {
  var availableIcons = [];

  icons.forEach(icon => {
    // Add all the unused icons to the final list
    if (!roomIcons.includes(icon))  availableIcons.push(icon);
  });

  return availableIcons;
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

    setUserIcon(userId, data.icon);

    if (user.roomId) {
      getRoomUsers(user.roomId, response => {
        if (response.error) {
          console.warn("Failed to get room users when setting icon:", response.error);
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

    if (!validateString(data.userName)) return fn({error: "Invalid Username"});

    var token = makeHash(8);

    db.query(`INSERT INTO rooms (token, edition) VALUES (?, ?);`, [
      token,
      "AU"
    ], (err, result) => {
      if (err) {
        console.warn("Failed to create room:", err);
        return fn({error: err});
      }

      var roomId = result.insertId;
      addUserToRoom(userId, roomId);

      // Create the room
      var room = {
        id: roomId,
        token: token,
        users: [userId],
        messages: {}
      };

      // Update the users detaiils
      user.name = stripHTML(data.userName);
      user.roomId = roomId;

      setUserName(userId, user.name);

      // Wait for the join message to be created before sending a response
      createMessage(userId, "created the room", true, message => {
        if (message.error) console.warn("Failed to create join message:", message.error);
        console.log("Created room #" + roomId + " for user #" + userId);

        // Add the creation message to the room and send it to the client
        room.messages[message.id] = message;
        fn({room: room});
      });
    });
  });

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);
    getRoomWithToken(data.roomId, data.token, room => {
      if (room.error) return fn(room);

      // Do this before getting messages since it doubles as a check for room validity
      getRoomUsers(room.id, response => {
        if (response.error) {
          console.warn("Failed to get user ids when joining room #" + room.id + ":", response.error);
          return fn({error: err});
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

        getRoomMessages(room.id, 15, response => {
          if (response.error) {
            console.warn("failed to get latest messages from room #" + room.id + ": " + response.error);
            room.messages = {};
          } else {
            room.messages = response.messages;
          }

          // Add the user to the room
          user.roomId = room.id;
          addUserToRoom(userId, room.id);

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

    if (!validateString(data.userName)) return fn({error: "Invalid Username"});

    getRoomUsers(data.roomId, response => {
      if (response.error) {
        console.warn("Failed to get user list for room #" + data.roomId + ":", response.error);
        return fn({error: "Unexpected error"});
      } else if (response.userIds.length == 0) {
        return fn({error: "Invalid Room"});
      } else if (!response.userIds.includes(userId)) {
        return fn({error: "Can't enter room that hasn't been joined"});
      }

      user.name = stripHTML(data.userName);
      setUserName(userId, user.name);

      createMessage(userId, "joined the room", true, message => {
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
    var user = getUser(userId);
    if (user.error) return;

    var activeUsers = 0;

    getRoomUsers(user.roomId, response => {
      if (response.error) return console.warn("Failed to get user list when leaving room:", response.error);
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

        if (activeUsers == 0) deleteRoom(user.roomId);

        // If we aren't returning here, we still need the roomId for createMessage()
        user.roomId = null;
        return;
      }

      createMessage(userId, "left the room", true, message => {
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
        if (activeUsers == 0) deleteRoom(user.roomId);
        user.roomId = null;
      });
    });
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);
    if (!validateString(data.content)) return fn({error: "Invalid Message"});

    createMessage(userId, data.content, false, message => {
      fn({message: message});

      getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get room users:", response.error);
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
    var user = getUser(userId);
    if (user.error) return fn(user);
    if (!user.roomId) return fn({error: "Not in a room"});

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
        return fn({error: err});
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
          return fn({error: err});
        }
        fn({});

        getRoomUsers(user.roomId, response => {
          if (response.error) return console.warn("Failed to get room user ids:", response.error);
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
    var user = getUser(userId);
    if (user.error) return fn(user);
    if (!user.roomId) return fn({error: "Not in a room!"});

    db.query(`DELETE FROM message_likes WHERE message_id = ? AND user_id = ?;`, [
      data.msgId,
      userId
    ], (err, result) => {
      if (err) {
        console.warn("Failed to remove like:", err);
        return fn({error: err});
      } else if (result.affectedRows == 0) {
        return fn({error: "Can't unlike a message that hasn't been liked!"})
      }
      fn({});

      // Inform other active users that the like was removed
      getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get room user ids:", response.error);
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
