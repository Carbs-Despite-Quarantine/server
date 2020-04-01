/********************
 * Global Variables *
 ********************/

var socket = io("http://localhost:3000");

var userId;
var roomId;

/********************
 * Helper Functions *
 ********************/

function getURLParam(name){
  var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
  return results && results[1] || 0;
}

function resetRoomMenu() {
  $("#set-username").show();
  $("#set-username-submit").attr("value", "Create Room");
  window.history.pushState(null, null, window.location.href.split("?")[0]);
  roomId = null;
}

/*******************
 * Socket Handling *
 *******************/

socket.on("init", data => {
  if (data.error) return console.error("Failed to initialize socket:", data.error);
  console.debug("Obtained userId " + data.userId);
  userId = data.userId;

  // Check if the provided roomId is valid
  if (roomId && roomId != 0) {
    socket.emit("validateRoomId", {
      roomId: roomId
    }, response => {
      if (response.result != "success") {
        console.warn("Tried to join invalid room #" + roomId + ":", response.error);
        resetRoomMenu();
        return;
      }
    });
  }
});

socket.on("userJoined", data => {
  console.debug("User #" + data.userId + " joined with name " + data.userName);
});

/**************
 * Room Setup *
 **************/

$("#set-username").submit(event => {
  event.preventDefault();

  var userName = $("#username-input").val();

  $("#set-username").hide();
  $("#room-spinner").show();

  // If a room ID was supplied in the URL, try to join it
  if (roomId && roomId != 0) {
    console.debug("Joining room #" + roomId + "...");
    socket.emit("joinRoom", {
      roomId: roomId,
      userName: userName
    }, response => {
      $("#room-spinner").hide();

      if (response.error) {
        console.error("Failed to join room #" + roomId + ":", response.error);
        resetRoomMenu();
        return;
      }

      console.debug("Joined room #" + roomId);
      $("#overlay-container").hide();
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

      roomId = response.roomId;

      console.debug("Created room #" + roomId);
      $("#create-room-success").show();

      var roomLink = window.location.href.split("?")[0] + "?room=" + roomId;
      $("#room-link").text(roomLink);
      $("#room-link").attr("href", roomLink);
      window.history.pushState(null, null, roomLink);
    });
  }
});

$("#start-game").click(event => {
  if (!roomId) return console.error("Attempted to start game without a room ID");
  console.debug("Starting game...");
  $("#overlay-container").hide();
});

$(document).ready(event => {
  var roomIdParam = getURLParam("room");
  if (roomIdParam && roomIdParam != 0) {
    console.debug("Trying to join room #" + roomIdParam);
    $("#set-username-submit").attr("value", "Join Room");
    roomId = roomIdParam;
  }
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
  stop: (event, ui) => {
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