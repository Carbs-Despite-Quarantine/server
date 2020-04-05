/*******************
 * State Constants *
 *******************/

const UserStates = Object.freeze({
  "idle": 1,
  "choosing": 2,
  "czar": 3,
  "inactive": 4
});

const RoomStates = Object.freeze({
  "new": 1,
  "choosingCards": 2,
  "readingCards": 3
});

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
  if (message.likes.includes(userId)) return console.warn("Can't like a message twice!");
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
    <div class="icon-container msg-container ${message.isSystemMsg ? "system-msg" : "user-msg"}" id="msg-${message.id}">
      <div class="icon msg-icon">
        <i class="fas fa-${users[message.userId].icon}"></i>
      </div>
      <div class="content msg-content">
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

/*************
 * User List *
 *************/

function getStateString(state) {
  return state == UserStates.czar ? "Card Czar" : (state == UserStates.idle ? "Ready" : "Choosing...");
}

function addUser(user) {
  $("#user-list").append(`
    <div class="icon-container user-display" id="user-${user.id}">
      <div class="icon user-icon">
        <i class="fas fa-${user.icon}"></i>
      </div>
      <div class="content user-info">
        <h2>${user.name}</h2>
        <p id="user-state-${user.id}">${getStateString(user.state)}</p>
      </div>
      <div class="user-score">
        <h2 id="user-score-${user.id}">${user.score}</h2>
      </div>
    </div>
  `);
}

function populateUserList(users) {
  for (var user in users) {
    if (users[user].icon && users[user].name) addUser(users[user]);
  }
}

function setUserState(userId, state) {
  users[userId].state = state;
  $("#user-state-" + userId).text(getStateString(state));
}

function setUserScore(userId, score) {
  $("#user-score-" + userId).text(score);
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
    name: null,
    icon: null,
    roomId: roomId,
    score: 0,
    state: UserStates.idle
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
      populateUserList(users);

      if (room.curPrompt) setBlackCard(room.curPrompt);

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
  addUser(data.user);
});

socket.on("userLeft", data => {
  if (!users.hasOwnProperty(data.userId)) {
    return console.error("Recieved leave message for unknown user #" + data.userId);
  }
  if (data.message) addMessage(data.message);
  $("#user-" + data.userId).remove();
  users[data.userId].roomId = null;
})

socket.on("roomSettings", data => {
  console.debug("Room has been set to " + data.edition + " edition!");
  room.edition = data.edition;
  room.rotateCzar = data.rotateCzar;

  if (data.hand) addCardsToDeck(data.hand);
  setBlackCard(data.blackCard);
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
      addCardsToDeck(response.hand);

      $("#overlay-container").hide();

      user.name = userName;
      if (response.message) addMessage(response.message);

      users[userId].state = UserStates.choosing;
      addUser(users[userId]);
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
      user.roomId = room.id;
      user.state = UserStates.czar;

      // Clear and cache the edition menu in order to re-populate it
      var editionMenu = $("#select-edition");
      editionMenu.empty();

      // Populate the edition selection menu
      for (var edition in response.editions) {
        editionMenu.append(`<option value="${edition}">${response.editions[edition]}</option>`);
      }

      for (var pack in response.packs) {
        addExpansionSelector(pack, response.packs[pack]);
      }

      console.debug("Created room #" + room.id);

      $("#room-setup-window").show();
      $("#user-setup-window").hide();

      room.link = window.location.href.split("?")[0] + "?room=" + room.id + "&token=" + room.token;
      window.history.pushState(null, null, room.link);

      populateChat(room.messages);
      populateUserList(users);

      $("#setup-spinner").hide();

      // TODO: get cards from server
      for (var i = 0; i < 4; i++) {
        appendCardBack($("#response-cards"));
      }
    });
  }
});

$("#start-game").click(event => {
  if (!room || !room.users) return console.error("Attempted to start game without a room ID");

  console.debug("Starting game...");

  $("#room-setup-window").hide();
  $("#user-setup-window").show();
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
    packs: expansionsSelected
  }, response => {
    $("#setup-spinner").hide();

    if (response.error) {
      $("#room-setup-window").show()
      $("#user-setup-window").hide();
      return console.warn("Failed to setup room:", response.error);
    }

    $("#overlay-container").hide();
    addCardsToDeck(response.hand);
    setBlackCard(response.blackCard);
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
});

/********
 * Game *
 ********/

// TODO: display aand allow czar to pick
socket.on("cardChoices", data => {
  console.debug("Card choices:", data);
});

socket.on("userState", data => {
  setUserState(data.userId, data.state);
});

socket.on("answersReady", () => {
  if (users[userId].state != UserStates.czar) return console.warn("Recieved answersReady state despite not being czar!");
  $("#central-action").show().text("Read Answers");
});

/********************
 * Card Interaction *
 ********************/

// The ID of the currently selected white card
var selectedCard = null;

// Set to true while waiting for a server response from selectCard
var submittingCard = false;

function appendCardBack(target, isWhite=true) {
  target.append(`
    <div class="card ${isWhite ? "white" : "black"} back">
        <div class="card-text">Cards Against Quarantine</div>
      </div>
  `);
}

function appendCard(card, target, isWhite=true) {
  var color = isWhite ? "white" : "black";
  var id = color + "-card-" + card.id;
  var html = `<div class="card ${color} front" id="${id}">`;
  if (card.draw || card.pick) {
    if (card.draw == 2) html += `<div class="special draw"></div>`;

    var pick = card.pick;
    if (pick > 1) {
      html += `<div class="special pick`;
      if (pick > 2) html += " pick-three";
      html += `"></div>`;
    }
  }
  target.append(html + `<div class="card-text">${card.text}</div></div`);
}

// TODO: animate?
function addCardToDeck(card) {
  appendCard(card, $("#hand"));
  var cardElement = $("#white-card-" + card.id);
  cardElement.click(event => {
    if (users[userId].state != UserStates.choosing || submittingCard) return;
    if (selectedCard) {
      $("#white-card-" + selectedCard).removeClass("selected-card");
    }
    cardElement.addClass("selected-card");
    selectedCard = card.id;
    $("#central-action").show().text("Submit Card");
  });
}

function addCardsToDeck(newCards) {
  for (var cardId in newCards) {
    addCardToDeck(newCards[cardId]);
  }
}

function setBlackCard(blackCard) {
  $("#cur-black-card").empty();
  appendCard(blackCard, $("#cur-black-card"), false);
}

$("#hand").sortable({
  tolerance: "pointer"
});

$("#game-wrapper").click(event => {
  if (!submittingCard && selectedCard && ($(event.target).is("#game-wrapper") || $(event.target).is("#hand"))) {
    $("#white-card-" + selectedCard).removeClass("selected-card");
    selectedCard = null;
    $("#central-action").hide();
  }
})

function submitCard() {
  $("#central-action").hide();
  if (selectedCard && !submittingCard) {
    submittingCard = true;
    var cardId = selectedCard;
    socket.emit("submitCard", {
      cardId: cardId
    }, response => {
      submittingCard = false;
      if (response.error) {
        console.warn("Failed to submit card #" + selectedCard + ":", response.error);
        return $("#central-action").show().text("Submit Card");
      }
      selectedCard = null;
      $("#white-card-" + cardId).remove();

      if (response.newCard) addCardToDeck(response.newCard);
      setUserState(userId, UserStates.idle);
    })
  }
}

$("#central-action").click(event => {
  var curState = users[userId].state;

  if (curState == UserStates.czar) {
    console.debug("do it !");
  } else if (curState == UserStates.choosing) {
    submitCard();
  }
});