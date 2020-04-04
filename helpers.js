/*******************
 * Data Validation *
 *******************/

exports.validateHash = (hash, length) => {
  return typeof hash === "string" && hash.length === length;
}

exports.validateUInt = (uint) => {
  return typeof uint === "number" && uint % 1 === 0 && uint >= 0;
}

exports.validateBoolean = (boolean) => {
  return typeof boolean === "boolean";
}

exports.validateString = (string) => {
  return typeof string === "string" && string.length > 0;
}

/*******************
 * General Helpers *
 *******************/

// generate a random hash
exports.makeHash = (length) => {
  var result = "";
  var hexChars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (var i = 0; i < length; i += 1) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }
  return result;
}

// Replace </> characters with 'safe' encoded counterparts
exports.stripHTML = (string) => {
  return string.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}