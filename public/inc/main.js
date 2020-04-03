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
  $("#select-icon").show();
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

function likeMessage(message) {
  if (message.likes.hasOwnProperty(userId)) return console.warn("Can't like a message twice!");
  socket.emit("likeMessage", {
    msgId: message.id
  }, response => {
    if (response.error) return console.warn("Failed to like message #" + message.id + ":", response.error);
    if (!response.like) return;
    addLikes(message.id, {
      [userId]: response.like
    });
  });
}

// Re-initializes the given likes div with just heart icon
function clearLikesDiv(likesDiv, msgId) {
  likesDiv.html(`
    <div class="msg-heart">
      <i class="far fa-heart"></i>
    </div>
  `);

  var message = room.messages[msgId];

  // Listen for clicks on the heart icon
  likesDiv.children(".msg-heart").first().click(event => {
    // Remove like if already added
    if (message.likes.hasOwnProperty(userId)) {
      socket.emit("unlikeMessage", {
        msgId: msgId
      }, response => {
        if (response.error) return console.warn("Failed to unlike message #" + msgId + ":", response.error);
        removeLike(msgId, userId);
      });
    } else {
      likeMessage(message);
    }
  });
}

function getOrCreateLikesDiv(msgId) {
  var msgDiv = $("#msg-" + msgId);
  if (msgDiv.length == 0) {
    console.warn("Tried to create like div for invalid msg #", msgId);
    return null;
  }

  var contentDiv = msgDiv.first().children(".msg-content");
  if (contentDiv.length == 0) {
    console.warn("Failed to get content div for msg #" + msgId);
    return null;
  }

  var likesDiv = contentDiv.children(".msg-likes");
  if (likesDiv.length > 0) {
    return likesDiv.first();
  }
  
  contentDiv.append(`<div class="msg-likes"></div>`);
  clearLikesDiv(contentDiv.children(".msg-likes").first(), msgId);

  return contentDiv.children(".msg-likes").first();
}

function addLikes(msgId, likes, addToMessage=true) {
  if (!room.messages.hasOwnProperty(msgId)) {
    console.warn("Tried to add likes to untracked message #", msgId);
    return;
  }
  var likesDiv = getOrCreateLikesDiv(msgId);
  if (!likesDiv) {
    console.warn("Failed to add likes to message #", msgId);
    return;
  }
  var message = room.messages[msgId];
  for (var likeUserId in likes) {
    if (!users.hasOwnProperty(likeUserId)) {
      console.warn("Recieved like from invalid user #" + likeUserId);
      continue;
    } else if (message.likes.hasOwnProperty(likeUserId) && addToMessage) {
      console.warn("User #" + likeUserId + " tried to like message #" + msgId + " twice!");
      continue;
    }
    if (addToMessage) message.likes[likeUserId] = likes[likeUserId];
    if (likeUserId == userId) {
      var heart = likesDiv.children(".msg-heart").first().children("i").first();

      // Replace the empty heart with a full heart
      heart.removeClass("far");
      heart.addClass("fas");
    }
    var user = users[likeUserId];
    likesDiv.append(`
      <div class="msg-like">
        <i class="fas fa-${user.icon}" title="Liked by ${user.name}"></i>
      </div>
    `);
  }
}

function removeLike(msgId, userId) {
  if (!room.messages.hasOwnProperty(msgId)) {
    console.warn("Tried to remove a like from untracked message #", msgId);
    return;
  }
  var likesDiv = getOrCreateLikesDiv(msgId);
  if (!likesDiv) {
    console.warn("Failed to remove a like from message #", msgId);
  }
  var message = room.messages[msgId];
  delete message.likes[userId];

  // Simply delete the likes div if this was the last like
  if (Object.keys(message.likes).length == 0) {
    likesDiv.remove();
    return;
  }
  clearLikesDiv(likesDiv, msgId);
  addLikes(msgId, message.likes, false);
}

function addMessage(message, addToRoom=true) {
  $("#chat-history").append(`
    <div class="msg-container ${message.isSystemMsg ? "system-msg" : "user-msg"}" id="msg-${message.id}">
      <div class="msg-icon">
        <i class="fas fa-${users[message.userId].icon}"></i>
      </div>
      <div class="msg-content">
        <h2>${users[message.userId].name}</h2>
        <p>${message.content}</p>
      </div>
    </div>
  `);

  // Add existing likes to the message
  if (Object.keys(message.likes).length > 0) {
    addLikes(message.id, message.likes, false);
  }

  scrollMessages();

  if (addToRoom) {
    room.messages[message.id] = message;
  }

  if (!message.isSystemMsg) {
    $("#msg-" + message.id).dblclick(event => likeMessage(message));
  }
}

function populateChat(messages) {
  for (var msgId in messages) {
    addMessage(messages[msgId], false);
  }
}

/*****************
 * Icon Selector *
 *****************/

// Every unused icon
var availableIcons = [];

// The icons displayed in the icon selection panel
var iconChoices = [];

// The currently selected icon name
var selectedIcon = null;

function setIcon() {
  if (!selectedIcon || !userId) return;

 $("#select-icon").hide();
 $("#setup-spinner").show();
  
  socket.emit("setIcon", {
    icon: selectedIcon
  }, response => {
    $("#setup-spinner").hide();
    if (response.error) {
      console.error("Failed to set icon:", response.error);
      $("#select-icon").show();
      return;
    }
    $("#set-username").show();
    users[userId].icon = selectedIcon;
 });
}

function addIcon(name) {
  $("#select-icon").children("#icons").append(`
    <div class="icon ${name == selectedIcon ? "selected" : ""}" id="icon-${name}">
      <i class="fas fa-${name}"></i>
    </div>
  `);
  // Add a click listener to select the icon
  var element = $("#icon-" + name);
  element.click(event => {
    var curName = element.attr("id").match(/icon-(.*)/)[1];

    $(".icon").removeClass("selected");
    element.addClass("selected");
    selectedIcon = curName;

    $("#set-icon").prop("disabled", false);
  });

  element.dblclick(event => {
    setIcon();
  });
}

function populateIconSelector(icons) {
  $("#select-icon").children("#icons").empty();
  availableIcons = icons;
  iconChoices = [];

  var maxIcons = 14;
  if (maxIcons > icons.length) maxIcons = icons.length;

  while (iconChoices.length < maxIcons) {
    var icon = icons[Math.floor(Math.random() * icons.length)];
    if (iconChoices.includes(icon)) continue;

    iconChoices.push(icon);
    addIcon(icon);
  }

  if (!iconChoices.includes(selectedIcon)) selectedIcon = null;
}

$("#set-icon").click(event => {
  setIcon();
});

socket.on("iconTaken", event => {
  var iconIndex = availableIcons.indexOf(event.icon);
  if (iconIndex > -1) availableIcons.splice(iconIndex, 1);

  iconIndex = iconChoices.indexOf(event.icon);
  if (iconIndex > -1) iconChoices.splice(iconIndex, 1);

  if (selectedIcon == event.icon) {
    selectedIcon = null;
    $("#set-icon").prop("disabled", true);
  }

  var iconElement = $("#icon-" + event.icon);
  if (iconElement.length > 0) {
    // If there are no excess avaiable items, simply hide the icon
    if (iconChoices.length >= availableIcons.length) {
      iconElement.hide();
      return;
    }

    // Find a new icon to replace it
    var newIcon;
    while (!newIcon || iconChoices.includes(newIcon)) {
      newIcon = availableIcons[Math.floor(Math.random() * availableIcons.length)];
    }

    iconElement.attr("id", "icon-" + newIcon);
    iconElement.removeClass("selected");

    // Replace the font awesome icon class
    var faElement = iconElement.children("i");
    faElement.removeClass("fa-" + event.icon);
    faElement.addClass("fa-" + newIcon);
  }
});

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
      $("#setup-spinner").hide();

      if (response.error) {
        console.warn("Failed to join room #" + roomId + ":", response.error);
        resetRoomMenu();
        populateIconSelector(data.icons);
        return;
      }

      populateIconSelector(response.iconChoices);
      console.debug("Joined room #" + roomId);

      users = response.users;
      room = response.room;
      populateChat(room.messages);
    });
  } else {
    populateIconSelector(data.icons);
    $("#setup-spinner").hide();
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

$("#username-input").keyup(event => {
  var userName = $("#username-input").val().replace(/^\s+|\s+$/g, "");
  $("#set-username-submit").prop("disabled", userName.length == 0);
});

$("#set-username").submit(event => {
  event.preventDefault();

  var user = users[userId];
  var userName = $("#username-input").val();

  $("#set-username").hide();
  $("#setup-spinner").show();

  // If the user is already in a room, enter it
  if (room) {
    console.debug("Entering room #" + user.roomId + "...");
    socket.emit("enterRoom", {
      roomId: user.roomId,
      userName: userName
    }, response => {
      $("#setup-spinner").hide();

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
      $("#setup-spinner").hide();

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

socket.on("likeMessage", data => {
  if (data.msgId && data.like) addLikes(data.msgId, {[data.like.userId]: data.like});
});

socket.on("unlikeMessage", data => {
  if (data.msgId && data.userId) removeLike(data.msgId, data.userId);
})

/********************
 * Card Interaction *
 ********************/

/**
 * Card:
 *  - text: string
 *  - isBlackCard: bool
 *  - special: (black cards only)
 *     - draw: int (1 or 2)
 *     - pick: int (1, 2 or 3)
 **/

function getCardHTML(card) {
  var html = `div class="card ${card.isBlackCard ? "black" : "white"} front">`;
  if (card.isBlackCard && card.special) {
    if (card.special.draw == 2) html += `<div class="special draw"></div>`;

    var pick = card.special.pick;
    if (pick > 1) {
      html += `<div class="special pick`;
      if (pick > 2) html += " pick-three";
      html += `"></div>`;
    }
  }
  return html + `<div class="card-text">${card.text}</div></div`;
}

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

    var position = "relative";
    if ($(event.target).is("#deck")) position = "absolute";

    element.attr("style", `position: ${position};`);
    $(event.target).append(element);
  }
});

$("#black-deck").click(event => {
  console.log("wow");
});