/********************
 * Global Variables *
 ********************/

var socket = io("http://localhost:3000");

var userId;

var users = {};
var room;

var cards = {};

// Used to hide the "Link Copied" notification after a few seconds
var copyLinkPersitTimer = null;
var copyLinkFadeTimer = null;

// Used to track the expansions enabled in the room setup menu
var expansionsSelected = [];

/********************
 * Helper Functions *
 ********************/

function getURLParam(name){
  var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
  return results && results[1] || null;
}

function resetRoomMenu() {
  $("#select-icon").show();
  $("#set-username-submit").attr("value", "Set Username");
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
    addLikes(message.id, [userId]);
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
    if (message.likes.includes(userId)) {
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

function addLikes(msgId, userIds, addToMessage=true) {
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
  userIds.forEach(likeId => {
    if (!users.hasOwnProperty(likeId)) {
      return console.warn("Recieved like from invalid user #" + likeId);
    } else if (message.likes.includes(likeId) && addToMessage) {
      return console.warn("User #" + likeId + " tried to like message #" + msgId + " twice!");
    }
    if (addToMessage) message.likes.push(likeId);
    if (likeId == userId) {
      var heart = likesDiv.children(".msg-heart").first().children("i").first();

      // Replace the empty heart with a full heart
      heart.removeClass("far");
      heart.addClass("fas");
    }
    var user = users[likeId];
    likesDiv.append(`
      <div class="msg-like">
        <i class="fas fa-${user.icon}" title="Liked by ${user.name}"></i>
      </div>
    `);
  });
  scrollMessages();
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
  var likeIndex = message.likes.indexOf(userId);
  if (likeIndex > -1) message.likes.splice(likeIndex, 1);

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

/**********************
 * Expansion Selector *
 **********************/

function addExpansionSelector(id, name) {
    $("#expansions-list").append(`
    <div class="expansion" id="expansion-${id}">
      <span class="expansion-name">${name}</span>
      </div>
  `);
  
  // Clicking an expansion will toggle it
  $("#expansion-" + id).click(event => {
    var target = $("#expansion-" + id);
    if (target.hasClass("selected")) {
      target.removeClass("selected");
      var expansionIndex = expansionsSelected.indexOf(id);
      if (expansionIndex > -1) expansionsSelected.splice(expansionIndex, 1);
    } else {
      target.addClass("selected");
      expansionsSelected.push(id);
    }
  });
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

  var roomId = parseInt(getURLParam("room"));
  var roomToken = getURLParam("token");

  users[userId] = {
    id: userId,
    name: "Guest",
    roomId: roomId
  };

  if (roomId) {
    console.debug("Trying to join room #" + roomId + " with token #" + roomToken);
    $("#set-username-submit").attr("value", "Join Room");

    socket.emit("joinRoom", {
      roomId: roomId,
      token: roomToken
    }, response => {
      if (response.error) {
        console.warn("Failed to join room #" + roomId + ":", response.error);
        $("#setup-spinner").hide();
        resetRoomMenu();
        populateIconSelector(data.icons);
        return;
      }

      populateIconSelector(response.iconChoices);
      console.debug("Joined room #" + roomId);

      users = response.users;
      room = response.room;
      room.link = window.location.href;
      populateChat(room.messages);

      $("#setup-spinner").hide();
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

socket.on("roomSettings", data => {
  console.debug("Room has been set to " + data.edition + " edition!");
  room.edition = data.edition;
  room.rotateCzar = data.rotateCzar;

  addCardsToDeck(data.cards);
});

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
      addCardsToDeck(response.cards);

      $("#overlay-container").hide();

      user.name = userName;
      if (response.message) addMessage(response.message);
    });
  } else {
    console.debug("Creating room...");
    socket.emit("createRoom", {
      userName: userName
    }, response => {
      if (response.error) {
        $("#setup-spinner").hide();
        $("#set-username").show();
        return console.error("Failed to create room:", response.error);
      }

      room = response.room;
      user.name = userName;

      // Clear and cache the edition menu in order to re-populate it
      var editionMenu = $("#select-edition");
      editionMenu.empty();

      // Populate the edition selection menu
      for (var edition in response.editions) {
        editionMenu.append(`<option value="${edition}">${response.editions[edition]}</option>`);
      }

      console.debug("Created room #" + room.id);

      $("#room-settings").show();
      $("#settings-title").hide();

      // TODO: get expansions from server
      var expansions = {
        RED: "Red Box", 
        GREEN: "Green Box", 
        BLUE: "Blue Box", 
        ABSURD: "Absurd Box",
        ASS: "Ass Pack", 
        "2000s": "2000s Nostalgia Pack", 
        PERIOD: "Period Pack",
        PRIDE: "Pride Pack", 
        THEATRE: "Theatre Pack", 
        TRUMP: "Saves America Pack"
      };

      for (var expansion in expansions) {
        addExpansionSelector(expansion, expansions[expansion]);
      }

      room.link = window.location.href.split("?")[0] + "?room=" + room.id + "&token=" + room.token;
      window.history.pushState(null, null, room.link);

      populateChat(room.messages);

      $("#setup-spinner").hide();
    });
  }
});

$("#start-game").click(event => {
  if (!room || !room.users) return console.error("Attempted to start game without a room ID");

  console.debug("Starting game...");

  $("#room-settings").hide();
  $("#setup-spinner").show();

  var title = $("#settings-title");
  title.children("h1").text("Configuring Room...");
  title.children("p").text("Please wait a second.");
  title.show();

  var edition = $("#select-edition").val();
  var rotateCzar = $("#select-czar").val() == "rotate";

  socket.emit("roomSettings", {
    edition: edition,
    rotateCzar: rotateCzar,
    expansions: expansionsSelected
  }, response => {
    $("#setup-spinner").hide();

    if (response.error) {
      $("#room-settings").show();
      $("#settings-title").hide();
      return console.warn("Failed to setup room:", response.error);
    }

    $("#overlay-container").hide();
    addCardsToDeck(response.cards);
  });

});

$("#room-link").click(event => {
  if (!room.link) return console.warn("Not in a room!");

  // Actually copy the link
  $("body").append(`<textarea id="fake-for-copy" readonly>${room.link}</textarea>`);
  var fake = $("#fake-for-copy")[0];
  fake.select();
  document.execCommand("copy");
  fake.remove();

  // "Link Copied!" notification logic
  $("#link-copy-notification").show().css("opacity", 100).removeClass("visible");
  clearTimeout(copyLinkFadeTimer);
  clearTimeout(copyLinkPersitTimer);
  copyLinkPersitTimer = setTimeout(() => {
    $("#link-copy-notification").css("opacity", 0).addClass("visible");
    clearTimeout(copyLinkFadeTimer);
    copyLinkFadeTimer = setTimeout(() => {
      if ($("#link-copy-notification").hasClass("visible")) {
        $("#link-copy-notification").removeClass("visible").hide();
      }
    }, 2000);
  }, 1000);
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
  if (data.msgId && data.userId) addLikes(data.msgId, [data.userId]);
});

socket.on("unlikeMessage", data => {
  if (data.msgId && data.userId) removeLike(data.msgId, data.userId);
})

/********************
 * Card Interaction *
 ********************/

const cardDragHandler = {
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
};

function appendCard(card, target) {
  var id = (card.draw ? "black" : "white") + "-card-" + card.id;
  var html = `<div class="card ${card.draw ? "black" : "white"} front" id="${id}">`;
  if (card.draw || card.pick) {
    if (card.draw == 2) html += `<div class="special draw"></div>`;

    var pick = card.special.pick;
    if (pick > 1) {
      html += `<div class="special pick`;
      if (pick > 2) html += " pick-three";
      html += `"></div>`;
    }
  }
  target.append(html + `<div class="card-text">${card.text}</div></div`);
  $("#" + id).draggable(cardDragHandler);
}

// TODO: animate
function addCardsToDeck(newCards) {
  for (var cardId in newCards) {
    cards[cardId] = newCards[cardId];
    appendCard(newCards[cardId], $("#hand"));
  }
}

$(".card").draggable(cardDragHandler);


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