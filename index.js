const express = require("express");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

// A selection of Font Awesome icons suitable for profile pictures
const icons = ["apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish", "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw", "pepper-hot", "pizza-slice", "spider"];

/**
 * User:
 *  - id (hash)
 *  - name (string)
 *  - icon (string)
 *  - roomId (hash)
 *  - socket (<socket>)
 **/
var users = {}

/**
 * Room:
 *  - id (hash)
 *  - users (hash[])
 *  - messages:
 *     - id (hash)
 *     - userId (hash)
 *     - content (string)
 *     - isSystemMsg (bool)
 *     - timestamp (int)
 *     - likes:
 *        - userId (hash)
 *        - timestamp (int)
 **/
var rooms = {}

/*******************
 * Data Validation *
 *******************/

function validateHash(id) {
  return typeof id === "string" && id.length === 16;
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

/***************
 * Data Lookup *
 ***************/

function getUser(userId) {
  if (!users.hasOwnProperty(userId)) return {error: "Invalid User"};
  return users[userId];
}

function getRoom(roomId) {
  if (!rooms.hasOwnProperty(roomId)) return {error: "Invalid Room ID"};
  return rooms[roomId];
}

function getMessage(room, msgId) {
  if (!room.messages.hasOwnProperty(msgId)) return {error: "Invalid Message ID"};
  return room.messages[msgId];
}

function getUserAndRoom(userId) {
  var user = getUser(userId);
  if (user.error) return {error: user.error};

  if (!user.roomId || user.roomId == 0) return {error: "Not in a room"};

  var room = getRoom(user.roomId);
  if (room.error) return {error: room.error};

  return {user: user, room: room};
}

/********************
 * Helper Functions *
 ********************/

// generate a random hash with 64 bits of entropy
function hash64() {
  var result = "";
  var hexChars = "0123456789abcdef";
  for (var i = 0; i < 16; i += 1) {
    result += hexChars[Math.floor(Math.random() * 16)];
  }
  return result;
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

/***************
 * Chat System *
 ***************/

function createMessage(userId, content, isSystemMsg) {
  var info = getUserAndRoom(userId);
  if (info.error) return info;
  if (!validateString(content)) return {error: "Invalid Message"};

  // Generate an ID for the message
  var msgId = hash64();
  while (info.room.messages.hasOwnProperty(msgId)) msgId = hash64();

  // Create the message
  var message = {
    id: msgId,
    userId: userId,
    content: content,
    isSystemMsg: isSystemMsg,
    timestamp: Date.now(),
    likes: {}
  };

  // Add the message to the room and return it
  info.room.messages[msgId] = message;
  return message;
}

/*******************
 * Socket Handling *
 *******************/

io.on("connection", (socket) => {
  // Generate ID
  var userId = hash64();
  while (users.hasOwnProperty(userId)) userId = hash64();

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

  /*****************
   * Room Handling *
   *****************/

  socket.on("setIcon", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!icons.includes(data.icon)) return fn({error: "Invalid Icon"});

    var room = getRoom(user.roomId);

    // No need to check the room if it is invalid
    if (!room.error) {
      room.users.forEach(roomUserId => {
        roomUser = users[roomUserId];

        // Can't share an icon with another active user
        if (roomUserId != userId && roomUser.roomId == room.id && roomUser.icon) {
          if (roomUser.icon == data.icon) {
            return fn({error: "Icon in use"});
          }
        }
      });

      // Notify users who are yet to choose an icon that the chosen icon is now unavailable
      room.users.forEach(roomUserId => {
        roomUser = users[roomUserId];

        if (roomUserId != userId && roomUser.roomId == room.id && !roomUser.icon) {
          roomUser.socket.emit("iconTaken", {
            icon: data.icon
          });
        }
      });
    }

    user.icon = data.icon;
    return fn({});
  });

  socket.on("createRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!validateString(data.userName)) return fn({error: "Invalid Username"});

    // Generate an ID for the room
    var roomId = hash64();
    while (rooms.hasOwnProperty(roomId)) roomId = hash64();

    // Create the room
    var room = {
      id: roomId,
      users: [userId],
      messages: {}
    };
    rooms[roomId] = room;

    // Update the users detaiils
    user.name = data.userName;
    user.roomId = roomId;

    // The message will be automatically added to the room
    createMessage(userId, "created the room", true);

    console.log("Created room #" + roomId + " for user #" + userId);

    // Send the roomId to the user
    fn({room: room});
  });

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    var room = getRoom(data.roomId);
    if (room.error) return fn(room);

    // Add the user to the room
    user.roomId = data.roomId;
    room.users.push(userId);

    // Cache the users in the room without including the socket
    var clientUsers = {};

    // Make aa list of the icons currently in use
    var roomIcons = [];

    room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Add the user to the list
      clientUsers[roomUserId] = {
        id: roomUserId,
        name: roomUser.name,
        icon: roomUser.icon,
        roomId: roomUser.roomId
      };

      // If the user is active, add their icon to the list
      if (roomUserId != userId && roomUser.roomId == room.id && roomUser.icon) {
        roomIcons.push(roomUser.icon)
      }
    });

    fn({
      room: room,
      users: clientUsers,
      iconChoices: getAvailableIcons(roomIcons)
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!validateString(data.userName)) return fn({error: "Invalid Username"});

    var room = getRoom(data.roomId);
    if (room.error) return fn(room);

    if (user.roomId != room.id || !room.users.includes(userId)) {
      return fn({error: "Can't enter room that hasn't been joined"});
    }

    user.name = data.userName;

    var message = createMessage(userId, "joined the room", true);
    fn({message: message});

    room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Send the new users info to all other active room users
      if (roomUserId != userId && roomUser.roomId == room.id) {
        roomUser.socket.emit("userJoined", {
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

  socket.on("userLeft", (data) => {
    var info = getUserAndRoom(userId);
    if (info.error) return;

    var activeUsers = 0;

    // If the user never entered the room, don't inform users of leave
    if (!info.user.name) {
      // We have to do this twice to prevent users who haven't entered leaving the room open indefinitely
      info.room.users.forEach(roomUserId => {
        if (roomUserId != userId && users[roomUserId].roomId == info.room.id) activeUsers++;
      });
      if (activeUsers == 0) {
        console.log("Deleting room #" + info.room.id + " because all users have left");
        delete rooms[info.room.id];
      }

      // If we aren't returning here, we still need the roomId for createMessage()
      info.user.roomId = null;
      return;
    }

    var message = createMessage(userId, "left the room", true);

    info.room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Notify active users that the user left
      if (roomUserId != userId && roomUser.roomId == info.room.id) {
        activeUsers++;
        roomUser.socket.emit("userLeft", {
          userId: userId,
          message: message
        });
      }
    });

    // Delete the room once all users have left
    if (activeUsers == 0) {
      console.log("Deleting room #" + info.room.id + " because all users have left");
      delete rooms[info.room.id];
    }

    info.user.roomId = null;
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    var info = getUserAndRoom(userId);
    if (info.error) return fn(info);
    if (!validateString(data.content)) return fn({error: "Invalid Message"});

    var message = createMessage(userId, data.content, false);

    fn({message: message});

    info.room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Send the message to other active users
      if (roomUserId != userId && roomUser.roomId == info.room.id) {
        roomUser.socket.emit("chatMessage", {message: message});
      }
    });
  });

  socket.on("likeMessage", (data, fn) => {
    var info = getUserAndRoom(userId);
    if (info.error) return fn(info);

    var message = getMessage(info.room, data.msgId);
    if (message.error) return fn(message);
    if (message.isSystemMsg) return fn({error: "Can't like system messages"});
    if (message.likes.hasOwnProperty(userId)) return fn({error: "Can't like a message twice!"});

    var like = {
      userId: userId,
      timestamp: Date.now()
    };

    message.likes[userId] = like;
    fn({like: like});

    info.room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Send the like information to other active users
      if (roomUserId != userId && roomUser.roomId == info.room.id) {
        roomUser.socket.emit("likeMessage", {msgId: message.id, like: like});
      }
    });
  });

  socket.on("unlikeMessage", (data, fn) => {
    var info = getUserAndRoom(userId);
    if (info.error) return fn(info);

    var message = getMessage(info.room, data.msgId);
    if (message.error) return fn(message);
    if (!message.likes.hasOwnProperty(userId)) return fn({error: "Can't unlike a message that hasn't been liked!"});

    delete message.likes[userId];
    fn({});

    info.room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Inform other active users that the like was removed
      if (roomUserId != userId && roomUser.roomId == info.room.id) {
        roomUser.socket.emit("unlikeMessage", {msgId: message.id, userId: userId});
      }
    });
  });
});

/**************
 * Web Server *
 **************/

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});