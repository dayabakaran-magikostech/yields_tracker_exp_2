require("dotenv").config();
const { socket } = require("./socket");

function createInstrumentQuoteLogs(quoteData, internal_timestamp, symbol) {
	try {
		const {
			instrument_token,
			last_price,
			last_quantity,
			average_price,
			volume,
			buy_quantity,
			sell_quantity,
			net_change,
			last_trade_time,
			timestamp,
			oi,
			oi_day_high,
			oi_day_low,
			depth: {
				buy: [
					{ quantity: bid_qty, price: bid_price, orders: bid_orders } = {},
					{ quantity: bid_qty_2, price: bid_price_2, orders: bid_orders_2 } = {},
					{ quantity: bid_qty_3, price: bid_price_3, orders: bid_orders_3 } = {},
					{ quantity: bid_qty_4, price: bid_price_4, orders: bid_orders_4 } = {},
					{ quantity: bid_qty_5, price: bid_price_5, orders: bid_orders_5 } = {},
				] = [],
				sell: [
					{ quantity: offer_qty, price: offer_price, orders: offer_orders } = {},
					{ quantity: offer_qty_2, price: offer_price_2, orders: offer_orders_2, } = {},
					{ quantity: offer_qty_3, price: offer_price_3, orders: offer_orders_3, } = {},
					{ quantity: offer_qty_4, price: offer_price_4, orders: offer_orders_4, } = {},
					{ quantity: offer_qty_5, price: offer_price_5, orders: offer_orders_5, } = {},
				] = [],
			} = {},
			ohlc: { open, high, low, close } = {},
		} = quoteData;

		const dataObj = {
			bot: process.env.BOT_TAG,
			filename: "instrumentQuoteLogs",
			type: "add_log",
			data: [
				symbol,
				instrument_token,
				internal_timestamp,
				timestamp,
				last_trade_time,
				last_price,
				last_quantity,
				buy_quantity,
				sell_quantity,
				volume,
				average_price,
				oi,
				oi_day_high,
				oi_day_low,
				net_change,
				open,
				high,
				low,
				close,
				bid_price,
				bid_qty,
				bid_orders,
				bid_price_2,
				bid_qty_2,
				bid_orders_2,
				bid_price_3,
				bid_qty_3,
				bid_orders_3,
				bid_price_4,
				bid_qty_4,
				bid_orders_4,
				bid_price_5,
				bid_qty_5,
				bid_orders_5,
				offer_price,
				offer_qty,
				offer_orders,
				offer_price_2,
				offer_qty_2,
				offer_orders_2,
				offer_price_3,
				offer_qty_3,
				offer_orders_3,
				offer_price_4,
				offer_qty_4,
				offer_orders_4,
				offer_price_5,
				offer_qty_5,
				offer_orders_5
			],
		};

		socket.emit("data", dataObj);
	}
	catch (error) {
		console.log("Error occurred while creating tick log: \n", error.stack);
	}
}

module.exports = {
	createInstrumentQuoteLogs
};