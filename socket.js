require("dotenv").config();
const io = require("socket.io-client");
const socket = io(process.env.LOGGER_VM_SOCKET_URL);

module.exports = {
	socket,
};