/********************
 * Global Variables *
 ********************/

var socket = io("http://localhost:3000");

var userId;

var users = {};
var room;

/********************
 * Helper Functions *
 ********************/

function getURLParam(name){
  var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
  return results && results[1] || null;
}

function resetRoomMenu() {
  $("#set-username").show();
  $("#set-username-submit").attr("value", "Create Room");
  window.history.pushState(null, null, window.location.href.split("?")[0]);
  room = null;
  if (users.hasOwnProperty(userId)){
    users[userId].roomId = null;
  }
}

function scrollMessages() {
  $("#chat-history").scrollTop($("#chat-history").prop("scrollHeight"));
}

function addMessage(message) {
  $("#chat-history").append(`
    <div class="msg-container ${message.isSystemMsg ? "system-msg" : "user-msg"}">
      <h2>${users[message.userId].name}</h2>
      <p>${message.content}</p>
    </div>
  `);

  scrollMessages();
}

function populateChat(messages) {
  for (var messageId in messages) {
    addMessage(messages[messageId]);
  }
}

/*******************
 * Socket Handling *
 *******************/

socket.on("init", data => {
  if (data.error) return console.error("Failed to initialize socket:", data.error);
  console.debug("Obtained userId " + data.userId);
  userId = data.userId;

  var roomId = getURLParam("room");

  users[userId] = {
    id: userId,
    name: "Guest",
    roomId: roomId
  };

  if (roomId) {
    console.debug("Trying to join room #" + roomId);
    $("#set-username-submit").attr("value", "Join Room");

    socket.emit("joinRoom", {
      roomId: roomId
    }, response => {
      if (response.error) {
        console.warn("Failed to join room #" + roomId + ":", response.error);
        resetRoomMenu();
        return;
      }

      console.debug("Joined room #" + roomId);

      users = response.users;
      room = response.room;
      populateChat(room.messages);
    });
  }
});

socket.on("userJoined", data => {
  users[data.user.id] = data.user;
  if (data.message) addMessage(data.message);
});

socket.on("userLeft", data => {
  if (!users.hasOwnProperty(data.userId)) {
    return console.error("Recieved leave message for unknown user #" + data.userId);
  }
  if (data.message) addMessage(data.message);
  users[data.userId].roomId = null;
})

window.addEventListener("beforeunload", (event) => {
  socket.emit("userLeft");
});

/**************
 * Room Setup *
 **************/

$("#set-username").submit(event => {
  event.preventDefault();

  var user = users[userId];
  var userName = $("#username-input").val();

  $("#set-username").hide();
  $("#room-spinner").show();

  // If the user is already in a room, enter it
  if (room) {
    console.debug("Entering room #" + user.roomId + "...");
    socket.emit("enterRoom", {
      roomId: user.roomId,
      userName: userName
    }, response => {
      $("#room-spinner").hide();

      if (response.error) {
        console.error("Failed to join room #" + user.roomId + ":", response.error);
        resetRoomMenu();
        return;
      }

      console.debug("Entered room #" + user.roomId);
      $("#overlay-container").hide();

      user.name = userName;
      if (response.message) addMessage(response.message);
    });
  } else {
    console.debug("Creating room...");
    socket.emit("createRoom", {
      userName: userName
    }, response => {
      $("#room-spinner").hide();

      if (response.error) {
        $("#set-username").show();
        return console.error("Failed to create room:", response.error);
      }

      room = response.room;
      user.name = userName;

      console.debug("Created room #" + room.id);
      $("#create-room-success").show();

      var roomLink = window.location.href.split("?")[0] + "?room=" + room.id;
      $("#room-link").text(roomLink);
      $("#room-link").attr("href", roomLink);
      window.history.pushState(null, null, roomLink);

      populateChat(room.messages);
    });
  }
});

$("#start-game").click(event => {
  if (!room || !room.users) return console.error("Attempted to start game without a room ID");

  console.debug("Starting game...");

  $("#overlay-container").hide();
});

/***************
 * Chat System *
 ***************/

$("#chat-input").keyup(event => {
  event.stopPropagation();

  var content = $("#chat-input").val().replace(/^\s+|\s+$/g, "");

  // 13 is the keycode for enter
  if (content.length > 0 && event.which == 13) {
    socket.emit("chatMessage", {
      content: content
    }, response => {
      $("#chat-input").val("");
      if (response.error) return console.warn("Failed to send chat message:", response.error);
      if (response.message) addMessage(response.message);
    });

  }
});

$(window).resize(event => {
  scrollMessages();
});

socket.on("chatMessage", data => {
  if (data.message) addMessage(data.message);
});

/********************
 * Card Interaction *
 ********************/

$(".card").draggable({
  scroll: false,
  containment: "#game-wrapper",
  start: (event, ui) => {
    ui.helper.data("addedToStorage", false);
  },
  drag: (event, ui) => {
    $(event.target).css("z-index", 99);
  },
  stop: (event, ui) => {
    $(event.target).css("z-index", "");
    // Move the card out of the hand
    if (!ui.helper.data("addedToStorage")) {
      if (!$(event.target).parent().is($("#game-wrapper"))) {
        var parentOffset = $(event.target).parent().offset();
        var element = $(event.target).detach();
        element.attr("style", `position: absolute; left: ${ui.offset.left}px; top: ${ui.offset.top}px`);
        $("#game-wrapper").append(element);
      }
    }
  }
});


$(".card-storage").droppable({
  drop: (event, ui) => {
    // Move the card into storage
    ui.helper.data("addedToStorage", true);
    var element = ui.draggable.detach();
    element.attr("style", "position: relative;");
    $(event.target).append(element);
  }
});