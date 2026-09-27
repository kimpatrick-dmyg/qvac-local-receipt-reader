\# QVAC Local Receipt Reader



A local AI-powered receipt reader that uses Tether's QVAC SDK for on-device OCR processing.



\## Features



\* Upload receipt images

\* Process receipt images locally

\* Use QVAC OCR for on-device AI processing

\* Extract important receipt information

\* Display structured receipt details

\* Show the original OCR output

\* Load and unload the QVAC OCR model

\* No cloud upload required for OCR processing



\## QVAC Implementation



The application uses the QVAC SDK to perform local AI inference.



The OCR workflow includes:



1\. Load the QVAC OCR model.

2\. Process the uploaded receipt image.

3\. Run OCR locally using QVAC.

4\. Extract relevant receipt information.

5\. Display the extracted information in the application.

6\. Unload the QVAC OCR model after processing.



\## Technologies



\* HTML

\* CSS

\* JavaScript

\* Node.js

\* QVAC SDK

\* QVAC OCR



\## Local Processing



Receipt images are processed locally using QVAC OCR. The application is designed to avoid sending receipt images to a cloud OCR service.



\## Project Structure



```text

qvac-local-receipt-reader/



├── index.html

├── style.css

├── server.js

├── package.json

├── README.md

└── ...

```



