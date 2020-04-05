// A selection of Font Awesome icons suitable for profile pictures
exports.Icons = ["apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish", "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw", "pepper-hot", "pizza-slice", "spider"];

// Contains the same packs as the database, but this is quicker to access for validation
exports.Packs = [ "RED", "BLUE", "GREEN", "ABSURD", "BOX", "PROC", "RETAIL", "FANTASY", "PERIOD", "COLLEGE", "ASS", "2012-HOL", "2013-HOL", "2014-HOL", "90s", "GEEK", "SCIFI", "WWW", "SCIENCE", "FOOD", "WEED", "TRUMP", "DAD", "PRIDE", "THEATRE", "2000s", "HIDDEN", "JEW", "CORONA" ];

// The number of white cards in a standard CAH hand
exports.HandSize = 7;

exports.UserStates = Object.freeze({
  "idle": 1,          // The user is idle
  "choosing": 2,      // The user is selecting a white card
  "czar": 3,          // The user is the card czar
  "inactive": 4       // The user has left their game
});

exports.RoomStates = Object.freeze({
  "new": 1,           // The room has been created but not set up
  "choosingCards": 2, // Players are chosing responses
  "readingCards": 3   // The czar is reading responses
});

exports.CardStates = Object.freeze({
  "hand": 1,          // The card is in a players hand
  "selected": 2,      // The card has been submitted
  "revealed": 3,      // The card has been flipped over and read
  "played": 4         // The card has been removed from play
});