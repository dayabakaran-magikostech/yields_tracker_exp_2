require("dotenv").config();
const fs = require("fs");
const axios = require("axios");
const { createLogFilesOnLoggerVM } = require("./createLogFilesOnLogger.js");
const { createInstrumentQuoteLogs } = require("./logger.js");

/****************************************
 * CONFIG
 ****************************************/
const config = {
	synthDataLogs: [],
	synth_data_logs_sheet_name: "premium_watcher_exp_2",
	entryExitOrderLogs: [],
	logsFlusherInterval: 1000 * 60
};

const instrumentsSymbolMap = {};

const INSTRUMENTS_CSV_PATH = "./instruments.csv";

const activeExpiryIdentification = {
	"2026-04-07": { type: "weekly", tag: "current_weekly" },
	"2026-04-13": { type: "weekly", tag: "next_weekly" },
	"2026-04-21": { type: "weekly", tag: "next_2_weekly" },
	"2026-04-28": { type: "monthly", tag: "current_monthly" },
	"2026-05-26": { type: "monthly", tag: "next_monthly" },
};

const activeOrderRows = [
	{
		order_tag: "t2",
		instrument: 10427394,
		trading_symbol: "NIFTY2640722500CE",
		option_type: "CE",
		entry_transaction: "buy",
		expiry: "2026-04-07",
		expiry_type: "weekly",
		strike: 22500,
		entry_price: 805,
	},
	{
		order_tag: "t2",
		instrument: 10428162,
		trading_symbol: "NIFTY2640722500PE",
		option_type: "PE",
		entry_transaction: "sell",
		expiry: "2026-04-07",
		expiry_type: "weekly",
		strike: 22500,
		entry_price: 290,
	},
	{
		order_tag: "t2",
		instrument: 18544898,
		trading_symbol: "NIFTY26APR26000CE",
		option_type: "CE",
		entry_transaction: "sell",
		expiry: "2026-04-28",
		expiry_type: "monthly",
		strike: 26000,
		entry_price: 25,
	},
	{
		order_tag: "t2",
		instrument: 18548738,
		trading_symbol: "NIFTY26APR26000PE",
		option_type: "PE",
		entry_transaction: "buy",
		expiry: "2026-04-28",
		expiry_type: "monthly",
		strike: 26000,
		entry_price: 2851,
	},
];

const premiumScenarioObj = {
	exit: {
		label: "Premium for exit",
		buy_leg: {
			name: "monthly_close",
			expiry_source: "position",
			position_key: "monthly",
			synth_side: "buy",
			strike_source: "position",
		},
		sell_leg: {
			name: "weekly_close",
			expiry_source: "position",
			position_key: "weekly",
			synth_side: "sell",
			strike_source: "position",
		},
	},

	roll_weekly_1: {
		label: "Premium for rolling over 1 week",
		buy_leg: {
			name: "next_weekly_open",
			expiry_source: "expiry_tag",
			expiry_tag: "next_weekly",
			synth_side: "buy",
			strike_source: "synth_atm",
		},
		sell_leg: {
			name: "current_weekly_close",
			expiry_source: "position",
			position_key: "weekly",
			synth_side: "sell",
			strike_source: "position",
		},
	},

	roll_weekly_2: {
		label: "Premium for rolling over 2 weeks",
		buy_leg: {
			name: "next_2_weekly_open",
			expiry_source: "expiry_tag",
			expiry_tag: "next_2_weekly",
			synth_side: "buy",
			strike_source: "synth_atm",
		},
		sell_leg: {
			name: "current_weekly_close",
			expiry_source: "position",
			position_key: "weekly",
			synth_side: "sell",
			strike_source: "position",
		},
	},

	roll_monthly_next: {
		label: "Premium for rolling monthly to next month",
		buy_leg: {
			name: "current_monthly_close",
			expiry_source: "position",
			position_key: "monthly",
			synth_side: "buy",
			strike_source: "position",
		},
		sell_leg: {
			name: "next_monthly_open",
			expiry_source: "expiry_tag",
			expiry_tag: "next_monthly",
			synth_side: "sell",
			strike_source: "synth_atm",
		},
	},
};

/****************************************
 * HELPERS
 ****************************************/

async function addData(s_name, data, url, type = "create") {
	const requestData = {
		type,
		s_name,
		data,
	};

	try {
		const response = await axios.post(url, requestData, {
			headers: { "Content-Type": "application/json" },
		});

		if (response.status === 200 || response.status === 201) {
			return response.data;
		}

		console.error("Request failed with status code:", response.status);
		return false;
	} catch (error) {
		console.error(error);
		return false;
	}
}

async function gs_logs_flusher() {
	try {
		if (config.synthDataLogs.length > 0) {
			const data_to_upload = [];

			while (config.synthDataLogs.length > 0) {
				data_to_upload.push(config.synthDataLogs.shift());
			}

			await addData(
				config.synth_data_logs_sheet_name,
				data_to_upload,
				process.env.CRUD_MICROSERVICE_URL
			);

			console.log("Data added to sheet ...");
		}

		if (config.entryExitOrderLogs.length > 0) {
			const data_to_upload = [];

			while (config.entryExitOrderLogs.length > 0) {
				data_to_upload.push(config.entryExitOrderLogs.shift());
			}

			console.log("Entry/Exit data added to sheet ...");
		}
	} catch (error) {
		console.log("Error occurred in gs_logs_flusher(): ", error.stack);
	}
}

function isValidNumber(val) {
	return typeof val === "number" && !Number.isNaN(val);
}

function roundTo(num, places = 2) {
	if (!isValidNumber(num)) return null;
	return Number(num.toFixed(places));
}

function detectDelimiter(text) {
	const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") || "";
	const tabCount = (firstLine.match(/\t/g) || []).length;
	const commaCount = (firstLine.match(/,/g) || []).length;
	return tabCount >= commaCount ? "\t" : ",";
}

function parseSimpleDelimitedFile(text) {
	const delimiter = detectDelimiter(text);
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return [];

	const headers = lines[0].split(delimiter).map((h) => h.trim());

	return lines.slice(1).map((line) => {
		const parts = line.split(delimiter);
		const row = {};
		headers.forEach((header, idx) => {
			row[header] = (parts[idx] || "").trim();
		});
		return row;
	});
}

function toNumberOrNull(val) {
	if (val === "" || val == null) return null;
	const num = Number(val);
	return Number.isNaN(num) ? null : num;
}

function normalizeDate(val) {
	return String(val || "").trim();
}

function generateQuoteUrl(instrumentArr) {
	try {
		if (!Array.isArray(instrumentArr) || instrumentArr.length === 0) return "";
		let urlResponse = `?i=${instrumentArr[0]}`;
		for (let k = 1; k < instrumentArr.length; k++) {
			urlResponse += `&i=${instrumentArr[k]}`;
		}
		return urlResponse;
	} catch (error) {
		console.error("Error:", error.message);
		return "";
	}
}

async function getQuotes(api_key, access_token, quote_url) {
	try {
		const { data: response } = await axios.get(
			`https://api.kite.trade/quote${quote_url}`,
			{
				headers: {
					"X-Kite-Version": "3",
					Authorization: "token " + api_key + ":" + access_token,
				},
			}
		);
		const data = response["data"];
		return { status: true, data };
	} catch (error) {
		console.error("getQuotes() failed:", error.response?.data || error.message);
		return { status: false };
	}
}

function buildExpiryTagMap(expiryIdentificationObj) {
	const tagMap = {};
	for (const expiry of Object.keys(expiryIdentificationObj)) {
		const meta = expiryIdentificationObj[expiry];
		if (meta?.tag) {
			tagMap[meta.tag] = expiry;
		}
	}
	return tagMap;
}

function buildActivePositionObject(orderRows) {
	if (!Array.isArray(orderRows) || orderRows.length === 0) {
		throw new Error("activeOrderRows is empty");
	}

	const orderTag = String(orderRows[0].order_tag || "").trim();
	const activePositionObj = {
		order_tag: orderTag,
		positions: {
			weekly: null,
			monthly: null,
		},
	};

	for (const row of orderRows) {
		const expiryType = String(row.expiry_type || "").trim().toLowerCase();
		const optionType = String(row.option_type || "").trim().toUpperCase();
		const entryTransaction = String(row.entry_transaction || "").trim().toLowerCase();

		if (!["weekly", "monthly"].includes(expiryType)) continue;
		if (!["CE", "PE"].includes(optionType)) continue;

		if (!activePositionObj.positions[expiryType]) {
			activePositionObj.positions[expiryType] = {
				expiry: String(row.expiry || "").trim(),
				expiry_type: expiryType,
				synth_side: null,
				strike: Number(row.strike),
				ce: null,
				pe: null,
			};
		}

		const pos = activePositionObj.positions[expiryType];

		if (pos.expiry !== String(row.expiry || "").trim()) {
			throw new Error(`Multiple ${expiryType} expiries found in active orders`);
		}
		if (Number(pos.strike) !== Number(row.strike)) {
			throw new Error(`Multiple ${expiryType} strikes found in active orders`);
		}

		const legObj = {
			trading_symbol: String(row.trading_symbol || "").trim(),
			instrument_token: Number(row.instrument),
			entry_transaction: entryTransaction,
			entry_price: Number(row.entry_price),
		};

		if (optionType === "CE") {
			if (pos.ce) throw new Error(`Duplicate CE leg in active ${expiryType} position`);
			pos.ce = legObj;
		} else {
			if (pos.pe) throw new Error(`Duplicate PE leg in active ${expiryType} position`);
			pos.pe = legObj;
		}
	}

	// infer synth side from current legs
	for (const key of ["weekly", "monthly"]) {
		const pos = activePositionObj.positions[key];
		if (!pos) continue;
		if (!pos.ce || !pos.pe) {
			throw new Error(`Incomplete active ${key} position`);
		}

		if (pos.ce.entry_transaction === "buy" && pos.pe.entry_transaction === "sell") {
			pos.synth_side = "buy";
		}
		else if (pos.ce.entry_transaction === "sell" && pos.pe.entry_transaction === "buy") {
			pos.synth_side = "sell";
		}
		else {
			throw new Error(`Invalid active ${key} synth combination`);
		}
	}

	return activePositionObj;
}

function calculatePremiumAtStrike(expiryObj, strike, synthSide, indexPrice) {
	const numericStrike = Number(strike);
	if (!isValidNumber(numericStrike)) {
		return {
			strike: null,
			synth_side: synthSide,
			ce_price_used: null,
			pe_price_used: null,
			synth_fut: null,
			premium: null,
			ce_trading_symbol: null,
			pe_trading_symbol: null,
		};
	}

	const strikeData = expiryObj.optChain[numericStrike];
	const ce = strikeData?.CE;
	const pe = strikeData?.PE;

	if (!ce || !pe) {
		return {
			strike: numericStrike,
			synth_side: synthSide,
			ce_price_used: null,
			pe_price_used: null,
			synth_fut: null,
			premium: null,
			ce_trading_symbol: ce?.tradingsymbol || null,
			pe_trading_symbol: pe?.tradingsymbol || null,
		};
	}

	let cePrice = null;
	let pePrice = null;

	if (synthSide === "buy") {
		cePrice = ce.prices?.offer ?? null;
		pePrice = pe.prices?.bid ?? null;
	}
	else if (synthSide === "sell") {
		cePrice = ce.prices?.bid ?? null;
		pePrice = pe.prices?.offer ?? null;
	}
	else {
		throw new Error(`Invalid synthSide: ${synthSide}`);
	}

	const synthFut =
		isValidNumber(cePrice) && isValidNumber(pePrice)
			? roundTo(numericStrike + cePrice - pePrice)
			: null;

	const premium =
		isValidNumber(synthFut) && isValidNumber(indexPrice)
			? roundTo(synthFut - indexPrice)
			: null;

	return {
		expiry: expiryObj.expiry,
		expiry_type: expiryObj.expiry_type,
		expiry_tag: expiryObj.expiry_tag,
		strike: numericStrike,
		synth_side: synthSide,
		ce_price_used: isValidNumber(cePrice) ? cePrice : null,
		pe_price_used: isValidNumber(pePrice) ? pePrice : null,
		synth_fut: synthFut,
		premium: premium,
		ce_trading_symbol: ce.tradingsymbol || null,
		pe_trading_symbol: pe.tradingsymbol || null,
	};
}

function resolveScenarioLeg(legConfig, marketObj, activePositionObj, expiryTagMap) {
	let resolvedExpiry = null;
	let resolvedStrike = null;
	let sourcePosition = null;

	if (legConfig.expiry_source === "position") {
		sourcePosition = activePositionObj.positions[legConfig.position_key];
		if (!sourcePosition) throw new Error(`Position not found: ${legConfig.position_key}`);
		resolvedExpiry = sourcePosition.expiry;
	}
	else if (legConfig.expiry_source === "expiry_tag") {
		resolvedExpiry = expiryTagMap[legConfig.expiry_tag];
		if (!resolvedExpiry) throw new Error(`Expiry tag not found: ${legConfig.expiry_tag}`);
	}
	else {
		throw new Error(`Invalid expiry_source: ${legConfig.expiry_source}`);
	}

	const expiryObj = marketObj.expiries[resolvedExpiry];
	if (!expiryObj) {
		throw new Error(`Resolved expiry not active/built: ${resolvedExpiry}`);
	}

	if (legConfig.strike_source === "position") {
		if (!sourcePosition) {
			sourcePosition = activePositionObj.positions[legConfig.position_key];
		}
		if (!sourcePosition) throw new Error(`Position not found for strike: ${legConfig.position_key}`);
		resolvedStrike = sourcePosition.strike;
	}
	else if (legConfig.strike_source === "synth_atm") {
		resolvedStrike = expiryObj.synthAtmStrike;
	}
	else {
		throw new Error(`Invalid strike_source: ${legConfig.strike_source}`);
	}

	const premiumData = calculatePremiumAtStrike(
		expiryObj,
		resolvedStrike,
		legConfig.synth_side,
		marketObj.index.price.ltp
	);

	const ceActionNow = legConfig.synth_side === "buy" ? "buy" : "sell";
	const peActionNow = legConfig.synth_side === "buy" ? "sell" : "buy";

	return {
		name: legConfig.name,
		expiry_source: legConfig.expiry_source,
		expiry_tag: legConfig.expiry_tag || null,
		position_key: legConfig.position_key || null,

		ce_orig_entry_price: sourcePosition?.ce?.entry_price ?? null,
		pe_orig_entry_price: sourcePosition?.pe?.entry_price ?? null,

		ce_orig_entry_transaction: sourcePosition?.ce?.entry_transaction ?? null,
		pe_orig_entry_transaction: sourcePosition?.pe?.entry_transaction ?? null,

		ce_action_now: ceActionNow,
		pe_action_now: peActionNow,

		...premiumData,
	};
}

function evaluateScenario(caseKey, scenarioObj, marketObj, activePositionObj, expiryTagMap) {
	const buyLeg = resolveScenarioLeg(
		scenarioObj.buy_leg,
		marketObj,
		activePositionObj,
		expiryTagMap
	);

	const sellLeg = resolveScenarioLeg(
		scenarioObj.sell_leg,
		marketObj,
		activePositionObj,
		expiryTagMap
	);

	const premiumDifference =
		isValidNumber(sellLeg.premium) && isValidNumber(buyLeg.premium)
			? roundTo(sellLeg.premium - buyLeg.premium)
			: null;

	return {
		order_tag: activePositionObj.order_tag,
		case_key: caseKey,
		case_label: scenarioObj.label,

		buy_leg_name: buyLeg.name,
		buy_expiry: buyLeg.expiry,
		buy_expiry_type: buyLeg.expiry_type,
		buy_expiry_tag: buyLeg.expiry_tag,
		buy_strike: buyLeg.strike,
		buy_strike_source: scenarioObj.buy_leg.strike_source,
		buy_synth_side: buyLeg.synth_side,

		buy_ce_trading_symbol: buyLeg.ce_trading_symbol,
		buy_ce_orig_entry_transaction: buyLeg.ce_orig_entry_transaction,
		buy_ce_orig_entry_price: buyLeg.ce_orig_entry_price,
		buy_ce_action_now: buyLeg.ce_action_now,
		buy_ce_price_used_now: buyLeg.ce_price_used,

		buy_pe_trading_symbol: buyLeg.pe_trading_symbol,
		buy_pe_orig_entry_transaction: buyLeg.pe_orig_entry_transaction,
		buy_pe_orig_entry_price: buyLeg.pe_orig_entry_price,
		buy_pe_action_now: buyLeg.pe_action_now,
		buy_pe_price_used_now: buyLeg.pe_price_used,

		buy_synth_fut: buyLeg.synth_fut,
		buy_premium: buyLeg.premium,

		sell_leg_name: sellLeg.name,
		sell_expiry: sellLeg.expiry,
		sell_expiry_type: sellLeg.expiry_type,
		sell_expiry_tag: sellLeg.expiry_tag,
		sell_strike: sellLeg.strike,
		sell_strike_source: scenarioObj.sell_leg.strike_source,
		sell_synth_side: sellLeg.synth_side,

		sell_ce_trading_symbol: sellLeg.ce_trading_symbol,
		sell_ce_orig_entry_transaction: sellLeg.ce_orig_entry_transaction,
		sell_ce_orig_entry_price: sellLeg.ce_orig_entry_price,
		sell_ce_action_now: sellLeg.ce_action_now,
		sell_ce_price_used_now: sellLeg.ce_price_used,

		sell_pe_trading_symbol: sellLeg.pe_trading_symbol,
		sell_pe_orig_entry_transaction: sellLeg.pe_orig_entry_transaction,
		sell_pe_orig_entry_price: sellLeg.pe_orig_entry_price,
		sell_pe_action_now: sellLeg.pe_action_now,
		sell_pe_price_used_now: sellLeg.pe_price_used,

		sell_synth_fut: sellLeg.synth_fut,
		sell_premium: sellLeg.premium,

		premium_difference: premiumDifference,
	};
}

function evaluateAllScenarios(premiumScenarioObj, marketObj, activePositionObj, expiryTagMap) {
	const rows = [];

	for (const caseKey of Object.keys(premiumScenarioObj)) {
		const row = evaluateScenario(
			caseKey,
			premiumScenarioObj[caseKey],
			marketObj,
			activePositionObj,
			expiryTagMap
		);
		rows.push(row);
	}

	return rows;
}

/****************************************
 * EXPIRY OBJECT HELPERS
 ****************************************/
function createExpiryObject(expiry, expiryMeta) {
	return {
		expiry,
		expiry_type: expiryMeta.type || null,
		expiry_tag: expiryMeta.tag || null,

		strikesArr: [],
		instrumentsSet: new Set(),
		instrumentsArr: [],
		quoteUrlString: "",

		atmStrike: null,
		atmStrike100: null,
		synthAtmStrike: null,

		synth_fut_normal: null,
		synth_fut_buy: null,
		synth_fut_sell: null,

		premium_buy: null,
		premium_sell: null,

		optChain: {},
	};
}

function createOptionLeg(row) {
	return {
		tradingsymbol: String(row.tradingsymbol || "").trim(),
		instrument_type: String(row.instrument_type || "").trim().toUpperCase(),
		strike: Number(row.strike),
		expiry: normalizeDate(row.expiry),
		instrument_token: Number(row.instrument_token),
		lot_size: toNumberOrNull(row.lot_size),
		exchange_token: toNumberOrNull(row.exchange_token),
		index_name: String(row.index_name || "").trim(),
		tick_size: toNumberOrNull(row.tick_size),
		prices: {
			ltp: null,
			bid: null,
			offer: null,
		},
	};
}

function getStrikeData(expiryObj, strike) {
	return expiryObj.optChain[strike];
}

function sortStrikes(expiryObj) {
	expiryObj.strikesArr.sort((a, b) => a - b);
}

function getNearestStrikeFromArray(target, numArr) {
	if (typeof target !== "number" || Number.isNaN(target)) return null;
	if (!Array.isArray(numArr) || numArr.length === 0) return null;

	let left = 0;
	let right = numArr.length - 1;
	let closestNumber = null;
	let closestIndex = -1;

	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
		const currentNumber = numArr[mid];

		if (currentNumber === target) {
			return { index: mid, value: currentNumber };
		}

		if (
			closestNumber === null ||
			Math.abs(target - currentNumber) < Math.abs(target - closestNumber)
		) {
			closestNumber = currentNumber;
			closestIndex = mid;
		}

		if (currentNumber < target) {
			left = mid + 1;
		} else {
			right = mid - 1;
		}
	}

	return closestNumber === null ? null : { index: closestIndex, value: closestNumber };
}

function getNearestStrike(expiryObj, target) {
	return getNearestStrikeFromArray(target, expiryObj.strikesArr);
}

function getNearestStrikeMultipleOf100(expiryObj, target) {
	if (typeof target !== "number" || Number.isNaN(target)) return null;
	const strikeArr100 = expiryObj.strikesArr.filter((strike) => strike % 100 === 0);
	return getNearestStrikeFromArray(target, strikeArr100);
}

function getAtmStrike(expiryObj, indexPrice) {
	if (typeof indexPrice !== "number" || Number.isNaN(indexPrice)) return null;
	const atmStrike = getNearestStrike(expiryObj, indexPrice);
	if (atmStrike === null) return null;
	return atmStrike.value;
}

function getAtmStrikeMultipleOf100(expiryObj, indexPrice) {
	if (typeof indexPrice !== "number" || Number.isNaN(indexPrice)) return null;
	const atmStrike = getNearestStrikeMultipleOf100(expiryObj, indexPrice);
	if (atmStrike === null) return null;
	return atmStrike.value;
}

function calculateSynthFut(expiryObj, indexPrice) {
	expiryObj.atmStrike = getAtmStrike(expiryObj, indexPrice);
	expiryObj.atmStrike100 = getAtmStrikeMultipleOf100(expiryObj, indexPrice);

	expiryObj.synth_fut_normal = null;
	expiryObj.synth_fut_buy = null;
	expiryObj.synth_fut_sell = null;
	expiryObj.synthAtmStrike = null;

	if (!isValidNumber(expiryObj.atmStrike100)) {
		return;
	}

	const strikeData = getStrikeData(expiryObj, expiryObj.atmStrike100);
	const ce = strikeData?.CE;
	const pe = strikeData?.PE;

	if (!ce || !pe) {
		return;
	}

	const ceLtp = ce.prices?.ltp;
	const ceOffer = ce.prices?.offer;
	const ceBid = ce.prices?.bid;

	const peLtp = pe.prices?.ltp;
	const peOffer = pe.prices?.offer;
	const peBid = pe.prices?.bid;

	// Normal synth using LTP
	expiryObj.synth_fut_normal =
		isValidNumber(ceLtp) && isValidNumber(peLtp)
			? roundTo(expiryObj.atmStrike100 + ceLtp - peLtp)
			: null;

	// Buy synth => CE buy at offer, PE sell at bid
	expiryObj.synth_fut_buy =
		isValidNumber(ceOffer) && isValidNumber(peBid)
			? roundTo(expiryObj.atmStrike100 + ceOffer - peBid)
			: null;

	// Sell synth => CE sell at bid, PE buy at offer
	expiryObj.synth_fut_sell =
		isValidNumber(ceBid) && isValidNumber(peOffer)
			? roundTo(expiryObj.atmStrike100 + ceBid - peOffer)
			: null;

	// synthAtmStrike = nearest available strike MULTIPLE OF 100 to normal synth fut
	if (isValidNumber(expiryObj.synth_fut_normal)) {
		const nearestSynthStrike = getNearestStrikeMultipleOf100(
			expiryObj,
			expiryObj.synth_fut_normal
		);
		expiryObj.synthAtmStrike = nearestSynthStrike ? nearestSynthStrike.value : null;
	}
}

function calculatePremium(expiryObj, indexPrice) {
	calculateSynthFut(expiryObj, indexPrice);

	expiryObj.premium_buy =
		isValidNumber(expiryObj.synth_fut_buy) && isValidNumber(indexPrice)
			? roundTo(expiryObj.synth_fut_buy - indexPrice)
			: null;

	expiryObj.premium_sell =
		isValidNumber(expiryObj.synth_fut_sell) && isValidNumber(indexPrice)
			? roundTo(expiryObj.synth_fut_sell - indexPrice)
			: null;
}

function updateIndexPrices(marketObj, quoteData) {
	const indexTokenKey = String(marketObj.index.instrument_token);
	const quote = quoteData[indexTokenKey];
	if (!quote) return;

	marketObj.index.price.ltp = isValidNumber(Number(quote.last_price))
		? Number(quote.last_price)
		: null;

	marketObj.index.price.bid =
		quote.depth?.buy?.[0]?.price != null ? Number(quote.depth.buy[0].price) : null;

	marketObj.index.price.offer =
		quote.depth?.sell?.[0]?.price != null ? Number(quote.depth.sell[0].price) : null;
}

function updateExpiryPricesFromQuotes(expiryObj, quoteData) {
	for (const strike of expiryObj.strikesArr) {
		const strikeData = expiryObj.optChain[strike];
		if (!strikeData) continue;

		for (const optionType of ["CE", "PE"]) {
			const leg = strikeData[optionType];
			if (!leg) continue;

			const tokenKey = String(leg.instrument_token);
			const quote = quoteData[tokenKey];
			if (!quote) continue;

			leg.prices.ltp = isValidNumber(Number(quote.last_price))
				? Number(quote.last_price)
				: null;

			leg.prices.bid =
				quote.depth?.buy?.[0]?.price != null ? Number(quote.depth.buy[0].price) : null;

			leg.prices.offer =
				quote.depth?.sell?.[0]?.price != null ? Number(quote.depth.sell[0].price) : null;
		}
	}
}

/****************************************
 * BUILD MARKET OBJECT
 ****************************************/
function buildMarketObjectFromRows(rows, expiryIdentificationObj) {
	const marketObj = {
		index: {
			name: null,
			instrument_token: null,
			exchange_token: null,
			price: {
				ltp: null,
				bid: null,
				offer: null,
			},
		},
		expiryIdentification: expiryIdentificationObj,
		expiries: {},
	};

	for (const rawRow of rows) {
		const instrument_type = String(rawRow.instrument_type || "").trim().toUpperCase();
		instrumentsSymbolMap[rawRow.instrument_token] = rawRow.tradingsymbol;

		if (instrument_type === "INDEX") {
			marketObj.index.name = String(rawRow.index_name || rawRow.tradingsymbol || "").trim();
			marketObj.index.instrument_token = Number(rawRow.instrument_token);
			marketObj.index.exchange_token = toNumberOrNull(rawRow.exchange_token);
			continue;
		}

		if (instrument_type !== "CE" && instrument_type !== "PE") {
			continue; // ignore FUT for now
		}

		const expiry = normalizeDate(rawRow.expiry);
		if (!expiryIdentificationObj[expiry]) {
			continue; // only active expiries
		}

		if (!marketObj.expiries[expiry]) {
			marketObj.expiries[expiry] = createExpiryObject(
				expiry,
				expiryIdentificationObj[expiry]
			);
		}

		const expiryObj = marketObj.expiries[expiry];
		const strike = Number(rawRow.strike);

		if (!isValidNumber(strike)) {
			continue;
		}

		if (!expiryObj.optChain[strike]) {
			expiryObj.optChain[strike] = { CE: null, PE: null };
			expiryObj.strikesArr.push(strike);
		}

		const leg = createOptionLeg(rawRow);

		if (expiryObj.optChain[strike][instrument_type]) {
			throw new Error(
				`Duplicate ${instrument_type} found for expiry=${expiry}, strike=${strike}`
			);
		}

		expiryObj.optChain[strike][instrument_type] = leg;
		expiryObj.instrumentsSet.add(String(leg.instrument_token));
	}

	if (!marketObj.index.instrument_token) {
		throw new Error("INDEX row not found in csv");
	}

	for (const expiry of Object.keys(marketObj.expiries)) {
		const expiryObj = marketObj.expiries[expiry];
		sortStrikes(expiryObj);

		expiryObj.instrumentsArr = [
			String(marketObj.index.instrument_token),
			...Array.from(expiryObj.instrumentsSet),
		];

		expiryObj.quoteUrlString = generateQuoteUrl(expiryObj.instrumentsArr);
	}

	return marketObj;
}

function buildMarketObjectFromCsv(csvPath, expiryIdentificationObj) {
	const text = fs.readFileSync(csvPath, "utf8");
	const rows = parseSimpleDelimitedFile(text);
	return buildMarketObjectFromRows(rows, expiryIdentificationObj);
}

function getCurrTimeStamp() {
	const currentDate = new Date();
	const year = currentDate.getFullYear();
	const month = padZero(currentDate.getMonth() + 1);
	const day = padZero(currentDate.getDate());
	const hours = padZero(currentDate.getHours());
	const minutes = padZero(currentDate.getMinutes());
	const seconds = padZero(currentDate.getSeconds());
	const milliseconds = padZero2(currentDate.getMilliseconds());

	const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
	return formattedDate;
}

function padZero(number) {
	return number.toString().padStart(2, "0");
}
function padZero2(number) {
	return number.toString().padStart(3, "0");
}

/****************************************
 * REFRESH / CALCULATE
 ****************************************/
function createQuoteLogs(quoteData) {
	const current_time = getCurrTimeStamp();
	Object.keys(quoteData).forEach((key) => {
		const symbol = instrumentsSymbolMap[key];
		createInstrumentQuoteLogs(quoteData[key], current_time, symbol);
	});
}

async function refreshSingleExpiry(marketObj, expiry, apiKey, accessToken) {
	const expiryObj = marketObj.expiries[expiry];
	if (!expiryObj) {
		throw new Error(`Expiry not found or not active: ${expiry}`);
	}

	const quotesRes = await getQuotes(apiKey, accessToken, expiryObj.quoteUrlString);
	if (!quotesRes.status) {
		throw new Error(`Failed to fetch quotes for expiry ${expiry}`);
	}

	createQuoteLogs(quotesRes.data);
	updateIndexPrices(marketObj, quotesRes.data);
	updateExpiryPricesFromQuotes(expiryObj, quotesRes.data);

	const indexPrice = marketObj.index.price.ltp;
	calculatePremium(expiryObj, indexPrice);

	return expiryObj;
}

async function refreshAllActiveExpiries(marketObj, apiKey, accessToken) {
	for (const expiry of Object.keys(marketObj.expiries)) {
		await refreshSingleExpiry(marketObj, expiry, apiKey, accessToken);
	}
	return marketObj;
}

/****************************************
 * MAIN
 ****************************************/
async function main() {
	try {
		const marketObj = buildMarketObjectFromCsv(
			INSTRUMENTS_CSV_PATH,
			activeExpiryIdentification
		);

		const activePositionObj = buildActivePositionObject(activeOrderRows);
		const expiryTagMap = buildExpiryTagMap(activeExpiryIdentification);

		await refreshAllActiveExpiries(
			marketObj,
			process.env.KITE_API_KEY,
			process.env.KITE_ACCESS_TOKEN
		);

		console.log("\nIndex:");
		console.dir(marketObj.index, { depth: null });

		console.log("\nPer-expiry market snapshot:");
		for (const expiry of Object.keys(marketObj.expiries)) {
			const obj = marketObj.expiries[expiry];
			console.dir(
				{
					expiry,
					expiry_type: obj.expiry_type,
					expiry_tag: obj.expiry_tag,
					atmStrike: obj.atmStrike,
					atmStrike100: obj.atmStrike100,
					synthAtmStrike: obj.synthAtmStrike,
					synth_fut_normal: obj.synth_fut_normal,
					synth_fut_buy: obj.synth_fut_buy,
					synth_fut_sell: obj.synth_fut_sell,
					premium_buy: obj.premium_buy,
					premium_sell: obj.premium_sell,
				},
				{ depth: null }
			);
		}

		const strategyRows = evaluateAllScenarios(
			premiumScenarioObj,
			marketObj,
			activePositionObj,
			expiryTagMap
		);

		// console.log("\nStrategy premium rows:");
		// console.table(
		// 	strategyRows.map((r) => ({
		// 		case_key: r.case_key,

		// 		buy_expiry: r.buy_expiry,
		// 		buy_strike: r.buy_strike,
		// 		buy_ce_orig_entry_price: r.buy_ce_orig_entry_price,
		// 		buy_ce_action_now: r.buy_ce_action_now,
		// 		buy_ce_price_used_now: r.buy_ce_price_used_now,
		// 		buy_pe_orig_entry_price: r.buy_pe_orig_entry_price,
		// 		buy_pe_action_now: r.buy_pe_action_now,
		// 		buy_pe_price_used_now: r.buy_pe_price_used_now,
		// 		buy_premium: r.buy_premium,

		// 		sell_expiry: r.sell_expiry,
		// 		sell_strike: r.sell_strike,
		// 		sell_ce_orig_entry_price: r.sell_ce_orig_entry_price,
		// 		sell_ce_action_now: r.sell_ce_action_now,
		// 		sell_ce_price_used_now: r.sell_ce_price_used_now,
		// 		sell_pe_orig_entry_price: r.sell_pe_orig_entry_price,
		// 		sell_pe_action_now: r.sell_pe_action_now,
		// 		sell_pe_price_used_now: r.sell_pe_price_used_now,
		// 		sell_premium: r.sell_premium,

		// 		premium_difference: r.premium_difference,
		// 	}))
		// );

		// if you want to log each case as one sheet row later:
		config.synthDataLogs.push(...strategyRows);
		gs_logs_flusher();

		console.log("\nFull strategy rows:");
		for (const row of strategyRows) {
			console.dir(row, { depth: null });
		}

	} catch (error) {
		console.error(error.stack);
	}
};

/****************************************
 * RUN
 ****************************************/
(async () => {
	try {
		createLogFilesOnLoggerVM();
		main();
		config.logsFlusherInterval = setInterval(main, config.logsFlusherInterval);
	} catch (error) {
		console.error(error);
	}
})();