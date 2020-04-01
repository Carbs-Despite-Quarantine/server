const express = require("express");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

/**
 * User:
 *  - id (hash)
 *  - name (string)
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
  if (!users.hasOwnProperty(userId)) return {error: "Invalid User"};
  var user = users[userId];
  if (!user.roomId || user.roomId == 0) return {error: "Not in a room"};
  if (!validateString(content)) return {error: "Invalid Message"};
  
  // Cache the room object
  var room = rooms[user.roomId];

  // Generate an ID for the message
  var messageId = hash64();
  while (room.messages.hasOwnProperty(messageId)) messageId = hash64();

  // Create the message
  var message = {
    id: messageId,
    userId: userId,
    content: content,
    isSystemMsg: isSystemMsg,
    timestamp: Date.now()
  };

  // Add the message to the room and return it
  room.messages[messageId] = message;
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
    roomId: null,
    socket: socket
  };

  // Send the generated userId
  socket.emit("init", {
    userId: userId
  });

  socket.on("createRoom", (data, fn) => {
    if (!users.hasOwnProperty(userId)) return fn({error: "Invalid User"});
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
    users[userId].name = data.userName;
    users[userId].roomId = roomId;

    // The message will be automatically added to the room
    createMessage(userId, "created the room", true);

    console.log("Created room #" + roomId + " for user #" + userId);

    // Send the roomId to the user
    fn({
      room: room
    });
  });

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    if (!users.hasOwnProperty(userId)) return fn({error: "Invalid User"});
    if (!rooms.hasOwnProperty(data.roomId)) return fn({error: "Invalid Room ID"});

    var user = users[userId];
    var room = rooms[data.roomId];

    // Add the user to the room
    user.roomId = data.roomId;
    room.users.push(userId);

    // Cache the users in the room without including the socket
    var clientUsers = {};

    room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Add the user to the list
      clientUsers[roomUserId] = {
        id: roomUserId,
        name: roomUser.name,
        roomId: roomUser.roomId
      };
    });

    fn({
      room: room,
      users: clientUsers
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    if (!users.hasOwnProperty(userId)) return fn({error: "Invalid User"});
    if (!validateString(data.userName)) return fn({error: "Invalid Username"});
    if (!rooms.hasOwnProperty(data.roomId)) return fn({error: "Invalid Room ID"});

    var user = users[userId];
    var room = rooms[data.roomId];

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
            name: user.name
          },
          message: message
        });
      }
    });
  });

  socket.on("userLeft", (data) => {
    if (!users.hasOwnProperty(userId)) return;
    var user = users[userId];
    if (!user.roomId || !rooms.hasOwnProperty(user.roomId)) return;

    var room = rooms[user.roomId];
    var activeUsers = 0;

    // If the user never entered the room, don't inform users of leave
    if (!user.name) {
      // We have to do this twice to prevent users who haven't entered leaving the room open indefinitely
      room.users.forEach(roomUserId => {
        if (roomUserId != userId && users[roomUserId].roomId == room.id) activeUsers++;
      });
      if (activeUsers == 0) {
        console.log("Deleting room #" + room.id + " because all users have left");
        delete rooms[room.id];
      }

      // If we aren't returning here, we still need the roomId for createMessage()
      user.roomId = null;
      return;
    }

    var message = createMessage(userId, "left the room", true);

    room.users.forEach(roomUserId => {
      var roomUser = users[roomUserId];

      // Notify active users that the user left
      if (roomUserId != userId && roomUser.roomId == room.id) {
        activeUsers++;
        roomUser.socket.emit("userLeft", {
          userId: userId,
          message: message
        });
      }
    });

    // Delete the room once all users have left
    if (activeUsers == 0) {
      console.log("Deleting room #" + room.id + " because all users have left");
      delete rooms[room.id];
    }

    user.roomId = null;
  });
});

/**************
 * Web Server *
 **************/

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});