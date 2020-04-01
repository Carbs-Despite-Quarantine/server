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
    name: "Guest",
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
    rooms[roomId] = {
      id: roomId,
      users: [userId]
    };

    // Update the users detaiils
    users[userId].name = data.userName;
    users[userId].roomId = roomId;

    console.log("Created room #" + roomId + " for user #" + userId);

    // Send the roomId to the user
    fn({
      roomId: roomId
    });
  });

  socket.on("validateRoomId", (data, fn) => {
    if (!rooms.hasOwnProperty(data.roomId)) return fn({result: "invalid"});
    fn({result: "valid"});
  });

  socket.on("joinRoom", (data, fn) => {
    if (!users.hasOwnProperty(userId)) return fn({error: "Invalid User"});
    if (!validateString(data.userName)) return fn({error: "Invalid Username"});
    if (!rooms.hasOwnProperty(data.roomId)) return fn({error: "Invalid Room ID"});

    // Update the users details
    var user = users[userId];
    user.name = data.userName;
    user.roomId = data.roomId;

    // Add the user to the room
    var room = rooms[data.roomId];
    room.users.push(userId);

    // Send 
    fn({
      users: room.users
    });

    room.users.forEach(roomUser => {
      // Send the new users info to all other active room users
      if (roomUser != userId & users[roomUser].roomId == room.id) {
        users[roomUser].socket.emit("userJoined", {
          userId: userId,
          userName: user.name
        });
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