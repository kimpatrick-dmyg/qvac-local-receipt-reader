import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadModel,
  ocr,
  OCR_LATIN,
  MODEL_TYPES,
  unloadModel
} from "@qvac/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Keep uploaded receipt in memory.
// The image is NOT saved to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.use(express.static(path.join(__dirname, "public")));

/*
  Clean individual OCR lines
*/
function cleanLine(line) {
  if (typeof line !== "string") {
    return "";
  }

  return line
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/*
  Convert QVAC OCR blocks into clean lines
*/
function getCleanLines(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const lines = [];

  for (const block of blocks) {
    if (!block || typeof block.text !== "string") {
      continue;
    }

    const blockLines = block.text
      .split("\n")
      .map(cleanLine)
      .filter(Boolean);

    lines.push(...blockLines);
  }

  // Remove duplicated consecutive lines
  const result = [];

  for (const line of lines) {
    if (result[result.length - 1] !== line) {
      result.push(line);
    }
  }

  return result;
}

/*
  Check if a line looks like OCR garbage.
*/
function isGarbageLine(line) {
  if (!line) {
    return true;
  }

  const value = line.trim();

  if (
    value.length <= 1 &&
    !/[0-9]/.test(value)
  ) {
    return true;
  }

  const garbagePatterns = [
    /^OTH/i,
    /^ZlOd/i,
    /^OTK/i,
    /^photocofy/i,
    /^stc$/i,
    /^idlDo/i,
    /^3nnn/i,
    /^bnd@/i,
    /^fIDD/i
  ];

  return garbagePatterns.some(pattern => pattern.test(value));
}

/*
  Detect receipt labels.
*/
function isLabelLine(line) {
  const labels = [
    "DATE",
    "BUSINESS STYLE",
    "TIN",
    "ADDRESS",
    "THE SUM OF",
    "ACCOUNT OF",
    "IN PAYMENT OF",
    "PAYMENT FOR",
    "ID NO",
    "SALES",
    "SERVICES",
    "SIGNATURE",
    "REFERENCE",
    "PARTICULARS",
    "QTY",
    "AMOUNT",
    "AMONNT",
    "TOTAL",
    "BANK",
    "CHECK NO",
    "CASHIER",
    "CHECK DATE",
    "RECEIVED FROM"
  ];

  return labels.some(label =>
    new RegExp("^" + label + "\\s*:?", "i").test(line)
  );
}

/*
  Find the next useful line after a label.
*/
function findValueAfterLabel(lines, labels) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const label of labels) {
      const regex = new RegExp(
        "^" + label + "\\s*:?\\s*(.*)$",
        "i"
      );

      const match = line.match(regex);

      if (match) {
        const sameLineValue = match[1].trim();

        if (
          sameLineValue &&
          !isLabelLine(sameLineValue) &&
          !isGarbageLine(sameLineValue)
        ) {
          return sameLineValue;
        }

        // Look at the next few lines
        for (
          let j = i + 1;
          j < Math.min(i + 4, lines.length);
          j++
        ) {
          const nextLine = lines[j];

          if (
            nextLine &&
            !isLabelLine(nextLine) &&
            !isGarbageLine(nextLine)
          ) {
            return nextLine;
          }
        }
      }
    }
  }

  return "";
}

/*
  Check if a value looks like an actual money amount.
*/
function isMoneyValue(value) {
  if (!value) {
    return false;
  }

  const normalized = value
    .replace(/,/g, "")
    .replace(/\s/g, "");

  /*
    Examples accepted:
    100
    100.00
    ₱100
    P100
    PHP100
    1,500.00
  */
  return /^(₱|P|PHP|\$)?\d+(\.\d{1,2})?$/.test(normalized);
}

/*
  Check if a value looks like a payment description.
*/
function looksLikePaymentDescription(value) {
  if (!value) {
    return false;
  }

  // Payment descriptions normally contain letters.
  if (!/[A-Za-z]/.test(value)) {
    return false;
  }

  // Do not treat obvious labels as descriptions.
  if (isLabelLine(value)) {
    return false;
  }

  return true;
}

/*
  Extract important receipt information.
*/
function extractReceiptDetails(lines) {
  const details = {
    receiptTitle: "",
    date: "",
    receiptNumber: "",
    receivedFrom: "",
    amount: "",
    total: "",
    paymentFor: "",
    particulars: "",
    cashier: "",
    checkDate: "",
    storeAddress: "",
    tin: ""
  };

  /*
    Receipt / establishment name
  */
  for (const line of lines.slice(0, 15)) {
    if (
      /medical center/i.test(line) ||
      /hospital/i.test(line) ||
      /clinic/i.test(line) ||
      /restaurant/i.test(line) ||
      /store/i.test(line) ||
      /inc\.?/i.test(line)
    ) {
      details.receiptTitle = line;
      break;
    }
  }

  /*
    Date
  */
  details.date = findValueAfterLabel(lines, [
    "DATE"
  ]);

  /*
    Received From
  */
  details.receivedFrom = findValueAfterLabel(lines, [
    "RECEIVED FROM"
  ]);

  /*
    Payment For
  */
  details.paymentFor = findValueAfterLabel(lines, [
    "PAYMENT FOR",
    "IN PAYMENT OF",
    "ACCOUNT OF"
  ]);

  /*
    Particulars
  */
  details.particulars = findValueAfterLabel(lines, [
    "PARTICULARS"
  ]);

  /*
    Amount
  */
  const possibleAmount = findValueAfterLabel(lines, [
    "AMOUNT",
    "AMONNT"
  ]);

  if (isMoneyValue(possibleAmount)) {
    details.amount = possibleAmount;
  }

  /*
    Total
  */
  const possibleTotal = findValueAfterLabel(lines, [
    "TOTAL"
  ]);

  if (isMoneyValue(possibleTotal)) {
    details.total = possibleTotal;
  }

  /*
    IMPORTANT OCR CORRECTION

    Sometimes QVAC OCR places the value belonging to
    "PAYMENT FOR" underneath "TOTAL".

    Example:

    PAYMENT FOR
    :

    TOTAL
    Clinical Abstract

    "Clinical Abstract" is NOT a money amount.
    Therefore, move it to Payment For.
  */
  if (
    !details.paymentFor &&
    possibleTotal &&
    looksLikePaymentDescription(possibleTotal) &&
    !isMoneyValue(possibleTotal)
  ) {
    details.paymentFor = possibleTotal;
    details.total = "";
  }

  /*
    If Payment For contains only ":" or similar OCR noise,
    clear it.
  */
  if (
    details.paymentFor &&
    /^[:;.,_-]+$/.test(details.paymentFor.trim())
  ) {
    details.paymentFor = "";
  }

  /*
    Cashier
  */
  details.cashier = findValueAfterLabel(lines, [
    "CASHIER"
  ]);

  /*
    Check date
  */
  details.checkDate = findValueAfterLabel(lines, [
    "CHECK DATE"
  ]);

  /*
    TIN
  */
  details.tin = findValueAfterLabel(lines, [
    "TIN",
    "VAT REGISTERED TIN"
  ]);

  /*
    Receipt number
  */
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(RECEIPT\s*)?NO\s*:?\s*$/i.test(line)) {
      for (
        let j = i + 1;
        j < Math.min(i + 4, lines.length);
        j++
      ) {
        if (/^\d{4,}$/.test(lines[j])) {
          details.receiptNumber = lines[j];
          break;
        }
      }
    }

    if (
      /^(RECEIPT\s*NO|OR\s*NO|OFFICIAL\s*RECEIPT\s*NO)/i.test(line)
    ) {
      const value = line
        .replace(
          /^(RECEIPT\s*NO|OR\s*NO|OFFICIAL\s*RECEIPT\s*NO)\s*:?\s*/i,
          ""
        )
        .trim();

      if (value) {
        details.receiptNumber = value;
      }
    }
  }

  /*
    Store address
  */
  const addressLines = lines.filter(line =>
    /bacolod/i.test(line) ||
    /street/i.test(line) ||
    /city/i.test(line)
  );

  if (addressLines.length > 0) {
    details.storeAddress = addressLines
      .slice(0, 2)
      .join(", ");
  }

  return details;
}

/*
  Create clean readable output.
*/
function formatReceipt(details) {
  const output = [];

  if (details.receiptTitle) {
    output.push(`RECEIPT: ${details.receiptTitle}`);
  }

  if (details.date) {
    output.push(`DATE: ${details.date}`);
  }

  if (details.receiptNumber) {
    output.push(`RECEIPT NO: ${details.receiptNumber}`);
  }

  if (details.receivedFrom) {
    output.push(`RECEIVED FROM: ${details.receivedFrom}`);
  }

  if (details.paymentFor) {
    output.push(`PAYMENT FOR: ${details.paymentFor}`);
  }

  if (details.particulars) {
    output.push(`PARTICULARS: ${details.particulars}`);
  }

  if (details.amount) {
    output.push(`AMOUNT: ${details.amount}`);
  }

  if (details.total) {
    output.push(`TOTAL: ${details.total}`);
  }

  if (details.cashier) {
    output.push(`CASHIER: ${details.cashier}`);
  }

  if (details.checkDate) {
    output.push(`CHECK DATE: ${details.checkDate}`);
  }

  if (details.tin) {
    output.push(`TIN: ${details.tin}`);
  }

  if (details.storeAddress) {
    output.push(`ADDRESS: ${details.storeAddress}`);
  }

  return output.join("\n");
}

app.post("/api/ocr", upload.single("receipt"), async (req, res) => {
  let modelId = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Please upload a receipt image."
      });
    }

    console.log("Loading QVAC OCR model...");

    modelId = await loadModel({
      modelSrc: OCR_LATIN.src,
      modelType: MODEL_TYPES.ggmlOcr
    });

    console.log(`QVAC OCR model loaded: ${modelId}`);
    console.log("Running local OCR...");

    const { blocks } = ocr({
      modelId,
      image: req.file.buffer,
      options: {
        paragraph: false
      }
    });

    const result = await blocks;

    console.log("OCR completed.");

    /*
      Convert raw OCR into clean lines
    */
    const lines = getCleanLines(result);

    console.log("Clean OCR lines:");
    console.log(lines);

    /*
      Extract important information
    */
    const details = extractReceiptDetails(lines);

    console.log("Extracted receipt details:");
    console.log(details);

    /*
      Create clean readable text
    */
    const formattedText = formatReceipt(details);

    res.json({
      success: true,
      text: formattedText,
      details,
      blocks: result
    });

  } catch (error) {
    console.error("QVAC OCR error:", error);

    res.status(500).json({
      success: false,
      error: error?.message || "OCR failed."
    });

  } finally {
    /*
      IMPORTANT:
      Always unload the QVAC model after OCR.
    */
    if (modelId) {
      try {
        console.log("Unloading QVAC OCR model...");

        await unloadModel({
          modelId,
          clearStorage: false
        });

        console.log("QVAC OCR model unloaded.");

      } catch (unloadError) {
        console.error("Unload error:", unloadError);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log("");
  console.log("====================================");
  console.log("QVAC LOCAL RECEIPT READER");
  console.log("====================================");
  console.log(`Web app: http://localhost:${PORT}`);
  console.log("AI: QVAC local OCR");
  console.log("====================================");
});