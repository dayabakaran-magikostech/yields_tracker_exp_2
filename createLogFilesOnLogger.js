require("dotenv").config();
const { socket } = require("./socket");

function createLogFilesOnLoggerVM() {
	try {

		const instrument_quote_data = {
			bot: process.env.BOT_TAG,
			filename: "instrumentQuoteLogs",
			data: [
				"symbol",
				"instrument_token",
				"internal_timestamp",
				"timestamp",
				"last_trade_time",
				"last_price",
				"last_quantity",
				"buy_quantity",
				"sell_quantity",
				"volume",
				"average_price",
				"oi",
				"oi_day_high",
				"oi_day_low",
				"net_change",
				"ohlc_open",
				"ohlc_high",
				"ohlc_low",
				"ohlc_close",
				"bid_0_price",
				"bid_0_quantity",
				"bid_0_orders",
				"bid_1_price",
				"bid_1_quantity",
				"bid_1_orders",
				"bid_2_price",
				"bid_2_quantity",
				"bid_2_orders",
				"bid_3_price",
				"bid_3_quantity",
				"bid_3_orders",
				"bid_4_price",
				"bid_4_quantity",
				"bid_4_orders",
				"offer_0_price",
				"offer_0_quantity",
				"offer_0_orders",
				"offer_1_price",
				"offer_1_quantity",
				"offer_1_orders",
				"offer_2_price",
				"offer_2_quantity",
				"offer_2_orders",
				"offer_3_price",
				"offer_3_quantity",
				"offer_3_orders",
				"offer_4_price",
				"offer_4_quantity",
				"offer_4_orders"
			],
			type: "create_file",
		};

		socket.emit("data", instrument_quote_data);
	} catch (error) {
		console.log("Error occurred while creating log file on logger vm!");
	}
}

module.exports = {
	createLogFilesOnLoggerVM,
};