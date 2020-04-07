/*******************
 * State Constants *
 *******************/

const UserStates = Object.freeze({
  "idle": 1,
  "choosing": 2,
  "czar": 3,
  "winner": 4,
  "inactive": 5
});

const RoomStates = Object.freeze({
  "new": 1,
  "choosingCards": 2,
  "readingCards": 3,
  "viewingWinner": 4
});

/********************
 * Global Variables *
 ********************/

const socket = io("http://localhost:3000");

var userId;

var users = {};
var room;

var cards = {};

// Used to hide the "Link Copied" notification after a few seconds
var copyLinkPersitTimer = null;
var copyLinkFadeTimer = null;

// Used to track the expansions enabled in the room setup menu
var expansionsSelected = [];

// The ID of the currently selected white card
var selectedCard = null;

// Set to true while waiting for a server response from selectCard
var submittingCard = false;

// jQuery element cache
const setupSpinner = $("#setup-spinner");

/********************
 * Helper Functions *
 ********************/

function getURLParam(name){
  let results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
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

  let message = room.messages[msgId];

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
  let msgDiv = $("#msg-" + msgId);
  if (msgDiv.length === 0) {
    console.warn("Tried to create like div for invalid msg #", msgId);
    return null;
  }

  let contentDiv = msgDiv.first().children(".msg-content");
  if (contentDiv.length === 0) {
    console.warn("Failed to get content div for msg #" + msgId);
    return null;
  }

  let likesDiv = contentDiv.children(".msg-likes");
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
  let likesDiv = getOrCreateLikesDiv(msgId);
  if (!likesDiv) {
    console.warn("Failed to add likes to message #", msgId);
    return;
  }
  let message = room.messages[msgId];
  userIds.forEach(likeId => {
    if (!users.hasOwnProperty(likeId)) {
      return console.warn("Recieved like from invalid user #" + likeId);
    } else if (message.likes.includes(likeId) && addToMessage) {
      return console.warn("User #" + likeId + " tried to like message #" + msgId + " twice!");
    }
    if (addToMessage) message.likes.push(likeId);
    if (likeId === userId) {
      let heart = likesDiv.children(".msg-heart").first().children("i").first();

      // Replace the empty heart with a full heart
      heart.removeClass("far");
      heart.addClass("fas");
    }
    let user = users[likeId];
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
  let likesDiv = getOrCreateLikesDiv(msgId);
  if (!likesDiv) {
    console.warn("Failed to remove a like from message #", msgId);
  }
  let message = room.messages[msgId];
  let likeIndex = message.likes.indexOf(userId);
  if (likeIndex > -1) message.likes.splice(likeIndex, 1);

  // Simply delete the likes div if this was the last like
  if (Object.keys(message.likes).length === 0) {
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
  for (let msgId in messages) {
    addMessage(messages[msgId], false);
  }
}

/*************
 * User List *
 *************/

function getStateString(state) {
  switch(state) {
    case UserStates.winner:
      return "Winner";
    case UserStates.czar:
      return "Card Czar";
    case UserStates.idle:
      return "Ready";
    case UserStates.choosing:
      return "Choosing";
    case UserStates.inactive:
      return "Inactive";
  }
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
  for (let user in users) {
    if (users[user].icon && users[user].name) addUser(users[user]);
  }
}

function setUserState(userId, state) {
  users[userId].state = state;
  $("#user-state-" + userId).text(getStateString(state));
}

function setUserScore(userId, score) {
  users[userId].score = score;
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
    let target = $("#expansion-" + id);
    if (target.hasClass("selected")) {
      target.removeClass("selected");
      let expansionIndex = expansionsSelected.indexOf(id);
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
 setupSpinner.show();
  
  socket.emit("setIcon", {
    icon: selectedIcon
  }, response => {
    setupSpinner.hide();
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
  let element = $("#icon-" + name);
  element.click(event => {
    let curName = element.attr("id").match(/icon-(.*)/)[1];

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

  let maxIcons = 14;
  if (maxIcons > icons.length) maxIcons = icons.length;

  while (iconChoices.length < maxIcons) {
    let icon = icons[Math.floor(Math.random() * icons.length)];
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
  let iconIndex = availableIcons.indexOf(event.icon);
  if (iconIndex > -1) availableIcons.splice(iconIndex, 1);

  iconIndex = iconChoices.indexOf(event.icon);
  if (iconIndex > -1) iconChoices.splice(iconIndex, 1);

  if (selectedIcon == event.icon) {
    selectedIcon = null;
    $("#set-icon").prop("disabled", true);
  }

  let iconElement = $("#icon-" + event.icon);
  if (iconElement.length > 0) {
    // If there are no excess avaiable items, simply hide the icon
    if (iconChoices.length >= availableIcons.length) {
      iconElement.hide();
      return;
    }

    // Find a new icon to replace it
    let newIcon;
    while (!newIcon || iconChoices.includes(newIcon)) {
      newIcon = availableIcons[Math.floor(Math.random() * availableIcons.length)];
    }

    iconElement.attr("id", "icon-" + newIcon);
    iconElement.removeClass("selected");

    // Replace the font awesome icon class
    let faElement = iconElement.children("i");
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

  let roomId = parseInt(getURLParam("room"));
  let roomToken = getURLParam("token");

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
        setupSpinner.hide();
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

      setupSpinner.hide();
    });
  } else {
    populateIconSelector(data.icons);
    setupSpinner.hide();
  }
});

socket.on("userJoined", data => {
  users[data.user.id] = data.user;
  room.users.push(data.user.id);
  if (data.message) addMessage(data.message);
  addUser(data.user);
});

socket.on("userLeft", data => {
  if (!users.hasOwnProperty(data.userId)) {
    return console.error("Recieved leave message for unknown user #" + data.userId);
  }
  if (data.message) addMessage(data.message);
  setUserState(data.userId, UserStates.inactive);
});

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
  let userName = $("#username-input").val().replace(/^\s+|\s+$/g, "");
  $("#set-username-submit").prop("disabled", userName.length === 0);
});

$("#set-username").submit(event => {
  event.preventDefault();

  let user = users[userId];
  let userName = $("#username-input").val();

  $("#set-username").hide();
  setupSpinner.show();

  // If the user is already in a room, enter it
  if (room) {
    console.debug("Entering room #" + user.roomId + "...");
    socket.emit("enterRoom", {
      roomId: user.roomId,
      userName: userName
    }, response => {
      setupSpinner.hide();

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

      // TODO: check room state before assuming choosing phase
      users[userId].state = UserStates.choosing;
      addUser(users[userId]);
    });
  } else {
    console.debug("Creating room...");
    socket.emit("createRoom", {
      userName: userName
    }, response => {
      if (response.error) {
        setupSpinner.hide();
        $("#set-username").show();
        return console.error("Failed to create room:", response.error);
      }

      room = response.room;
      user.name = userName;
      user.roomId = room.id;
      user.state = UserStates.czar;

      // Clear and cache the edition menu in order to re-populate it
      let editionMenu = $("#select-edition");
      editionMenu.empty();

      // Populate the edition selection menu
      for (let edition in response.editions) {
        editionMenu.append(`<option value="${edition}">${response.editions[edition]}</option>`);
      }

      for (let pack in response.packs) {
        addExpansionSelector(pack, response.packs[pack]);
      }

      console.debug("Created room #" + room.id);

      $("#room-setup-window").show();
      $("#user-setup-window").hide();

      room.link = window.location.href.split("?")[0] + "?room=" + room.id + "&token=" + room.token;
      window.history.pushState(null, null, room.link);

      populateChat(room.messages);
      populateUserList(users);

      setupSpinner.hide();
    });
  }
});

$("#start-game").click(() => {
  if (!room || !room.users) return console.error("Attempted to start game without a room ID");

  console.debug("Starting game...");

  $("#room-setup-window").hide();
  $("#user-setup-window").show();
  setupSpinner.show();

  let title = $("#settings-title");
  title.children("h1").text("Configuring Room...");
  title.children("p").text("Please wait a second.");
  title.show();

  let edition = $("#select-edition").val();
  let rotateCzar = $("#select-czar").val() == "rotate";

  socket.emit("roomSettings", {
    edition: edition,
    rotateCzar: rotateCzar,
    packs: expansionsSelected
  }, response => {
    setupSpinner.hide();

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

$("#room-link").click(() => {
  if (!room.link) return console.warn("Not in a room!");

  // Actually copy the link
  $("body").append(`<textarea id="fake-for-copy" readonly>${room.link}</textarea>`);
  let fake = $("#fake-for-copy")[0];
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

  let content = $("#chat-input").val().replace(/^\s+|\s+$/g, "");

  // 13 is the keycode for enter
  if (content.length > 0 && event.which === 13) {
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
  if (users[userId].state !== UserStates.czar) return console.warn("Recieved answersReady state despite not being czar!");
  $("#central-action").show().text("Read Answers");
});

socket.on("startReadingAnswers", (data) => {
  room.state = RoomStates.readingCards;
  let isCzar = users[userId].state === UserStates.czar;

  room.users.forEach(roomUserId => {
    if (users[roomUserId].state === UserStates.choosing) setUserState(roomUserId, UserStates.idle);
  });

  $("#cur-black-card").addClass("responses-shown");

  for (let i = 0; i < data.count; i++) {
    addResponseCard(i, isCzar);
  }
});

socket.on("revealResponse", (data) => {
  let cardElement = $("#response-card-" + data.position);
  cardElement.removeClass("back").addClass("front");
  cardElement.children(".card-text").text(data.card.text);
  cardElement.attr("id", "response-revealed-" + data.card.id);

  if (users[userId].state === UserStates.czar) {
    $("#response-revealed-" + data.card.id).off("click").on("click", event => {
      if (selectedCard) {
        $("#response-revealed-" + selectedCard).removeClass("selected-card");
      }
      $("#response-revealed-" + data.card.id).addClass("selected-card");
      selectedCard = data.card.id;

      $("#select-winner").show();
      $("#cur-black-card").addClass("czar-mode");
      console.debug("Selecting response #" + data.card.id);
      socket.emit("selectResponse", {cardId: data.card.id}, response => {
        if (response.error) return console.warn("Failed to select response:", response.error);
      });
    });
  }
});

socket.on("selectResponse", (data) => {
  $(".selected-card").removeClass("selected-card");
  if (data.cardId) $("#response-revealed-" + data.cardId).addClass("selected-card");
});

socket.on("selectWinner", (data) => {
  setUserScore(data.userId, users[data.userId].score + 1);

  room.users.forEach(roomUserId => {
    if (users[roomUserId].state === UserStates.inactive) return;
    setUserState(roomUserId, roomUserId === data.userId ? UserStates.winner : UserStates.idle);
  });

  room.state = RoomStates.viewingWinner;

  $("#cur-black-card").removeClass("responses-shown").removeClass("czar-mode");
  $("#select-winner").hide();
  $("#response-cards").empty();
  selectedCard = null;

  $("#cur-black-card").addClass("winner-shown");
  appendCard(data.card, $("#cur-black-card"));

  // Show the 'next round' button if we are the winner
  if (data.userId === userId) {
    $("#central-action").show().text("Next Round");
  }
});

socket.on("nextRound", (data) => {
  room.state = RoomStates.choosingCards;
  room.users.forEach(roomUserId => {
    if (users[roomUserId].state === UserStates.inactive) return;
    setUserState(roomUserId, roomUserId === data.czar ? UserStates.czar : UserStates.choosing);
  })

  $("#cur-black-card").removeClass("winner-shown");
  if (data.card) setBlackCard(data.card);
});

/********************
 * Card Interaction *
 ********************/


function appendCardBack(target, id, isWhite=true) {
  target.append(`
    <div class="card ${isWhite ? "white" : "black"} back" id="${id}">
      <div class="card-text">Cards Against Quarantine</div>
    </div>
  `);
}

function addResponseCard(id, isCzar) {
  appendCardBack($("#response-cards"), "response-card-" + id);

  // Only the czar can reveal answers
  if (isCzar) {
    $("#response-card-" + id).on("click", event => {
      socket.emit("revealResponse", {position: id}, response => {
        if (response.error) return console.warn("Failed to reveal respose #" + id + ":", response.error);
      });
    });
  }
}

function appendCard(card, target, isWhite=true) {
  let color = isWhite ? "white" : "black";
  let id = color + "-card-" + card.id;
  let html = `<div class="card ${color} front" id="${id}">`;
  if (card.draw || card.pick) {
    if (card.draw === 2) html += `<div class="special draw"></div>`;

    let pick = card.pick;
    if (pick > 1) {
      html += `<div class="special pick`;
      if (pick > 2) html += " pick-three";
      html += `"></div>`;
    }
  }
  target.append(html + `<div class="card-text">${card.text}</div></div>`);
}

// TODO: animate?
function addCardToDeck(card) {
  appendCard(card, $("#hand"));
  let cardElement = $("#white-card-" + card.id);
  cardElement.click(() => {
    if (users[userId].state !== UserStates.choosing || submittingCard) return;
    if (selectedCard) {
      $("#white-card-" + selectedCard).removeClass("selected-card");
    }
    cardElement.addClass("selected-card");
    selectedCard = card.id;
    $("#central-action").show().text("Submit Card");
  });
}

function addCardsToDeck(newCards) {
  for (let cardId in newCards) {
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
  if (!submittingCard && selectedCard && ($(event.target).is("#game-wrapper") || $(event.target).is("#hand") || $(event.target).is("#response-cards"))) {
    $("#white-card-" + selectedCard).removeClass("selected-card");
    $("#response-revealed-" + selectedCard).removeClass("selected-card");
    selectedCard = null;

    if (room.state === RoomStates.readingCards) {
      $("#select-winner").hide();
      $("#cur-black-card").removeClass("czar-mode");
      socket.emit("selectResponse", {cardId: null}, response => {
        if (response.error) return console.warn("Failed to deselect card:", response.error);
      });
    } else {
      $("#central-action").hide();
    }
  }
})

function submitCard() {
  $("#central-action").hide();
  if (selectedCard && !submittingCard) {
    submittingCard = true;
    let cardId = selectedCard;
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
    });
  }
}

$("#central-action").click(() => {
  let curState = users[userId].state;

  // Go to the next round if 'Next Round' button is shown
  if (room.state === RoomStates.viewingWinner) {
    if (curState !== UserStates.winner) {
      return console.warn("Non-winner tried to start next round!");
    }
    socket.emit("nextRound", {}, response => {
      if (response.error) return console.warn("Failed to start the next round:", response.error);
      $("#central-action").hide();
    });
    return;
  }


  if (curState === UserStates.czar) {
    socket.emit("startReadingAnswers", {}, response => {
      if (response.error) return console.warn("Failed to start reading answers:", response.error);
      $("#central-action").hide();
    });
  } else if (curState === UserStates.choosing) {
    submitCard();
  }
});

$("#select-winner").click(() => {
  if (users[userId].state === UserStates.czar && selectedCard) {
    socket.emit("selectWinner", {cardId: selectedCard}, response => {
      if (response.error) return console.warn("Failed to select winning card:", response.error);
    })
  }
});