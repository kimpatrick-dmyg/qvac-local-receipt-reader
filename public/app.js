const form = document.getElementById("ocrForm");
const fileInput = document.getElementById("receipt");
const statusMessage = document.getElementById("status");
const resultsSection = document.getElementById("results");
const resultsTable = document.getElementById("resultsTable");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!fileInput.files.length) {
    statusMessage.textContent = "Please choose a receipt image.";
    statusMessage.className = "status error";
    return;
  }

  const formData = new FormData();
  formData.append("receipt", fileInput.files[0]);

  statusMessage.textContent = "Reading receipt with local QVAC OCR...";
  statusMessage.className = "status loading";

  resultsSection.style.display = "none";
  resultsTable.innerHTML = "";

  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "OCR failed.");
    }

    statusMessage.textContent = "OCR completed successfully.";
    statusMessage.className = "status success";

    displayReceiptDetails(data.details);

  } catch (error) {
    console.error(error);

    statusMessage.textContent =
      error.message || "Something went wrong.";

    statusMessage.className = "status error";
  }
});


function displayReceiptDetails(details) {

  const fields = [
    {
      label: "Receipt",
      value: details.receiptTitle
    },
    {
      label: "Date",
      value: details.date
    },
    {
      label: "Receipt No.",
      value: details.receiptNumber
    },
    {
      label: "Received From",
      value: details.receivedFrom
    },
    {
      label: "Payment For",
      value: details.paymentFor
    },
    {
      label: "Particulars",
      value: details.particulars
    },
    {
      label: "Total",
      value: details.total
    },
    {
      label: "Cashier",
      value: details.cashier
    },
    {
      label: "Check Date",
      value: details.checkDate
    },
    {
      label: "TIN",
      value: details.tin
    },
    {
      label: "Address",
      value: details.storeAddress
    }
  ];

  let hasData = false;

  for (const field of fields) {

    if (
      field.value === undefined ||
      field.value === null ||
      String(field.value).trim() === ""
    ) {
      continue;
    }

    hasData = true;

    const row = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.className = "field-name";
    labelCell.textContent = field.label;

    const valueCell = document.createElement("td");
    valueCell.className = "field-value";
    valueCell.textContent = field.value;

    row.appendChild(labelCell);
    row.appendChild(valueCell);

    resultsTable.appendChild(row);
  }

  if (hasData) {
    resultsSection.style.display = "block";
  } else {
    resultsTable.innerHTML = `
      <tr>
        <td colspan="2" class="no-data">
          No important receipt details were detected.
        </td>
      </tr>
    `;

    resultsSection.style.display = "block";
  }
}