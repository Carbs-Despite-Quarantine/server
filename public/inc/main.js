/**************
 * Room Setup *
 **************/

var socket = io("http://localhost:3000");

var userId;
var roomId;

socket.on("init", data => {
  if (data.error) return console.error("Failed to initialize socket:", data.error);
  console.debug("Obtained userId " + data.userId);
  userId = data.userId;
});

$("#create-room").submit(event => {
  event.preventDefault();

  console.debug("Creating room...");
  var userName = $("#username-input").val();

  $("#create-room").hide();
  $("#create-room-spinner").show();

  socket.emit("createRoom", {
    userName: userName
  }, response => {
    $("#create-room-spinner").hide();

    if (response.error) {
      $("#create-room").show();
      return console.error("Failed to create room:", response.error);
    }

    roomId = response.roomId;

    console.debug("Created room #" + roomId);
    $("#create-room-success").show();

    var roomLink = "http://localhost:3000?room=" + roomId;
    $("#room-link").text(roomLink);
    $("#room-link").attr("href", roomLink);
  });
});

$("#start-game").click(event => {
  if (!roomId) return console.error("Attempted to start game without a room ID");
  console.debug("Starting game...");
  $("#overlay-container").hide();
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