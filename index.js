const express = require("express");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});